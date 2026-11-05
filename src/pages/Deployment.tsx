import { useState } from "react";
import { deploymentRank } from "../api/hooks";
import { isFinalDeploymentStatus } from "../api/sse";
import type { Deployment, DeploymentEvent, DeploymentStatus } from "../api/types";
import { DEPLOY_LABEL, DeployChip, EnvChip, ExtLink, elapsedSec, ms, short, TRIGGER_LABEL } from "../components/deploy";
import { envName } from "../components/shared";
import { LoadError, LogBox, PageHead, ProgItem, Skeleton, Table, td } from "../components/ui";
import { instancesOf, useLiveDeployment, useSimDeployment, type DeploymentModel } from "../data/deploy";
import { useLive } from "../data/live";
import { dur, mmss, type StepState } from "../sim/format";
import type { LogLine } from "../sim/state";

/** The goal from push to healthy. */
const GOAL_SEC = 300;
const PHASES: DeploymentStatus[] = ["queued", "building", "committing", "syncing"];
const STEP_NAME: Record<string, string> = { queued: "대기열", building: "빌드", committing: "커밋", syncing: "동기화" };

export function DeploymentPage({ id }: { id: string }) {
  return useLive() ? <LiveDeployment id={id} /> : <SimDeployment id={id} />;
}
function LiveDeployment({ id }: { id: string }) {
  return <DeploymentView m={useLiveDeployment(id)} />;
}
function SimDeployment({ id }: { id: string }) {
  return <DeploymentView m={useSimDeployment(id)} />;
}

/** When each phase started: the first phase (or done) event that entered it. */
function phaseStarts(events: DeploymentEvent[]): Partial<Record<DeploymentStatus, string>> {
  const out: Partial<Record<DeploymentStatus, string>> = {};
  for (const e of events) if ((e.type === "phase" || e.type === "done") && e.phase && !out[e.phase]) out[e.phase] = e.time;
  return out;
}

/** Index in PHASES of the phase the deployment is in, or stopped in. */
function reached(d: Deployment, starts: Partial<Record<DeploymentStatus, string>>): number {
  if (!isFinalDeploymentStatus(d.status)) return deploymentRank(d.status);
  if (d.status === "healthy") return PHASES.length;
  let k = 0;
  PHASES.forEach((p, i) => {
    if (starts[p]) k = i;
  });
  return k;
}

function logText(e: DeploymentEvent): string {
  if (e.type === "log") return e.message ?? "";
  const tag = e.type === "environment" ? envName(e.env ?? "") : e.phase ? DEPLOY_LABEL[e.phase] : e.type;
  return "[" + tag + "] " + (e.message ?? "");
}

const ERROR_LINE = /\b(error|failed|fatal|denied)\b|실패|오류/i;

/** The line to point at when a deployment failed: the first error line of the failed phase, else its last log line. */
function failedLine(events: DeploymentEvent[], phase: DeploymentStatus): number | undefined {
  const idx = events.map((e, i) => [e, i] as const).filter(([e]) => e.type === "log");
  const inPhase = idx.filter(([e]) => e.phase === phase);
  const pick = inPhase.find(([e]) => ERROR_LINE.test(e.message ?? "")) ?? inPhase.at(-1) ?? idx.find(([e]) => ERROR_LINE.test(e.message ?? "")) ?? idx.at(-1);
  return pick?.[1];
}

