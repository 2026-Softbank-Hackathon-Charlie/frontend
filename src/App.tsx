import { useEffect } from "react";
import { Chip } from "./components/ui";
import { apiTarget, chooseMode, logOut, useAuth, useLive } from "./data/live";
import { Agents } from "./pages/Agents";
import { AppDetail, appFilterOf, Apps } from "./pages/Apps";
import { DeploymentPage } from "./pages/Deployment";
import { DesignSystem } from "./pages/DesignSystem";
import { DevicePage } from "./pages/Device";
import { Login, ModeChoice } from "./pages/Entry";
import { Envs } from "./pages/Envs";
import { Migrate, MigrateList } from "./pages/Migrate";
import { NewApp } from "./pages/NewApp";
import { Onboard } from "./pages/Onboard";
import { Overview } from "./pages/Overview";
import { Routes } from "./pages/Routes";
import { Security } from "./pages/Security";
import { navCurrent, navigate, useRoute } from "./router";
import { activeDeployments } from "./sim/deploy";
import { migActive, migLabel } from "./sim/state";
import { useSim } from "./sim/store";

function Page({ r }: { r: string }) {
  if (r === "apps" || r.startsWith("apps-")) return <Apps filter={appFilterOf(r)} />;
  // keyed, so one app's half-filled forms and confirmations do not carry over to another
  if (r.startsWith("app-")) return <AppDetail key={r} id={r.slice(4)} />;
  if (r.startsWith("deploy-")) return <DeploymentPage id={r.slice(7)} />;
  if (r === "new") return <NewApp />;
  if (r === "onboard") return <Onboard />;
  if (r === "migrate") return <MigrateList />;
  if (r === "migrate-app") return <Migrate />;
  if (r === "routes") return <Routes />;
  if (r === "agents") return <Agents />;
  if (r === "security") return <Security />;
  if (r === "envs") return <Envs />;
  if (r === "device") return <DevicePage />;
  if (r === "design-system") return <DesignSystem />;
  return <Overview />;
}

function SideNav({ r }: { r: string }) {
  const { S } = useSim();
  const c = navCurrent(r);
  const live = useLive();
  const busyApps = !live && (activeDeployments(S.deploy).length > 0 || S.onb.run);
  const items: [string, string, string][] = [
    ["overview", "개요", ""],
    ["apps", "앱", busyApps ? "진행 중" : ""],
    ["migrate", "이전", !live && migActive(S) ? migLabel(S) : ""],
    ["routes", "경로별 결과", ""],
    ["agents", "AI 활동", ""],
    ["security", "보안", ""],
    ["envs", "환경", ""],
  ];
  if (live) items.push(["device", "CLI 연결", ""]);
  return (
    <nav className="side" aria-label="주 메뉴">
      <ul>
        {items.map(([k, label, badge]) => (
          <li key={k}>
            <a href={"#" + k} aria-current={k === c ? "page" : undefined}>
              <span className="lbl">{label}</span>
              {badge && (
                <>
                  {" "}
                  <Chip kind="run">{badge}</Chip>
                </>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Account and mode switch in the header. Switching modes keeps the session. */
function Account({ r }: { r: string }) {
  const { mode, session } = useAuth();
  if (mode !== "live" || !session) {
    return (
      <button type="button" className="btn ghost" onClick={() => chooseMode("live")}>
        일반 모드로 전환
      </button>
    );
  }
  return (
    <>
      <span className="user">{session.principal.name}</span>
      <button type="button" className="btn ghost" onClick={() => void logOut()}>
        로그아웃
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          // #device is live only: staying there would switch straight back
          if (r === "device") navigate("#overview");
          chooseMode("demo");
        }}
      >
        데모 모드로 전환
      </button>
    </>
  );
}

/**
 * Picks the screen: the mode choice on a first visit, the login in live mode
 * without a session, the console otherwise. #device always needs a login,
 * whatever the mode, and logging in there switches to live mode.
 */
export function App() {
  const r = useRoute();
  const { mode, session } = useAuth();
  // Opened #device in demo mode while still logged in: no new login is needed, only live mode.
  const toLive = r === "device" && session !== null && mode !== "live";
  useEffect(() => {
    if (toLive) chooseMode("live");
  }, [toLive]);
  if (r === "device" && !session) return <Login device />;
  if (!mode) return <ModeChoice />;
  if (mode === "live" && !session) return <Login />;
  return <Console r={r} />;
}

function Console({ r }: { r: string }) {
  const { reset } = useSim();
  const live = useLive();
  return (
    <>
      <div className="banner gut">
        <div className="in">
          {live ? (
            <span>실제 플랫폼 API({apiTarget()})에 연결되어 있습니다. 기존 앱 가져오기 화면은 아직 시연용입니다.</span>
          ) : (
            <>
              <span>시연용 화면입니다. 데이터는 모두 가상이고, 진행 속도는 실제보다 빠릅니다.</span>
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  reset();
                  navigate("#overview");
                }}
              >
                처음 상태로 되돌리기
              </button>
            </>
          )}
        </div>
      </div>
      <header className="top gut">
        <div className="in">
          <a className="brand" href="#overview">
            <img src="/brand/lockup-header.png" alt="HopCharlie" width={188} height={40} />
          </a>
          <span className="org">team-charlie</span>
          <div className="acts">
            <a className="btn ghost" href="#onboard">
              기존 앱 가져오기
            </a>
            <a className="btn ghost" href="#new">
              새 앱 배포
            </a>
            <a className="btn primary" href="#migrate-app">
              이전하기
            </a>
            <Account r={r} />
          </div>
        </div>
      </header>
      <div className="gut">
        <div className="in shell">
          <SideNav r={r} />
          <main id="main">
            {/* keyed by route so the enter animation replays on navigation only, not on every tick; app list filters keep the page */}
            <Page key={r.startsWith("apps") ? "apps" : r} r={r} />
          </main>
        </div>
      </div>
    </>
  );
}
