import { useEffect, useRef, type ReactNode } from "react";
import { useEnvironments, useMatrix } from "../api/hooks";
import type { Environment, MatrixRoute, Run, RunStatus } from "../api/types";
import { errorText, useLive } from "../data/live";
import { navigate } from "../router";
import { ENV, ENV_ORDER, SAMPLE, envKeyOf, type EnvKey } from "../sim/data";
import { dur, fmt } from "../sim/format";
import { matrixRoutes, statusText } from "../sim/mig";
import { appsIn, migActive } from "../sim/state";
import { useSim } from "../sim/store";
import { Chip, LoadError, Skeleton, Table, td, type ChipKind } from "./ui";

/** Display name for a platform environment name (eks → AWS EKS). */
export function envName(name: string, envs?: Environment[]): string {
  const live = envs?.find((e) => e.name === name);
  if (live) return live.displayName;
  const k = envKeyOf(name);
  return k ? ENV[k].name : name;
}

function envShort(name: string): string {
  const k = envKeyOf(name);
  return k ? ENV[k].short : name;
}

export function EnvGrid() {
  const live = useLive();
  return live ? <LiveEnvGrid /> : <SimEnvGrid />;
}

/** One cluster: name and state, a location line and three small figures. */
function EnvCard({ name, chip, loc, figs, note }: { name: string; chip: ReactNode; loc: string; figs: [string, ReactNode][]; note?: string }) {
  return (
    <div className="box envcard">
      <div className="cellh">
        <b>{name}</b>
        {chip}
      </div>
      <span className="hint">{loc}</span>
      <dl className="figs">
        {figs.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="hint">{note}</p>}
    </div>
  );
}

function SimEnvGrid() {
  const { S } = useSim();
  return (
    <div className="envcards">
      {ENV_ORDER.map((k) => {
        const e = ENV[k];
        return (
          <EnvCard
            key={k}
            name={e.name}
            chip={<Chip kind="ok">정상</Chip>}
            loc={e.region + ", 노드 " + e.nodes + "대, Kubernetes " + e.k8s}
            figs={[
              ["앱", appsIn(S, k)],
              ["파일 저장소", e.storage],
              ["사설망", "연결됨"],
            ]}
          />
        );
      })}
    </div>
  );
}

function dbCount(e: Environment): string {
  const dbs = e.status.databases;
  if (!dbs) return "-";
  const ready = dbs.filter((d) => d.readyInstances >= d.instances).length;
  return ready === dbs.length ? dbs.length + "개" : ready + "/" + dbs.length + "개 준비";
}

function LiveEnvGrid() {
  const envs = useEnvironments(10_000);
  if (envs.error && !envs.data) return <LoadError title="클러스터 상태를 불러오지 못했습니다." error={errorText(envs.error)} retry={envs.reload} />;
  if (!envs.data) return <Skeleton box />;
  return (
    <div className="envcards">
      {envs.data.map((e) => (
        <EnvCard
          key={e.name}
          name={e.displayName}
          chip={<Chip kind={e.status.reachable ? "ok" : "bad"}>{e.status.reachable ? "정상" : "연결 안 됨"}</Chip>}
          loc={[e.region ?? "위치 정보 없음", e.status.kubernetesVersion ? "Kubernetes " + e.status.kubernetesVersion : ""].filter(Boolean).join(", ")}
          figs={[
            ["노드", e.status.nodes ? e.status.nodes.ready + "/" + e.status.nodes.total : "-"],
            ["DB", dbCount(e)],
            ["트래픽", e.live ? "쓰기 받음" : "대기"],
          ]}
          note={e.status.error}
        />
      ))}
    </div>
  );
}

export const RESULT_KIND: Record<string, ChipKind> = { succeeded: "ok", running: "run", awaiting_switch: "warn", halted: "bad", failed: "bad", interrupted: "bad" };
/** A run's state in a word or two, for chips and matrix cells. */
export const RUN_SHORT: Record<RunStatus, string> = {
  succeeded: "성공",
  running: "진행 중",
  awaiting_switch: "전환 대기",
  rolled_back: "원복됨",
  halted: "정지",
  failed: "실패",
  aborted: "중단됨",
  interrupted: "멈춤",
};

function useSimRoutes(): MatrixRoute[] {
  const { S } = useSim();
  const envs = ENV_ORDER.map((k) => ENV[k].id);
  const done = matrixRoutes(S.mig);
  const m = S.mig;
  const active = migActive(S) && m.run ? { source: m.run.source.env, target: m.run.target.env, runId: m.run.runId, status: m.run.status } : null;
  return envs.flatMap((s) =>
    envs
      .filter((t) => t !== s)
      .map((t): MatrixRoute => {
        if (active && active.source === s && active.target === t) return active;
        return done.find((r) => r.source === s && r.target === t) ?? { source: s, target: t };
      }),
  );
}

/** The six-route scoreboard: one row per direction between the clusters (GET /v1/matrix in live mode). */
export function RoutesTable({ withCount }: { withCount?: boolean }) {
  return useLive() ? <LiveRoutes withCount={withCount} /> : <SimRoutes withCount={withCount} />;
}
function SimRoutes({ withCount }: { withCount?: boolean }) {
  return <RoutesView routes={useSimRoutes()} withCount={withCount} />;
}
function LiveRoutes({ withCount }: { withCount?: boolean }) {
  const m = useMatrix();
  if (m.error && !m.data) return <LoadError title="경로별 결과를 불러오지 못했습니다." error={errorText(m.error)} retry={m.reload} />;
  if (!m.data) return <Skeleton box rows={6} />;
  return <RoutesView routes={m.data.routes} withCount={withCount} />;
}

