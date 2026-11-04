// Full-page screens shown instead of the console: the mode choice on a first visit and the administrator login.
import { useState, type FormEvent } from "react";
import { apiTarget, chooseMode, logIn, loginErrorText, useAuth } from "../data/live";
import { navigate } from "../router";

function Brand() {
  return <img className="entry-brand" src="/brand/lockup-header.png" alt="HopCharlie" width={188} height={40} />;
}

export function ModeChoice() {
  return (
    <main className="entry gut">
      <Brand />
      <div className="entry-head">
        <h1>어떤 화면으로 시작할까요?</h1>
        <p>나중에 화면 위쪽 버튼으로 언제든 바꿀 수 있습니다.</p>
      </div>
      <div className="choices">
        <section className="box" aria-labelledby="mode-demo">
          <div className="bb">
            <h2 id="mode-demo">데모 모드</h2>
            <p>가상 데이터로 이전과 배포 흐름을 보여 줍니다. 로그인하지 않으며 진행 속도는 실제보다 빠릅니다. 시연할 때 씁니다.</p>
            <div className="actrow">
              <button type="button" className="btn ghost" onClick={() => chooseMode("demo")}>
                데모 모드로 시작
              </button>
            </div>
          </div>
        </section>
        <section className="box" aria-labelledby="mode-live">
          <div className="bb">
            <h2 id="mode-live">일반 모드</h2>
            <p>실제 플랫폼 API에 연결해 운영 중인 앱과 이전을 다룹니다. 관리자 계정으로 로그인해야 합니다.</p>
            <div className="actrow">
              <button type="button" className="btn primary" onClick={() => chooseMode("live")}>
                일반 모드로 시작
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

/** `device`: shown for #device, where approving a CLI login needs an administrator. */
export function Login({ device = false }: { device?: boolean }) {
  const { notice } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const can = !busy && username.trim() !== "" && password !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    setError(undefined);
    try {
      await logIn(username.trim(), password);
      // logged in: the console replaces this screen
    } catch (err) {
      setError(loginErrorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="entry gut">
      <Brand />
      <div className="entry-col">
        {notice && (
          <div className="box fillbox" role="status">
            <div className="bb">
              <p>{notice}</p>
            </div>
          </div>
        )}
        <form className="box" onSubmit={submit} aria-labelledby="login-title">
          <div className="bh">
            <b id="login-title">관리자 로그인</b>
          </div>
          <div className="bb">
            {device && <p>CLI 로그인을 승인하려면 관리자로 로그인해야 합니다.</p>}
            <div className="field">
              <label htmlFor="login-username">아이디</label>
              <input id="login-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="login-password">비밀번호</label>
              <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && (
              <p className="entry-err" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn primary" disabled={!can}>
              {busy ? "로그인하는 중" : "로그인"}
            </button>
            <p className="hint">서버: {apiTarget()}</p>
          </div>
        </form>
        <button
          type="button"
          className="linkbtn"
          onClick={() => {
            chooseMode("demo");
            if (device) navigate("#overview");
          }}
        >
          로그인하지 않고 데모 모드로 보기
        </button>
      </div>
    </main>
  );
}
