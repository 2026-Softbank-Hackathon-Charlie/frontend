import type { ChipKind } from "./ui";
import { Chip } from "./ui";
import { fmt } from "../sim/format";
import type { RunResult, WriteVerification as WriteVerificationData } from "../api/types";
import "../styles/write-verification.css";

export type WriteVerificationRecord = WriteVerificationData;

export function writeVerificationOf(result: RunResult): WriteVerificationRecord | undefined {
  return result.writeVerification;
}

const knownCount = (n: number | undefined): n is number => n !== undefined && Number.isSafeInteger(n) && n >= 0;
const countText = (n?: number) => knownCount(n) ? `${fmt(n)}건` : "미측정";

/** Never turn an absent or empty verification input into a measured zero. */
export function measuredWriteMissing(verification?: WriteVerificationRecord, legacyMissing?: number): number | undefined {
  if (!verification) return knownCount(legacyMissing) ? legacyMissing : undefined;
  return verification.status === "measured" && knownCount(verification.checked) && verification.checked > 0 && knownCount(verification.missing)
    ? verification.missing : undefined;
}

function presentation(v?: WriteVerificationRecord, legacyMissing?: number): { label: string; kind: ChipKind; reason: string } {
  if (!v) return knownCount(legacyMissing)
    ? { label: "쓰기 검증 결과 있음", kind: legacyMissing > 0 ? "bad" : "ok", reason: "이전 형식의 검증 결과입니다. 검사 기록 수와 수집 정보는 제공되지 않았습니다." }
    : { label: "쓰기 검증 정보 없음", kind: "warn", reason: "이 실행에는 쓰기 검증 정보가 없습니다. 쓰기 기록의 연결과 검증 단계 실행 여부를 확인해 주세요." };
  switch (v.status) {
    case "not_configured": return { label: "쓰기 기록 미연결", kind: "warn", reason: "이전 Plan에 쓰기 기록이 연결되지 않아 쓰기 누락을 측정하지 않았습니다." };
    case "no_records": return { label: "수집 기록 없음", kind: "warn", reason: "이번 이전의 검증 입력에 쓰기 기록이 없습니다. 누락 0건으로 판단할 수 없습니다." };
    case "not_reached": return { label: "쓰기 검증 미실행", kind: "warn", reason: "쓰기 검증 단계가 완료되지 않았습니다. 수집된 기록 수가 곧 검사 완료 수는 아닙니다." };
    case "failed": return { label: "쓰기 검증 오류", kind: "bad", reason: v.reason === "written_records_export_failed"
      ? "수집 기록을 검증 입력으로 준비하지 못했습니다. 쓰기 누락은 측정되지 않았습니다."
      : "쓰기 기록의 검증을 완료하지 못했습니다. 부분 결과를 누락 없음으로 해석할 수 없습니다." };
    case "measured": {
      const missing = measuredWriteMissing(v);
      if (missing === undefined) return { label: "쓰기 검증 확인 필요", kind: "warn", reason: "검사한 기록 수와 누락 결과가 확인되지 않아 쓰기 누락을 측정값으로 표시하지 않습니다." };
      return { label: missing > 0 ? "쓰기 누락 발견" : "쓰기 검증 완료", kind: missing > 0 ? "bad" : "ok", reason: "이번 이전에 고정된 쓰기 기록을 대상으로 검사한 결과입니다. 기록되지 않은 쓰기는 포함하지 않습니다." };
    }
    default: return { label: "쓰기 검증 확인 필요", kind: "warn", reason: "알 수 없는 쓰기 검증 상태입니다. 결과를 누락 없음으로 해석할 수 없습니다." };
  }
}

export function WriteVerification({ verification: v, legacyMissing }: { verification?: WriteVerificationRecord; legacyMissing?: number }) {
  const view = presentation(v, legacyMissing);
  const latest = v?.latestAt && Number.isFinite(Date.parse(v.latestAt)) ? v.latestAt : undefined;
  // with no written records connected every count would read "미측정"; the reason says so once
  const metrics = !!v && v.status !== "not_configured";
  return <section className="write-verification" aria-label="쓰기 기록 검증">
    <div className="write-verification-heading"><h3>쓰기 기록 검증</h3><Chip kind={view.kind}>{view.label}</Chip></div>
    <p className="hint">{view.reason}</p>
    {metrics && <dl className="write-verification-metrics">
      <div><dt>검증 입력 기록</dt><dd>{countText(v.collectedRecords)}</dd></div>
      <div><dt>검사 기록</dt><dd>{countText(v.checked)}</dd></div>
      <div><dt>{v.status === "failed" ? "확인된 누락 (부분 결과)" : "쓰기 누락"}</dt><dd>{v.status === "failed" ? countText(v.missing) : countText(measuredWriteMissing(v))}</dd></div>
      <div><dt>입력의 마지막 쓰기 기록</dt><dd>{latest ? <time dateTime={latest}>{new Date(latest).toLocaleString("ko-KR", { hour12: false })}</time> : v.collectedRecords === 0 ? "기록 없음" : "시각 미제공"}</dd></div>
    </dl>}
    {metrics && <p className="hint">표시 시각은 검증 입력의 쓰기 기록에 담긴 시각 중 가장 최근 값입니다. 플랫폼 도착 시각은 제공되지 않습니다.</p>}
    {v?.stream && <p className="hint">기록 스트림 <code>{v.stream}</code></p>}
    {v?.scope === "application_commits" && <p className="hint">앱 DB 커밋 기록 기준입니다. 클라이언트의 성공 응답 수신을 증명하지 않습니다.</p>}
    {v?.scope === "client_acknowledged" && <p className="hint">클라이언트가 성공 응답을 확인한 쓰기 기록 기준입니다.</p>}
    {v?.coverage === "reservation_inserts" && <p className="hint">검사 범위는 예약 생성 기록입니다. 수정·삭제와 다른 종류의 쓰기는 포함하지 않습니다.</p>}
    {v?.coverage === "reported_records" && <p className="hint">보고된 테이블·키의 기록만 검사합니다. 보고되지 않은 쓰기는 포함하지 않습니다.</p>}
  </section>;
}
