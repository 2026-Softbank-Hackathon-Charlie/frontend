import { useEnvironments, useMatrix } from "../api/hooks";
import type { Environment, MatrixRoute } from "../api/types";
import { errorText, useLive } from "../data/live";
import { navigate } from "../router";
import { ENV, ENV_ORDER, envKeyOf } from "../sim/data";
import { dur, fmt } from "../sim/format";
import { matrixRoutes, statusText } from "../sim/mig";
import { appsIn, migActive, migLabel, type App } from "../sim/state";
import { useSim } from "../sim/store";
import { Chip, Table, td, type ChipKind } from "./ui";

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

function SimEnvGrid() {
  const { S } = useSim();
  return (
    <div className="grid4">
      {ENV_ORDER.map((k) => {
        const e = ENV[k];
        return (
          <div className="cell" key={k}>
            <div className="cellh">
              <b>{e.name}</b>
              <Chip kind="ok">정상</Chip>
            </div>
            <dl className="kv sm">
              <dt>위치</dt>
              <dd>{e.region}</dd>
              <dt>노드</dt>
              <dd>
                {e.nodes}대, Kubernetes {e.k8s}
              </dd>
              <dt>파일 저장소</dt>
              <dd>{e.storage}</dd>
              <dt>사설망</dt>
              <dd>Tailscale 연결됨</dd>
              <dt>앱</dt>
              <dd>{appsIn(S, k)}개</dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function LiveEnvGrid() {
  const envs = useEnvironments(10_000);
  if (envs.error && !envs.data) return <p className="hint">환경을 불러오지 못했습니다: {errorText(envs.error)}</p>;
  if (!envs.data) return <p className="hint">불러오는 중</p>;
  return (
    <div className="grid4">
      {envs.data.map((e) => (
        <div className="cell" key={e.name}>
          <div className="cellh">
            <b>{e.displayName}</b>
            <Chip kind={e.status.reachable ? "ok" : "bad"}>{e.status.reachable ? "정상" : "연결 안 됨"}</Chip>
          </div>
          <dl className="kv sm">
            <dt>위치</dt>
            <dd>{e.region ?? "-"}</dd>
            <dt>노드</dt>
            <dd>
              {e.status.nodes ? e.status.nodes.ready + "/" + e.status.nodes.total + "대" : "-"}
              {e.status.kubernetesVersion ? ", Kubernetes " + e.status.kubernetesVersion : ""}
            </dd>
            <dt>DB</dt>
            <dd>{e.status.databases?.map((d) => d.name + " " + d.readyInstances + "/" + d.instances).join(", ") || "-"}</dd>
            <dt>트래픽</dt>
            <dd>{e.live ? "쓰기를 받는 곳" : "대기"}</dd>
          </dl>
          {e.status.error && <p className="hint">{e.status.error}</p>}
        </div>
      ))}
    </div>
  );
}

export function LocChips({ a }: { a: App }) {
  const { S } = useSim();
  if (a.kind === "platform") {
    return (
      <div className="chips">
        {(a.envs ?? []).map((k) => (
          <Chip key={k}>{ENV[k].name}</Chip>
        ))}
      </div>
    );
  }
  return (
    <div className="chips">
      <Chip>{ENV[a.loc ?? "aws"].name}</Chip>
      {migActive(S) && <Chip kind="run">{migLabel(S)}</Chip>}
    </div>
  );
}

export function AppsTable({ full }: { full: boolean }) {
  const { S } = useSim();
  const rows = S.appOrder.map((id) => {
    const a = S.apps[id];
    const r = [td(<a href={"#app-" + id}>{id}</a>)];
    if (full) r.push(td(a.repo, "m"));
    r.push(td(<LocChips a={a} />), td(a.deploys[0][2] + " (" + a.deploys[0][0] + ")", "nw"), td(<Chip kind="ok">정상</Chip>));
    if (full)
      r.push(
        td(
          a.kind === "service" ? (
            <a className="btn ghost" href="#migrate-shop">
              이전
            </a>
          ) : (
            ""
          ),
        ),
      );
    return r;
  });
  const head = full ? ["이름", "레포", "실행 위치", "최근 변경", "상태", ""] : ["이름", "실행 위치", "최근 변경", "상태"];
  return (
    <div className="box">
      <Table head={head} rows={rows} />
    </div>
  );
}

const RESULT_KIND: Record<string, ChipKind> = { succeeded: "ok", running: "run", awaiting_switch: "run", halted: "bad", failed: "bad", interrupted: "bad" };

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
  if (m.error && !m.data) return <p className="hint">경로별 결과를 불러오지 못했습니다: {errorText(m.error)}</p>;
  if (!m.data) return <p className="hint">불러오는 중</p>;
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
      td(ended && x?.durationMillis !== undefined ? dur(x.durationMillis / 1000) : "-", "m"),
      td(ended && x?.downtimeMillis !== undefined ? (x.downtimeMillis / 1000).toFixed(1) + "초" : "-", "m"),
      td(ended && x?.failedRequests !== undefined ? fmt(x.failedRequests) + "건" : "-", "m"),
      td(ended && x ? (x.missingRows ?? "-") + " / " + (x.missingWrites ?? "-") + " / " + (x.missingFiles ?? "-") : "-", "m"),
      td(ended && x?.requests !== undefined ? fmt(x.requests) : "-", "m"),
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

export function EmptyShop() {
  const { dispatch } = useSim();
  return (
    <div className="box">
      <div className="empty-state">
        <b>이전할 수 있는 앱이 아직 없습니다.</b>
        <p className="hint">플랫폼 밖 AWS(EC2)에서 돌고 있는 shop을 먼저 가져오면, 클러스터 사이로 옮길 수 있습니다.</p>
        <div className="actrow">
          <a className="btn primary" href="#onboard">
            기존 앱 가져오기
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              dispatch({ type: "onb-skip" });
              navigate("#migrate-shop");
            }}
          >
            가져오기 완료 상태로 건너뛰기
          </button>
        </div>
      </div>
    </div>
  );
}
