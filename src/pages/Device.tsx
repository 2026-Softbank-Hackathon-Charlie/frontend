// #device: approve or deny a CLI device login (POST /v1/auth/device) by the code the CLI prints.
import { useState, type FormEvent } from "react";
import { ApiError, approveDeviceLogin, denyDeviceLogin, getDeviceLogin } from "../api/client";
import type { DeviceLogin, DeviceLoginStatus } from "../api/types";
import { ago, ms } from "../components/deploy";
import { Chip, PageHead, type ChipKind } from "../components/ui";
import { errorText } from "../data/live";

/** The code as the CLI prints it, XXXX-XXXX. Lowercase, spaces and '-' are accepted while typing or pasting. */
export function formatUserCode(raw: string): string {
  const c = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return c.length > 4 ? c.slice(0, 4) + "-" + c.slice(4) : c;
}

function deviceErrorText(e: unknown): string {
  if (e instanceof ApiError && e.code === "device_login_not_found") return "코드가 없거나 만료되었습니다";
  if (e instanceof ApiError && e.code === "device_login_state_conflict") return "이미 승인 또는 거절된 요청입니다";
  return errorText(e);
}

const STATUS: Record<DeviceLoginStatus, [ChipKind, string]> = {
  pending: ["run", "승인 대기"],
  approved: ["ok", "승인됨"],
  denied: ["bad", "거절됨"],
};

export function DevicePage() {
  const [code, setCode] = useState("");
  const [login, setLogin] = useState<DeviceLogin>();
  const [done, setDone] = useState<"approved" | "denied">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = code.length === 9;

  async function lookup(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    setLogin(undefined);
    setDone(undefined);
    try {
      setLogin(await getDeviceLogin(code));
    } catch (err) {
      setError(deviceErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function review(approve: boolean) {
    if (!login || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setLogin(await (approve ? approveDeviceLogin : denyDeviceLogin)(login.userCode));
      setDone(approve ? "approved" : "denied");
    } catch (err) {
      setError(deviceErrorText(err));
      // gone or already reviewed: the details on screen no longer hold
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) setLogin(undefined);
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  return (
    <div className="page">
      <PageHead
        title="CLI 연결"
        sub={
          <>
            터미널에서 <span className="m">charlie login</span>을 실행하고, CLI가 보여 주는 코드를 아래에 입력하세요. 승인하면 그 CLI가 내 관리자 권한으로 플랫폼을 씁니다.
          </>
        }
      />
      <form className="box" onSubmit={lookup}>
        <div className="bb">
          <div className="field">
            <label htmlFor="device-code">CLI가 보여 준 코드</label>
            <div className="actrow">
              <input
                id="device-code"
                className="devcode"
                placeholder="XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => {
                  setCode(formatUserCode(e.target.value));
                  setLogin(undefined);
                  setDone(undefined);
                  setError(undefined);
                }}
              />
              <button type="submit" className="btn primary" disabled={!ready || busy}>
                확인
              </button>
            </div>
          </div>
        </div>
      </form>
      {error && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <p>{error}</p>
          </div>
        </div>
      )}
      {done && (
        <div className={"box " + (done === "approved" ? "okbox" : "fillbox")} role="status">
          <div className="bb">
            <p>{done === "approved" ? "CLI 로그인을 승인했습니다. CLI가 곧 로그인을 마칩니다." : "거절했습니다."}</p>
          </div>
        </div>
      )}
      {login && !done && (
        <section className="box" aria-label="CLI 로그인 요청">
          <div className="bh">
            <b className="m">{login.userCode}</b>
            <Chip kind={STATUS[login.status][0]}>{STATUS[login.status][1]}</Chip>
          </div>
          <div className="bb">
            <dl className="kv">
              <dt>요청한 클라이언트</dt>
              <dd className="m">{login.client}</dd>
              <dt>요청 시각</dt>
              <dd>
                {new Date(ms(login.createdAt)).toLocaleTimeString("ko-KR")} ({ago(login.createdAt, now)})
              </dd>
              <dt>남은 시간</dt>
              <dd>{Math.max(0, Math.ceil((ms(login.expiresAt) - now) / 60_000))}분</dd>
            </dl>
            {login.status === "pending" ? (
              <>
                <div className="box fillbox">
                  <div className="bb">
                    <p>직접 실행한 CLI나 믿을 수 있는 봇이 보여 준 코드인지 확인하세요. 승인하면 그 CLI가 30일 동안 내 이름과 관리자 권한으로 동작합니다.</p>
                  </div>
                </div>
                <div className="actrow">
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void review(true)}>
                    승인
                  </button>
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => void review(false)}>
                    거절
                  </button>
                </div>
              </>
            ) : (
              <p>
                이미 {login.status === "approved" ? "승인" : "거절"}된 요청입니다{login.reviewedBy ? " (" + login.reviewedBy + ")" : ""}.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