function RoutesView({ routes, withCount }: { routes: MatrixRoute[]; withCount?: boolean }) {
  const done = routes.filter((r) => r.status === "succeeded").length;
  const rows = routes.map((r) => {
    const x = r.result;
    const ended = r.status && r.finishedAt;
    return [
      td(envShort(r.source) + " → " + envShort(r.target), "nw"),
      td(r.status ? <Chip kind={RESULT_KIND[r.status] ?? ""}>{statusText(r.status)}</Chip> : <Chip>미실행</Chip>),
      td(ended && x?.durationMillis !== undefined ? dur(x.durationMillis / 1000) : "-", "num"),
      td(ended && x?.downtimeMillis !== undefined ? (x.downtimeMillis / 1000).toFixed(1) + "초" : "-", "num"),
      td(ended && x?.failedRequests !== undefined ? fmt(x.failedRequests) + "건" : "-", "num"),
      td(ended && x ? (x.missingRows ?? "-") + " / " + (x.missingWrites ?? "-") + " / " + (x.missingFiles ?? "-") : "-", "num"),
      td(ended && x?.requests !== undefined ? fmt(x.requests) : "-", "num"),
      td(r.runId ?? "-", "m"),
    ];
  });
  return (
    <>
      {withCount && (
        <p className="hint">
          {routes.length}개 중 {done}개 경로가 성공했습니다. 누락은 원본 행과 k6가 성공 응답을 받은 쓰기 기록을 대상 DB와 대조하고, 파일은 크기와 해시를 비교해서 셉니다.
        </p>
      )}
      <div className="box">
        <Table head={["경로", "결과", "전체", "쓰기 보류", "실패 요청", "누락 (행 / 쓰기 / 파일)", "요청", "run"]} rows={rows} />
      </div>
    </>
  );
}

/** The same six routes as a 3×3 grid: sources as rows, targets as columns, the diagonal empty. */
/**
 * In live mode `active` are the runs in progress the caller already polls: GET /v1/matrix has only finished
 * runs, so they are laid over it, and the matrix loads again when that set changes (a run started or ended).
 * The simulation lays its own run over the matrix.
 */
export function RouteMatrix({ active = [] }: { active?: Run[] }) {
  return useLive() ? <LiveMatrix active={active} /> : <SimMatrix />;
}
function SimMatrix() {
  return <MatrixView routes={useSimRoutes()} />;
}
function LiveMatrix({ active }: { active: Run[] }) {
  const m = useMatrix();
  const ids = active.map((r) => r.runId).join(" ");
  const seen = useRef(ids);
  const reload = m.reload;
  useEffect(() => {
    if (seen.current === ids) return;
    seen.current = ids;
    reload();
  }, [ids, reload]);
  if (m.error && !m.data) return <LoadError title="경로별 결과를 불러오지 못했습니다." error={errorText(m.error)} retry={reload} />;
  if (!m.data) return <Skeleton />;
  const now = active.map((r): MatrixRoute => ({ source: r.source.env, target: r.target.env, runId: r.runId, status: r.status }));
  // a cell takes the first route that matches it, so a run in progress wins over the route's last result
  return <MatrixView routes={[...now, ...m.data.routes]} />;
}

function MatrixView({ routes }: { routes: MatrixRoute[] }) {
  // environments match by key: the platform names on-prem "onprem", the simulation "k3s"
  const at = (s: EnvKey, t: EnvKey) => routes.find((r) => envKeyOf(r.source) === s && envKeyOf(r.target) === t);
  return (
    <div className="scroll">
      <table className="rmx">
        <thead>
          <tr>
            <td />
            {ENV_ORDER.map((t) => (
              <th key={t} scope="col">
                {ENV[t].short}로
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ENV_ORDER.map((s) => (
            <tr key={s}>
              <th scope="row">{ENV[s].short}에서</th>
              {ENV_ORDER.map((t) => (s === t ? <td key={t} className="x" /> : <td key={t}>{routeCell(s, t, at(s, t))}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A run in progress opens the migration page; a finished one the per-route table, which has its numbers.
function routeCell(s: EnvKey, t: EnvKey, r: MatrixRoute | undefined): ReactNode {
  if (!r?.status) return <span className="no">아직 없음</span>;
  const active = r.status === "running" || r.status === "awaiting_switch";
  const ms = r.finishedAt ? r.result?.durationMillis : undefined;
  const time = ms !== undefined ? dur(ms / 1000) : "";
  return (
    <a className={RESULT_KIND[r.status] || "neu"} href={active ? "#migrate-app" : "#routes"} aria-label={ENV[s].short + "에서 " + ENV[t].short + "로 " + RUN_SHORT[r.status] + (time && ", " + time)}>
      <b>{RUN_SHORT[r.status]}</b>
      {time && <span className="num">{time}</span>}
    </a>
  );
}

export function EmptyShop() {
  const { dispatch } = useSim();
  return (
    <div className="box">
      <div className="empty-state">
        <b>이전할 수 있는 앱이 아직 없습니다.</b>
        <p className="hint">기존 앱 가져오기(시안)를 마치면 샘플 앱 {SAMPLE.id}이 플랫폼에 올라오고, 클러스터 사이로 옮길 수 있습니다.</p>
        <div className="actrow">
          <a className="btn primary" href="#onboard">
            기존 앱 가져오기
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              dispatch({ type: "onb-skip" });
              navigate("#migrate-app");
            }}
          >
            가져오기 완료 상태로 건너뛰기
          </button>
        </div>
      </div>
    </div>
  );
}
