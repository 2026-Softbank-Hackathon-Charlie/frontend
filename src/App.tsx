import { Chip } from "./components/ui";
import { AppDetail, Apps } from "./pages/Apps";
import { DesignSystem } from "./pages/DesignSystem";
import { Envs } from "./pages/Envs";
import { Migrate, MigrateList } from "./pages/Migrate";
import { NewApp } from "./pages/NewApp";
import { Onboard } from "./pages/Onboard";
import { Overview } from "./pages/Overview";
import { Routes } from "./pages/Routes";
import { navCurrent, navigate, useRoute } from "./router";
import { migActive, migLabel } from "./sim/state";
import { useSim } from "./sim/store";

function Page({ r }: { r: string }) {
  if (r === "apps") return <Apps />;
  if (r.startsWith("app-")) return <AppDetail id={r.slice(4)} />;
  if (r === "new") return <NewApp />;
  if (r === "onboard") return <Onboard />;
  if (r === "migrate") return <MigrateList />;
  if (r === "migrate-shop") return <Migrate />;
  if (r === "routes") return <Routes />;
  if (r === "envs") return <Envs />;
  if (r === "design-system") return <DesignSystem />;
  return <Overview />;
}

function SideNav({ r }: { r: string }) {
  const { S } = useSim();
  const c = navCurrent(r);
  const busyApps = S.dep.phase === "run" || S.onb.run;
  const items: [string, string, string][] = [
    ["overview", "개요", ""],
    ["apps", "앱", busyApps ? "진행 중" : ""],
    ["migrate", "이전", migActive(S) ? migLabel(S) : ""],
    ["routes", "경로별 결과", ""],
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

export function App() {
  const r = useRoute();
  const { reset } = useSim();
  return (
    <>
      <div className="banner gut">
        <div className="in">
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
            <span className="user">운영자</span>
          </div>
        </div>
      </header>
      <div className="gut">
        <div className="in shell">
          <SideNav r={r} />
          <main id="main">
            {/* keyed by route so the enter animation replays on navigation only, not on every tick */}
            <Page key={r} r={r} />
          </main>
        </div>
      </div>
    </>
  );
}