function DeploymentView({ m }: { m: DeploymentModel }) {
  const [follow, setFollow] = useState(true);
  const d = m.deployment;
  if (!d) {
    return (
      <div className="page">
        <PageHead title={m.notFound ? "배포를 찾을 수 없습니다" : "배포"} />
        {m.notFound ? (
          <p className="hint">지워진 앱의 배포이거나 주소가 틀렸습니다.</p>
        ) : m.error ? (
          <LoadError title="배포를 불러오지 못했습니다." error={m.error} />
        ) : (
          <Skeleton box />
        )}
      </div>
    );
  }
  const final = isFinalDeploymentStatus(d.status);
  const starts = phaseStarts(m.events);
  const k = reached(d, starts);
  const elapsed = elapsedSec(d, m.now);
  const at = (t: string) => mmss((ms(t) - ms(d.createdAt)) / 1000);
  // A server from before ADR 0015 names no instance: the deployment is the app's default one.
  const instance = d.instance || d.app;
  // The instance's own URL. The app's URL is the default instance's, so it stands in only for that one.
  const inst = instancesOf(m.app).find((i) => i.name === instance);
  const url = (inst ? inst.url : instance === d.app ? m.app?.deploy?.url : undefined) ?? d.environments.find((e) => e.url)?.url;
  const envNames = d.environments.map((e) => envName(e.env)).join(", ");
  const stopped = PHASES[Math.min(k, PHASES.length - 1)];

  const counter =
    d.status === "healthy"
      ? "4/4 완료"
      : k + 1 + "/4 " + STEP_NAME[stopped] + (d.status === "failed" ? "에서 실패" : d.status === "superseded" ? "에서 멈춤" : "");

  const phaseRow = (p: DeploymentStatus, i: number) => {
    let st: StepState = "wait";
    let right = "대기";
    if (i < k) {
      // A phase ended when the next one started; the last one when the deployment did.
      const end = starts[PHASES[i + 1]] ?? (i === PHASES.length - 1 ? d.finishedAt : undefined);
      st = "ok";
      right = end ? at(end) : "완료";
    } else if (i === k && !final) {
      st = "run";
      right = "진행 중";
    } else if (i === k && d.status === "failed") {
      st = "bad";
      right = "실패";
    } else if (i === k && d.status === "superseded") {
      right = "멈춤";
    }
    const sub: Record<string, string> = {
      queued: "배포 실행기가 가져가기를 기다립니다",
      building:
        d.trigger === "redeploy"
          ? "빌드하지 않고 마지막 정상 배포의 이미지를 다시 씁니다"
          : d.images.length
            ? d.images.map((x) => x.service).join(", ") + " 이미지, digest로 고정"
            : "서비스마다 이미지를 빌드합니다" + (d.buildId ? " (" + d.buildId + ")" : ""),
      committing: "gitops 저장소에 apps/" + instance + "/<환경>.yaml을 씁니다",
      syncing: "Argo CD가 환경 " + d.environments.length + "곳에 동시에 적용합니다",
    };
    return <ProgItem key={p} st={st} title={DEPLOY_LABEL[p]} sub={sub[p]} right={right} />;
  };
  const endRow =
    d.status === "healthy" ? (
      <ProgItem st="ok" title="정상" sub="모든 환경이 Synced, Healthy" right={mmss(elapsed)} />
    ) : d.status === "failed" ? (
      <ProgItem st="bad" title="실패" sub={d.error ?? "배포가 멈췄습니다"} right={mmss(elapsed)} />
    ) : d.status === "superseded" ? (
      <ProgItem st="wait" title="대체됨" sub="같은 인스턴스의 새 배포가 생겨서 멈췄습니다" right={mmss(elapsed)} />
    ) : (
      <ProgItem st="wait" title="정상 확인" sub="모든 환경이 Synced, Healthy가 되면 끝납니다" right="대기" />
    );

  const lines: LogLine[] = m.events.map((e) => [at(e.time), logText(e)]);
  const mark = d.status === "failed" ? failedLine(m.events, stopped) : undefined;

  return (
    <div className="page">
      <PageHead
        title={instance + " 배포"}
        sub={
          <>
            {d.branch && <>{d.branch} 브랜치, </>}
            {d.trigger === "redeploy" ? "빌드 없이 재배포" : TRIGGER_LABEL[d.trigger] + " 배포"}, {d.ref !== d.branch && d.ref + " "}
            <span className="m">{short(d.commit)}</span>, {d.triggeredBy}, <span className="m">{d.id}</span>
          </>
        }
        crumb={
          <>
            <a href="#apps">앱</a> / <a href={"#app-" + d.app}>{d.app}</a>
          </>
        }
      />
      {m.live && !final && !m.connected && m.error && (
        <div className="box fillbox" role="status">
          <div className="bb">
            <p>실시간 연결이 끊겨 다시 연결하는 중입니다: {m.error}</p>
          </div>
        </div>
      )}
      {d.status === "healthy" && (
        <div className="box okbox" role="status">
          <div className="bb">
            <b>배포 완료: {dur(elapsed)}</b>
            <p>
              {envNames}에서 {instance}이(가) 실행 중입니다.{" "}
              {elapsed <= GOAL_SEC ? "목표 5분 안에 끝났습니다." : "목표 5분보다 " + dur(elapsed - GOAL_SEC) + " 더 걸렸습니다."}
            </p>
            {url && (
              <p>
                공개 주소: <ExtLink href={url} />
              </p>
            )}
            <div className="actrow">
              <a className="btn primary" href={"#app-" + d.app}>
                앱 보기
              </a>
              <a className="btn ghost" href="#new">
                다른 레포 배포
              </a>
            </div>
          </div>
        </div>
      )}
      {d.status === "failed" && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <b>배포 실패: {DEPLOY_LABEL[stopped]} 단계</b>
            <p>{d.error ?? "배포 실행기가 이유를 남기지 않았습니다."}</p>
            <div className="actrow">
              <a className="btn" href={"#app-" + d.app}>
                앱 보기
              </a>
            </div>
          </div>
        </div>
      )}
      {d.status === "superseded" && (
        <div className="box fillbox" role="status">
          <div className="bb">
            <b>이 배포는 대체되었습니다.</b>
            <p>같은 인스턴스의 새 배포가 생겨서 멈췄고, gitops에는 새 배포만 커밋합니다.</p>
            <div className="actrow">
              <a className="btn" href={"#app-" + d.app}>
                앱 보기
              </a>
            </div>
          </div>
        </div>
      )}
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>진행 상황</b>
            <span className="chips">
              <span className="hint">{counter}</span>
              <DeployChip s={d.status} />
            </span>
          </div>
          <ul className="prog">
            {PHASES.map(phaseRow)}
            {endRow}
          </ul>
        </div>
        <div className="box">
          <div className="bh">
            <b>경과 시간</b>
            <span className="hint">목표 {mmss(GOAL_SEC)}</span>
          </div>
          <div className="bb">
            <div className="timer">
              <span className="big" aria-label={(final ? "최종 경과 시간 " : "경과 시간 ") + dur(elapsed)}>
                {mmss(elapsed)}
              </span>
              <div
                className="bar"
                role="progressbar"
                aria-label="목표 시간 대비 경과"
                aria-valuemin={0}
                aria-valuemax={GOAL_SEC}
                aria-valuenow={Math.round(Math.min(elapsed, GOAL_SEC))}
                aria-valuetext={mmss(elapsed) + " / " + mmss(GOAL_SEC)}
              >
                <i style={{ transform: "scaleX(" + Math.min(1, elapsed / GOAL_SEC) + ")" }} />
              </div>
              <small className="hint">{final ? "배포를 만든 때부터 " + DEPLOY_LABEL[d.status] + "까지" : "배포를 만든 때부터"}</small>
            </div>
            <Table
              head={["환경", "상태", "Argo CD"]}
              rows={d.environments.map((e) => [
                td(envName(e.env), "nw"),
                td(<EnvChip s={e.status} />, "nw"),
                td(
                  <>
                    <span className="m">{[e.syncStatus, e.healthStatus].filter(Boolean).join(", ") || "-"}</span>
                    {(e.message || e.url) && <small className="block">{e.url ? <ExtLink href={e.url} /> : e.message}</small>}
                  </>,
                ),
              ])}
            />
          </div>
        </div>
      </div>
      <section className="sec">
        <div className="sech">
          <h2>빌드와 배포 로그</h2>
          <button type="button" className="btn ghost" aria-pressed={!follow} onClick={() => setFollow(!follow)}>
            {follow ? "자동 스크롤 멈춤" : "자동 스크롤 켜기"}
          </button>
        </div>
        {d.status === "failed" && (
          <p className="logsum">
            {DEPLOY_LABEL[stopped]} 단계에서 실패했습니다: {d.error ?? "이유 없음"}
          </p>
        )}
        <LogBox lines={lines} follow={follow} mark={mark} empty={final ? "기록이 없습니다." : "첫 기록을 기다리는 중입니다."} />
      </section>
    </div>
  );
}
