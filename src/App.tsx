import { useEffect } from "react";
import { Icon, type IconName } from "./components/Icon";
import { Chip, type ChipKind } from "./components/ui";
import { chooseMode, logOut, useAuth, useLive } from "./data/live";
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
import { appRoute, navCurrent, navigate, useRoute } from "./router";
import { activeDeployments } from "./sim/deploy";
import { migActive, migLabel } from "./sim/state";
import { useSim } from "./sim/store";

function Page({ r }: { r: string }) {
  if (r === "apps" || r.startsWith("apps-")) return <Apps filter={appFilterOf(r)} />;
  // keyed by app, so one app's half-filled forms and confirmations do not carry over to another; its tabs keep the page
  if (r.startsWith("app-")) {
    const { name, tab } = appRoute(r);
    return <AppDetail key={name} id={name} tab={tab} />;
  }
  if (r.startsWith("deploy-")) return <DeploymentPage id={r.slice(7)} />;
  if (r === "new") return <NewApp />;
  if (r === "onboard") return <Onboard />;
  if (r.startsWith("onboard-")) return <Onboard id={r.slice("onboard-".length)} />;
  if (r === "migrate") return <MigrateList />;
  if (r === "migrate-app") return <Migrate />;
  if (r === "routes") return <Routes />;
  if (r === "agents") return <Agents />;
  if (r === "security" || r.startsWith("security/")) return <Security route={r} />;
  if (r === "envs") return <Envs />;
  if (r === "device") return <DevicePage />;
  if (r === "design-system") return <DesignSystem />;
  return <Overview />;
}

/** One side-nav entry: route key, label and an optional status badge. */
type NavItem = [string, string, { kind: ChipKind; text: string } | null];

/** Section names for the top bar, by side-nav entry. */
const NAV_LABEL: Record<string, string> = {
  overview: "개요",
  apps: "앱",
  migrate: "이전",
  routes: "이전 결과",
  agents: "AI 활동",
  security: "보안",
  envs: "환경",
  device: "CLI 연결",
  "design-system": "디자인 시스템",
};

const NAV_ICON: Record<string, IconName> = {
  overview: "layout-dashboard",
  apps: "boxes",
  migrate: "arrow-right-left",
  routes: "route",
  agents: "bot",
  security: "shield-check",
  envs: "server",
  device: "terminal",
};

function SimSideNav({ r }: { r: string }) {
  const { S } = useSim();
  const busyApps = activeDeployments(S.deploy).length > 0 || S.onb.run;
  const waiting = S.mig.stage === "review" || S.mig.run?.status === "awaiting_switch";
  return (
    <SideNav
      r={r}
      apps={busyApps ? { kind: "run", text: "진행 중" } : null}
      migrate={migActive(S) ? { kind: waiting ? "warn" : "run", text: migLabel(S) } : null}
    />
  );
}

// Live navigation doesn't fetch extra data for sidebar badges.
function LiveSideNav({ r }: { r: string }) {
  return <SideNav r={r} apps={null} migrate={null} device />;
}

/** Grouped side menu: overview, then work, results and infrastructure. Badges carry live state. */
function SideNav({ r, apps, migrate, device }: { r: string; apps: NavItem[2]; migrate: NavItem[2]; device?: boolean }) {
  const c = navCurrent(r);
  const groups: [string | null, NavItem[]][] = [
    [null, [["overview", NAV_LABEL.overview, null]]],
    [
      "작업",
      [
        ["apps", NAV_LABEL.apps, apps],
        ["migrate", NAV_LABEL.migrate, migrate],
      ],
    ],
    [
      "결과",
      [
        ["routes", NAV_LABEL.routes, null],
        ["agents", NAV_LABEL.agents, null],
      ],
    ],
    [
      "인프라",
      [
        ["envs", NAV_LABEL.envs, null],
        ["security", NAV_LABEL.security, null],
      ],
    ],
  ];
  if (device) groups.push(["설정", [["device", NAV_LABEL.device, null]]]);
  return (
    <div className="side">
      <a className="brand" href="#overview">
        <img src="/brand/lockup-header.png" alt="HopCharlie" width={169} height={36} />
      </a>
      <nav aria-label="주 메뉴">
        {groups.map(([title, items], i) => (
          <div className="navgrp" key={i}>
            {title && <div className="grp">{title}</div>}
            <ul>
              {items.map(([k, label, badge]) => (
                <li key={k}>
                  <a href={"#" + k} aria-current={k === c ? "page" : undefined}>
                    <span className="lbl icon-label">
                      <Icon name={NAV_ICON[k]} />
                      <span>{label}</span>
                    </span>
                    {badge && (
                      <>
                        {" "}
                        <Chip kind={badge.kind}>{badge.text}</Chip>
                      </>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

/** Mode notice, account and mode switch in the top bar. Switching modes keeps the session. */
function Account({ r }: { r: string }) {
  const { mode, session } = useAuth();
  const { reset } = useSim();
  if (mode !== "live" || !session) {
    return (
      <>
        <span className="note">시연용 화면입니다. 데이터는 가상이고 실제보다 빠르게 진행됩니다.</span>
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
        <button type="button" className="btn ghost sm" onClick={() => chooseMode("live")}>
          일반 모드로 전환
        </button>
      </>
    );
  }
  return (
    <>
      <span className="user">{session.principal.name}</span>
      <button type="button" className="btn ghost sm" onClick={() => void logOut()}>
        로그아웃
      </button>
      <button
        type="button"
        className="mode-switch"
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
  const live = useLive();
  const sec = NAV_LABEL[navCurrent(r)] ? navCurrent(r) : "overview";
  return (
    <div className="layout">
      {/* a way past the side menu; the hash is the route, so it moves focus instead of following #main */}
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      {live ? <LiveSideNav r={r} /> : <SimSideNav r={r} />}
      <div className="col">
        <header className="top">
          <div className="crumbs">
            <span>team-charlie</span>
            <span aria-hidden="true">/</span>
            {/* below a section's own page (an app, a deployment, the migration) its name leads back there */}
            {r === sec ? <b>{NAV_LABEL[sec]}</b> : <a href={"#" + sec}>{NAV_LABEL[sec]}</a>}
          </div>
          <div className="acts">
            <Account r={r} />
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {/* keyed by route so the enter animation replays on navigation only, not on every tick; app list filters and app tabs keep the page */}
          <Page key={r.startsWith("apps") ? "apps" : r.split("/")[0]} r={r} />
        </main>
      </div>
    </div>
  );
}
