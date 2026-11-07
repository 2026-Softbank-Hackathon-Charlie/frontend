import { useEffect, useRef, useState } from "react";
import { ApiError, createOnpremEnrollment, getOnpremEnrollment, newIdempotencyKey, revokeOnpremEnrollment } from "../api/client";
import type { OnpremCheckId, OnpremEnrollment } from "../api/onprem";
import { errorText, useAuth } from "../data/live";
import { Chip, Table, td, type ChipKind } from "./ui";

const CHECKS: [OnpremCheckId, string][] = [["k3s", "k3s 실행"], ["network", "네트워크 연결"], ["permissions", "배포 권한"], ["image_pull", "이미지 다운로드"], ["hello_world", "Hello World 응답"]];
const STATUS: Record<OnpremEnrollment["status"], [ChipKind, string]> = {
  pending: ["warn", "장비 연결 대기"], claimed: ["run", "등록 코드 사용됨"], verifying: ["run", "검증 중"],
  ready: ["ok", "검증 결과 수신"], failed: ["bad", "연결 실패"], expired: ["warn", "코드 만료"], revoked: ["neu", "코드 폐기됨"],
};
const CHECK_STATUS = { pending: "대기", running: "확인 중", passed: "통과", failed: "실패", unknown: "미확인" };
const STAGE: Record<string, string> = {
  bootstrap_issued: "연결 서비스 설치 준비",
  waiting_for_device: "장비의 연결 서비스를 기다리는 중",
  api_route_failed: "장비 API 연결 경로 구성 실패",
  invalid_internal_route: "관리 네트워크 연결 경로 확인 필요",
  cluster_checks: "클러스터 권한·이미지·Hello World 검사 중",
  environment_registration_failed: "검증 후 환경 등록 실패",
  ready: "클러스터 등록 완료",
};
interface EnvironmentDiscovery {
  /** Names from GET /v1/envs; undefined means discovery has not succeeded. */
  environmentNames?: string[];
  environmentListError?: string;
  onReloadEnvironments?: () => void;
}
const terminal = (s: OnpremEnrollment["status"]) => ["ready", "failed", "expired", "revoked"].includes(s);
function validEnrollment(value: OnpremEnrollment, expectedId?: string): boolean {
  return !!value && typeof value.id === "string" && value.id.length > 0 && (!expectedId || value.id === expectedId) &&
    typeof value.environment === "string" && Object.hasOwn(STATUS, value.status) && (value.stage === undefined || typeof value.stage === "string") &&
    [value.createdAt, value.updatedAt, value.expiresAt].every((v) => Number.isFinite(Date.parse(v))) &&
    Array.isArray(value.checks) && value.checks.every((c) => c && typeof c.id === "string" && typeof c.status === "string" && Object.hasOwn(CHECK_STATUS, c.status) && (c.message === undefined || typeof c.message === "string"));
}
function failure(error: unknown) {
  if (error instanceof ApiError && error.code === "enrollment_issuer_unavailable") return "온프렘 등록 서비스 설정이 완료되지 않았습니다. 관리자가 연결 서비스와 이미지 설정을 확인한 뒤 다시 발급하세요.";
  if (error instanceof ApiError && error.code === "enrollment_environment_exists") return "이미 등록된 환경 이름입니다. 새 장비에는 다른 이름을 사용하세요. 기존 환경을 교체하지 않습니다.";
  if (error instanceof ApiError && error.code === "enrollment_conflict") return "등록 요청 상태가 바뀌었거나 코드가 이미 사용됐습니다. 현재 연결 상태를 확인하고 기존 코드를 폐기한 뒤 재발급하세요.";
  if (error instanceof ApiError && [404, 405, 501].includes(error.status)) return "이 서버는 온프렘 자동 연결을 지원하지 않습니다. 서버의 등록 기능과 설치 프로그램 연결을 확인하세요.";
  if (error instanceof ApiError && error.status === 503) return "서버가 지금 온프렘 등록 요청을 처리할 수 없습니다. 설정과 연결 상태를 확인하고 다시 시도하세요.";
  if (error instanceof ApiError && error.status === 403) return "온프렘 연결 권한이 없습니다. 관리자에게 요청하세요.";
  return errorText(error);
}

