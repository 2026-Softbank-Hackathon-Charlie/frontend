import { useState } from "react";
import { Chip } from "./components/ui";
import { apiTarget, connect, disconnect, useLive } from "./data/live";
import { Agents } from "./pages/Agents";
import { AppDetail, appFilterOf, Apps } from "./pages/Apps";
import { DeploymentPage } from "./pages/Deployment";
import { DesignSystem } from "./pages/DesignSystem";
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
  if (r.startsWith("app-")) return <AppDetail id={r.slice(4)} />;
  if (r.startsWith("deploy-")) return <DeploymentPage id={r.slice(7)} />;
  if (r === "new") return <NewApp />;
  if (r === "onboard") return <Onboard />;
  if (r === "migrate") return <MigrateList />;
  if (r === "migrate-shop") return <Migrate />;
  if (r === "routes") return <Routes />;
  if (r === "agents") return <Agents />;
  if (r === "security") return <Security />;
  if (r === "envs") return <Envs />;
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

function Connect() {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const [token, setTokenText] = useState("");
  const [keep, setKeep] = useState(false);
  if (live) {
    return (
      <button type="button" className="btn ghost" onClick={disconnect}>
        API 연결 끊기
      </button>
    );
  }
  return (
    <div className="connect">
      <button type="button" className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        API 연결
      </button>
      {open && (
        <form
          className="connectpanel box"
          onSubmit={(e) => {
            e.preventDefault();
            if (!token.trim()) return;
            connect(token, keep);
            setTokenText("");
            setOpen(false);
          }}
        >
          <div className="bb">
            <p className="hint">서버: {apiTarget()}</p>
            <div className="field">
              <label htmlFor="api-token">토큰 (viewer 또는 operator)</label>
              <input id="api-token" type="password" autoComplete="off" value={token} onChange={(e) => setTokenText(e.target.value)} />
            </div>
            <label className="check">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> 이 탭을 새로고침해도 유지 (공용 PC에서는 끄기)
            </label>
            <div className="actrow">
              <button type="submit" className="btn primary" disabled={!token.trim()}>
                연결
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

export function App() {
  const r = useRoute();
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
            HopCharlie
          </a>
          <span className="org">team-charlie</span>
          <div className="acts">
            <a className="btn ghost" href="#onboard">
              기존 앱 가져오기
            </a>
            <a className="btn ghost" href="#new">
              새 앱 배포
            </a>
            <a className="btn primary" href="#migrate-shop">
              이전하기
            </a>
            <Connect />
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
