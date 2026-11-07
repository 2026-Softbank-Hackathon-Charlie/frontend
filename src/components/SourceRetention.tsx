import { useState } from "react";
import { preserveSource } from "../api/client";
import { useSourceRetention } from "../api/hooks";
import { errorText, useAuth } from "../data/live";
import { Chip } from "./ui";

const STATUS = { captured: "이전 완료 대기", scheduled: "정리 예약", blocked: "정리 보류", deleting: "정리 진행 중", deleted: "원본 DB 정리 완료", cancelled: "자동 정리 취소" } as const;
const REASON: Record<string, string> = {
  safety_check_failed: "대상 상태, 트래픽, 원본 사용 여부 또는 백업·복구 근거를 확인하지 못했습니다. 조건이 충족되면 다시 확인합니다.",
  cluster_identity_changed: "DB가 재생성됐거나 최초에 기록한 대상과 다릅니다. 운영자 확인이 필요합니다.",
  migration_verification_incomplete: "이전 검증 또는 전환 후 관찰이 완료되지 않았습니다.",
  rollback_plan_exists: "이 실행을 되돌리는 롤백 계획이 있어 정리를 보류합니다.",
  deletion_unconfirmed: "삭제 요청의 완료를 확인하지 못했습니다. 같은 자원의 상태를 다시 확인합니다.",
  operator_keep: "운영자가 원본 보존을 선택했습니다.",
  operator_extended: "운영자가 보존 기간을 연장했습니다.",
  superseded_by_migration: "새 이전이 있어 기존 정리 예약을 취소했습니다.",
  "superseded by another migration": "새 이전이 있어 기존 정리 예약을 취소했습니다.",
  "PVCs and non-database resources retained": "PVC와 DB 이외 자원은 보존했습니다.",
};

export function LiveSourceRetention({ runId }: { runId: string }) {
  const operator = useAuth().session?.principal.role === "operator";
  return <SourceRetentionPanel key={runId} runId={runId} operator={operator} />;
}

export function SourceRetentionPanel({ runId, operator }: { runId: string; operator: boolean }) {
  const state = useSourceRetention(runId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const job = state.data?.job;
  const change = async (action: "extend" | "keep") => {
    if (!job || busy || state.error) return;
    setBusy(true); setNotice("");
    try {
      const base = Math.max(Date.now(), job.dueAt ? Date.parse(job.dueAt) : Date.now() + job.keepForNanos / 1e6);
      await preserveSource(runId, action === "keep" ? { keep: true } : { retainUntil: new Date(base + 86_400_000).toISOString() });
      setNotice(action === "keep" ? "자동 정리를 취소했습니다." : "보존 기간을 24시간 연장했습니다.");
      state.reload();
    } catch (e) { setNotice(errorText(e)); }
    finally { setBusy(false); }
  };
  const canChange = !!job && !["deleting", "deleted", "cancelled"].includes(job.status);
  return <section className="box" aria-label="원본 보존 및 자동 정리">
    <div className="bh"><b>원본 보존 및 자동 정리</b>{job && <Chip kind={job.status === "blocked" ? "warn" : ""}>{STATUS[job.status]}</Chip>}</div>
    <div className="bb">
      {state.loading && <p role="status">정리 예약을 확인하고 있습니다.</p>}
      {state.error && <p role="alert">정리 상태를 갱신하지 못했습니다. {job ? "마지막 수신 상태입니다. " : ""}{errorText(state.error)}</p>}
      {state.data && !job && <p className="hint">이 실행에는 자동 정리 예약이 없습니다. 이전 성공만으로 원본을 삭제하지 않습니다.</p>}
      {job && <>
        <p>{job.dueAt ? <>정리 예정 시각: <time dateTime={job.dueAt}>{new Date(job.dueAt).toLocaleString("ko-KR")}</time> · 안전 조건이 충족될 때 실행합니다.</> : "이전과 검증이 끝난 뒤 정리 예정 시각이 확정됩니다."}</p>
        {job.reason && <p className="hint">{REASON[job.reason] ?? job.reason}</p>}
        <p className="hint">원본 DB 정리가 시작되면 즉시 역방향 롤백할 수 없습니다. PVC·백업·공유 Kubernetes 클러스터는 자동 삭제하지 않습니다.</p>
        {operator && canChange && <div className="actrow">
          <button type="button" className="btn" disabled={busy || !!state.error} onClick={() => void change("extend")}>보존 24시간 연장</button>
          <button type="button" className="btn ghost" disabled={busy || !!state.error} onClick={() => void change("keep")}>원본 계속 보존</button>
        </div>}
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>;
}