/** No enrollment codes are generated or persisted by the console. */
export function OnpremEnrollmentEntry({ onReady, ...discovery }: { onReady?: () => void } & EnvironmentDiscovery) {
  const session = useAuth().session;
  const operator = session?.principal.role === "operator";
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <div className="actrow"><button ref={trigger} type="button" className="btn ghost sm" onClick={() => setOpen(true)}>온프렘 연결</button></div>
    {open && <OnpremEnrollmentPanel key={session?.principal.name ?? "anonymous"} {...discovery} operator={operator} onReady={onReady} onClose={() => { setOpen(false); trigger.current?.focus(); }} />}
  </>;
}

export function OnpremEnrollmentPanel({ operator, onClose, onReady, pollMs = 5000, environmentNames, environmentListError, onReloadEnvironments }: { operator: boolean; onClose: () => void; onReady?: () => void; pollMs?: number } & EnvironmentDiscovery) {
  const [environment, setEnvironment] = useState(() => environmentNames?.includes("onprem") ? "" : "onprem");
  const nameEdited = useRef(false);
  const [installK3s, setInstallK3s] = useState(false);
  const [enrollment, setEnrollment] = useState<OnpremEnrollment>();
  const [issued, setIssued] = useState<{ code: string; installCommand: string }>();
  const issuance = useRef<{ intent: string; key: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now);
  const activeId = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const completed = useRef<string | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const allowed = useRef(operator);
  allowed.current = operator;
  const expires = enrollment ? Date.parse(enrollment.expiresAt) : NaN;
  const expired = !!enrollment && Number.isFinite(expires) && now >= expires && enrollment.status === "pending";
  const canInstall = operator && enrollment?.status === "pending" && !expired && !error && !!issued;
  const done = enrollment?.status === "ready" && CHECKS.every(([id]) => enrollment.checks.some((c) => c.id === id && c.status === "passed"));
  const nameCollision = !enrollment && environmentNames?.includes(environment);
  const validName = environmentNames !== undefined && !environmentListError && !nameCollision && /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(environment);

  useEffect(() => { mounted.current = true; heading.current?.focus(); return () => { mounted.current = false; activeId.current = undefined; }; }, []);
  useEffect(() => { if (!operator) { setIssued(undefined); setEnrollment(undefined); activeId.current = undefined; } }, [operator]);
  useEffect(() => { if (!nameEdited.current && !enrollment && environment === "onprem" && environmentNames?.includes("onprem")) setEnvironment(""); }, [environmentNames, enrollment, environment]);
  useEffect(() => {
    if (!enrollment || enrollment.status !== "pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enrollment]);
  useEffect(() => { if (enrollment?.status !== "pending" || expired) setIssued(undefined); }, [enrollment?.status, expired]);
  useEffect(() => { if (done && completed.current !== enrollment.id) { completed.current = enrollment.id; onReady?.(); } }, [done, enrollment, onReady]);

  async function refresh() {
    if (!enrollment || busyRef.current) return;
    const id = enrollment.id;
    busyRef.current = true; setBusy(true);
    try {
      const result = await getOnpremEnrollment(id);
      if (!validEnrollment(result, id)) throw new Error("서버의 등록 응답을 확인할 수 없습니다.");
      if (mounted.current && activeId.current === id) { setEnrollment(result); setError(""); setNow(Date.now()); }
    } catch (e) {
      if (mounted.current && activeId.current === id) { setError("연결 상태를 갱신하지 못했습니다. 마지막으로 받은 결과입니다. " + failure(e)); setIssued(undefined); }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!enrollment || terminal(enrollment.status) || pollMs <= 0) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [enrollment?.id, enrollment?.status, pollMs]);

  async function create(replace = false) {
    if (!operator || !validName || busyRef.current || unsupported) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (replace && enrollment && !["expired", "revoked"].includes(enrollment.status)) {
        const revoked = await revokeOnpremEnrollment(enrollment.id);
        if (revoked.status !== "revoked") throw new Error("기존 코드를 폐기하지 못해 새 코드를 발급하지 않았습니다.");
      }
      activeId.current = undefined; setIssued(undefined);
      const intent = JSON.stringify([environment, installK3s, replace ? enrollment?.id : null]);
      if (issuance.current?.intent !== intent) issuance.current = { intent, key: newIdempotencyKey() };
      const result = await createOnpremEnrollment({ environment, installK3s }, issuance.current.key);
      if (!mounted.current || !allowed.current) return;
      if (!validEnrollment(result.enrollment)) throw new Error("서버의 등록 응답을 확인할 수 없습니다.");
      activeId.current = result.enrollment.id; setEnrollment(result.enrollment); setNow(Date.now());
      if (result.enrollment.status === "pending" && typeof result.code === "string" && result.code && typeof result.installCommand === "string" && result.installCommand) setIssued({ code: result.code, installCommand: result.installCommand });
      else if (result.enrollment.status === "pending") setError("등록 요청은 있지만 코드를 다시 읽을 수 없습니다. 기존 코드를 폐기한 뒤 재발급하세요.");
    } catch (e) {
      if (mounted.current) {
        setError(failure(e)); setIssued(undefined);
        if (e instanceof ApiError && [404, 405, 501].includes(e.status)) setUnsupported(true);
      }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function revoke() {
    if (!operator || !enrollment || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await revokeOnpremEnrollment(enrollment.id);
      if (!validEnrollment(result, enrollment.id) || result.status !== "revoked") throw new Error("기존 코드를 폐기하지 못해 새 코드를 발급하지 않았습니다.");
      if (mounted.current) { setEnrollment(result); setIssued(undefined); }
    } catch (e) { if (mounted.current) setError(failure(e)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function copyCommand() {
    if (!canInstall || !issued) return;
    try { await navigator.clipboard.writeText(issued.installCommand); setNotice("설치 명령을 복사했습니다."); }
    catch { setNotice("자동 복사를 하지 못했습니다. 명령을 직접 선택해 복사하세요."); }
  }

  return <section className="box onprem-enrollment" aria-label="온프렘 연결 마법사">
    <div className="bh"><h2 ref={heading} tabIndex={-1}>온프렘 연결</h2><button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>닫기</button></div>
    <div className="bb">
      <p>장비 관리자가 Linux 또는 WSL2의 Linux 터미널에서 명령을 실행합니다. 브라우저가 컴퓨터에 k3s를 직접 설치하지 않습니다. Windows PowerShell에서는 직접 실행할 수 없습니다.</p>
      <p className="hint">기존 k3s는 재사용합니다. 설치에 동의한 경우에만 없는 k3s를 설치합니다. 등록 코드와 명령은 이 화면에만 보관하며 새로고침하면 사라집니다.</p>
      <p className="hint">실행 전제조건: Linux 또는 WSL2 Linux의 root 권한과 curl·python3·sha256sum이 필요합니다. k3s를 새로 설치하는 장비는 systemd 또는 OpenRC가 실행 중이어야 합니다.</p>
      <p className="hint">명령은 k3s 확인·설치, 연결 서비스 설치, 서버의 5개 검사 대기까지 수행합니다. 연결 서비스가 짧은 수명의 서비스 계정 토큰을 자동 갱신합니다.</p>
      <p className="hint">여기서 확인하는 범위는 Kubernetes 연결과 제한된 Hello World 배포 검사입니다. DB·MinIO·GPU 설치와 환경 동등성은 별도로 확인해야 합니다.</p>
      {!operator && <p role="status">관리자만 등록 코드를 발급할 수 있습니다.</p>}
      {!enrollment && environmentNames?.includes("onprem") && <p className="hint">onprem은 이미 등록되어 있습니다. 새 장비에는 다른 환경 이름을 사용하세요. 기존 환경을 교체하거나 덮어쓰지 않습니다.</p>}
      {!enrollment && environmentNames === undefined && !environmentListError && <p role="status">기존 환경 이름을 확인하고 있습니다. 확인 후 등록 코드를 발급할 수 있습니다.</p>}
      {!enrollment && environmentListError && <div role="alert"><p>기존 환경 이름을 확인하지 못했습니다. 중복을 확인하기 전에는 등록 코드를 발급하지 않습니다.</p><p className="hint">{environmentListError}</p>{onReloadEnvironments && <button type="button" className="btn ghost" onClick={onReloadEnvironments}>환경 목록 다시 확인</button>}</div>}
      <div className="field"><label htmlFor="onprem-env-name">환경 이름</label><input id="onprem-env-name" value={environment} placeholder="onprem-my-laptop" maxLength={32} disabled={busy || !!enrollment} onChange={(e) => { nameEdited.current = true; setEnvironment(e.target.value); }} autoComplete="off" spellCheck={false} /></div>
      {nameCollision && <p role="alert">이미 등록된 환경 이름입니다. 새 장비에는 다른 이름을 사용하세요. 기존 환경을 교체하지 않습니다.</p>}
      <label><input type="checkbox" checked={installK3s} disabled={busy || !!enrollment} onChange={(e) => setInstallK3s(e.target.checked)} /> 이 장비에 k3s가 없으면 설치하는 데 동의합니다.</label>
      {!enrollment && <div className="actrow"><button type="button" className="btn primary" disabled={!operator || busy || !validName || unsupported} onClick={() => void create()}>{busy ? "발급하는 중" : "등록 코드 발급"}</button></div>}
      {error && <p role="alert">{error}</p>}
      {enrollment && <>
        <p aria-live="polite"><Chip kind={expired ? "warn" : STATUS[enrollment.status]?.[0] ?? "warn"}>{expired ? "코드 만료" : STATUS[enrollment.status]?.[1] ?? "상태 미확인"}</Chip></p>
        {enrollment.stage && <dl className="kv"><dt>연결 단계</dt><dd>{Object.hasOwn(STAGE, enrollment.stage) ? STAGE[enrollment.stage] : "등록 단계 미확인"}</dd></dl>}
        <p className="hint">등록 요청: <span className="m" data-no-i18n>{enrollment.id}</span> · 마지막 수신 <time dateTime={enrollment.updatedAt}>{new Date(enrollment.updatedAt).toLocaleString("ko-KR")}</time></p>
        {canInstall && <>
          <p>일회용 등록 코드: <strong className="m" aria-label="일회용 등록 코드" data-no-i18n>{issued.code}</strong></p>
          <p>만료 시각: <time dateTime={enrollment.expiresAt}>{new Date(enrollment.expiresAt).toLocaleString("ko-KR")}</time> · 한 번 사용하면 다시 사용할 수 없습니다.</p>
          <div className="field"><label htmlFor="onprem-install-command">장비에서 실행할 명령</label><textarea id="onprem-install-command" className="m" readOnly rows={4} value={issued.installCommand} data-no-i18n autoComplete="off" spellCheck={false} /></div>
          <button type="button" className="btn" onClick={() => void copyCommand()}>설치 명령 복사</button>
        </>}
        {expired && <p>등록 코드가 만료됐습니다. 새 코드를 발급한 뒤 장비에서 실행하세요.</p>}
        <Table head={["확인 항목", "결과", "관측 시각"]} rows={CHECKS.map(([id, name]) => {
          const check = enrollment.checks.find((c) => c.id === id);
          return [td(name), td(<><Chip kind={check?.status === "passed" ? "ok" : check?.status === "failed" ? "bad" : "neu"}>{CHECK_STATUS[check?.status ?? "unknown"]}</Chip>{check?.message && <p className="hint">{check.message}</p>}</>), td(check?.checkedAt ? <time dateTime={check.checkedAt}>{new Date(check.checkedAt).toLocaleString("ko-KR")}</time> : "미관측")];
        })} />
        {done && <p role="status">클러스터 연결과 기본 배포 검증을 통과했습니다.</p>}
        {enrollment.status === "ready" && !done && <p role="alert">완료 상태를 받았지만 필수 검증 결과가 빠졌습니다. 배포 준비 완료로 표시하지 않습니다.</p>}
        <div className="actrow">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void refresh()}>연결 상태 새로고침</button>
          {operator && ["pending", "expired", "revoked", "failed"].includes(enrollment.status) && <button type="button" className="btn" disabled={busy || unsupported} onClick={() => void create(true)}>코드 폐기 후 재발급</button>}
          {operator && !terminal(enrollment.status) && <button type="button" className="btn ghost" disabled={busy} onClick={() => void revoke()}>등록 코드 폐기</button>}
        </div>
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>;
}
