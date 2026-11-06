// SEC-08: register and revoke an operator's time-limited exception. An exception never changes severity.
import { useState } from "react";
import { createSecurityException, revokeSecurityException } from "../api/client";
import type { ExceptionInfo } from "../data/security";

const DAY = 86_400_000;
const KST = 9 * 3_600_000;
/** The KST calendar day (YYYY-MM-DD) of an instant. */
const kstDay = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);
const endOfKstDay = (day: string) => Date.parse(`${day}T23:59:59+09:00`);

/** `예외 · MM/DD까지`, in KST. */
export function exceptionLabel(e: ExceptionInfo): string {
  return `예외 · ${kstDay(Date.parse(e.expiresAt)).slice(5).replace("-", "/")}까지`;
}

const HINT = "예외는 심각도를 바꾸지 않습니다. 만료일이 지나면 다시 미처리로 보입니다.";

export function SecurityExceptionPanel({ targetType, targetId, exception, kev = false, onChange }: {
  targetType: "finding" | "vulnerability"; targetId: string; exception?: ExceptionInfo; kev?: boolean; onChange?: () => void;
}) {
  const limitDays = kev ? 7 : 30;
  const now = Date.now();
  const today = kstDay(now), maxDay = kstDay(now + limitDays * DAY);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [day, setDay] = useState(maxDay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await call();
      setOpen(false);
      setReason("");
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const trimmed = reason.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 500 && day >= today && day <= maxDay;
  // The chosen day ends at 23:59:59 KST; on the last allowed day that is past the server's limit (30 days or 168 h from now), so stop a minute before it.
  const expiresAt = () => new Date(Math.min(endOfKstDay(day), Date.now() + limitDays * DAY - 60_000)).toISOString();
  const alert = error && <p role="alert" className="sp-exception-error">{error}</p>;

  if (exception) {
    return <div className="sp-exception">
      <p><b>{exceptionLabel(exception)} · {exception.createdBy}</b></p>
      <p>{exception.reason}</p>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(() => revokeSecurityException(exception.id))}>예외 해제</button>
      {alert}
    </div>;
  }
  if (!open) {
    return <div className="sp-exception"><button type="button" className="btn ghost sm" onClick={() => { setDay(maxDay); setOpen(true); }}>예외 등록</button>{alert}</div>;
  }
  return <form className="sp-exception sp-exception-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void run(() => createSecurityException({ targetType, targetId, reason: trimmed, expiresAt: expiresAt() })); }}>
    <label>사유<textarea required maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <label>만료일<input type="date" required min={today} max={maxDay} value={day} onChange={(e) => setDay(e.target.value)} /></label>
    <div className="sp-exception-actions">
      <button type="submit" className="btn sm" disabled={!valid || busy}>등록</button>
      <button type="button" className="btn ghost sm" onClick={() => { setOpen(false); setError(undefined); }}>취소</button>
    </div>
    <p className="hint">{HINT}{kev && " KEV 등재 취약점은 최대 7일입니다."}</p>
    {alert}
  </form>;
}
