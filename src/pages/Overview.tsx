import { useAudit, useRuns } from "../api/hooks";
import { AppsList } from "../components/deploy";
import { EnvGrid, envName, RoutesTable } from "../components/shared";
import { Ind, PageHead } from "../components/ui";
import { useLiveApps, useSimApps, type AppsModel } from "../data/deploy";
import { errorText, useLive } from "../data/live";
import { statusText } from "../sim/mig";
import { running } from "../sim/state";
import { useSim } from "../sim/store";

export function Overview() {
  const live = useLive();
  return (
    <div className="page">
      <PageHead
        title="개요"
        sub="team-charlie 프로젝트의 클러스터, 앱, 이전 결과입니다."
        acts={
          <>
            <a className="btn ghost" href="#new">
              새 앱 배포
            </a>
            <a className="btn primary" href="#migrate-app">
              이전하기
            </a>
          </>
        }
      />
      {live ? <LiveRunning /> : <SimRunning />}
      <section className="sec">
        <h2>클러스터</h2>
        <EnvGrid />
      </section>
      <section className="sec">
        <div className="sech">
          <h2>경로별 결과</h2>
          <a className="more" href="#routes">
            자세히
          </a>
        </div>
        <RoutesTable />
      </section>
      <section className="sec">
        <div className="sech">
          <h2>앱</h2>
          <a className="more" href="#apps">
            전체 보기
          </a>
        </div>
        {live ? <LiveApps /> : <SimApps />}
      </section>
      <section className="sec">
        <h2>최근 활동</h2>
        {live ? <LiveActivity /> : <SimActivity />}
      </section>
    </div>
  );
}

function RunningList({ items }: { items: [string, string][] }) {
  if (items.length === 0) return null;
  return (
    <section className="sec">
      <h2>진행 중인 작업</h2>
      <div className="box">
        <ul className="rows">
          {items.map((r) => (
            <li key={r[0]}>
              <Ind st="run" />
              <span className="grow">{r[0]}</span>
              <a className="more" href={r[1]}>
                열기
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SimRunning() {
  const { S } = useSim();
  return <RunningList items={running(S)} />;
}

function LiveRunning() {
  const runs = useRuns(5_000);
  const active = (runs.data ?? []).filter((r) => r.status === "running" || r.status === "awaiting_switch");
  return <RunningList items={active.map((r) => [r.runId + " (" + envName(r.source.env) + " → " + envName(r.target.env) + "): " + statusText(r.status, r.phase), "#migrate-app"])} />;
}

function AppsBrief({ m }: { m: AppsModel }) {
  if (m.error) return <p className="hint">앱을 불러오지 못했습니다: {m.error}</p>;
  return <AppsList apps={m.apps ?? []} now={m.now} busy={m.busy} full={false} />;
}
function LiveApps() {
  return <AppsBrief m={useLiveApps()} />;
}
function SimApps() {
  return <AppsBrief m={useSimApps()} />;
}

function SimActivity() {
  const { S } = useSim();
  return (
    <div className="box">
      <ul className="rows">
        {S.act.slice(0, 6).map((a, i) => (
          <li key={i}>
            <span className="when">{a[0]}</span>
            <span className="grow">{a[1]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveActivity() {
  const audit = useAudit(6);
  if (audit.error && !audit.data) return <p className="hint">감사 로그를 불러오지 못했습니다: {errorText(audit.error)}</p>;
  return (
    <div className="box">
      <ul className="rows">
        {(audit.data ?? []).map((a) => (
          <li key={a.id}>
            <span className="when">{new Date(a.time).toLocaleString("ko-KR")}</span>
            <span className="grow">
              {a.actor} ({a.role}): {a.action} {a.target} → {a.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
