import { useState, type ReactNode } from "react";
import { useApps, useEnvironments, useTraffic, type Resource } from "../api/hooks";
import type { DatabaseCluster, Environment, TrafficState } from "../api/types";
import { Chip, type ChipKind, LoadError, PageHead, Skeleton, Table, td } from "../components/ui";
import { hasGateway } from "../data/deploy";
import { errorText, useLive } from "../data/live";
import { ENV, ENV_ORDER } from "../sim/data";
import { fmt } from "../sim/format";
import { targetReadShare } from "../sim/mig";
import { useSim } from "../sim/store";
import { OnpremEnrollmentEntry } from "../components/OnpremEnrollment";

export function Envs() {
  return useLive() ? <LiveEnvs /> : <SimEnvs />;
}

function LiveEnvs() {
  const envs = useEnvironments(10_000);
  const apps = useApps(10_000);
  const [picked, setPicked] = useState("");
  const names = apps.data?.filter(hasGateway).map((a) => a.name) ?? [];
  // The gateway is the app's: the one without an app belongs to the old shop example, which no app uses now. It is read
  // only when no app has a gateway (none registered, or the app list could not be read), and not before the list has answered.
  const app = names.includes(picked) ? picked : names[0];
  const traffic = useTraffic(5_000, "1m", app, !!apps.data || !!apps.error);
  const scope: ReactNode = names.length ? (
    <label>
      앱{" "}
      <select aria-label="트래픽을 볼 앱" value={app} onChange={(e) => setPicked(e.target.value)}>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  ) : apps.error && !apps.data ? (
    <span className="hint">앱 목록을 읽지 못해 앱을 지정하지 않은 기본 게이트웨이를 보여 줍니다. 등록된 앱의 트래픽과 다를 수 있습니다.</span>
  ) : null;
  return <EnvsView envs={envs} traffic={traffic} scope={scope} enrollment={<OnpremEnrollmentEntry onReady={envs.reload} />} />;
}

type ReadResult<T> = Pick<Resource<T>, "data" | "error" | "reload">;

/** Both modes render the platform contract. Only the source of observations differs. */
function EnvsView({ envs, traffic, scope, demo = false, enrollment }: { envs: ReadResult<Environment[]>; traffic: ReadResult<TrafficState>; scope?: ReactNode; demo?: boolean; enrollment?: ReactNode }) {
  const t = traffic.data;
  return (
    <div className="page">
      <PageHead icon="server" title="환경" sub={demo ? "클러스터와 트래픽 게이트웨이 상태입니다." : "플랫폼 API가 보고하는 클러스터와 트래픽 게이트웨이 상태입니다. 10초마다 다시 읽습니다."} />
      {enrollment}
      {demo && <p className="hint">시연용 데이터입니다. 정상·부분 조회·연결 실패·백업 실패는 상태 표시를 설명하는 가상 사례이며 실제 클러스터 점검 결과가 아닙니다.</p>}
      <section className="sec">
        <h2>대상 클러스터</h2>
        {envs.error && !envs.data ? (
          <LoadError title="클러스터 상태를 불러오지 못했습니다." error={errorText(envs.error)} retry={envs.reload} />
        ) : !envs.data ? (
          <Skeleton box />
        ) : (
          <div className="box">
            <Table
              head={["환경", "위치", "Kubernetes", "노드", "DB (CNPG)", "DB 백업", "게이트웨이 백엔드", "상태"]}
              rows={envs.data.map((e) => [
                td(<b>{e.displayName}</b>),
                td(e.region ?? "-", "nw"),
                td(e.status.kubernetesVersion ?? "-", "m nw"),
                td(e.status.nodes ? e.status.nodes.ready + "/" + e.status.nodes.total + "대" : "-"),
                td(e.status.databases?.map((d) => d.name + (d.replica ? " (복제본)" : "") + " " + d.readyInstances + "/" + d.instances).join(", ") || "-"),
                td(<DbBackups dbs={e.status.databases} />),
                td(e.gatewayBackend, "m"),
                td(
                  <>
                    <Chip kind={e.status.reachable ? "ok" : "bad"}>{e.status.reachable ? "정상" : "연결 안 됨"}</Chip>
                    {e.status.reachable && e.status.error && <div className="hint">일부를 읽지 못함: {e.status.error}</div>}
                  </>,
                ),
              ])}
            />
          </div>
        )}
      </section>
      <section className="sec">
        <div className="sech">
          <h2>트래픽 게이트웨이</h2>
          {scope}
        </div>
        {traffic.error && !t ? (
          <LoadError title="트래픽 게이트웨이 상태를 불러오지 못했습니다." error={errorText(traffic.error)} retry={traffic.reload} />
        ) : !t ? (
          <Skeleton box />
        ) : (
          <div className="box">
            <div className="bb">
              <dl className="kv">
                <dt>쓰기 대상</dt>
                <dd className="m">{t.writeBackend}</dd>
                <dt>읽기 비율</dt>
                <dd className="m">{Object.entries(t.readWeights).map(([k, w]) => k + " " + w + "%").join(", ")}</dd>
                <dt>쓰기 보류</dt>
                <dd>{t.writesHeld ? "보류 중 (" + fmt(t.heldWrites) + "건, 상한 " + t.maxHold + ")" : "없음"}</dd>
              </dl>
            </div>
            <Table
              head={["백엔드", "상태", "요청 (1분)", "오류율", "p95"]}
              rows={t.backends.map((b) => {
                const st = t.stats[b.name];
                return [
                  td(b.name, "m"),
                  td(<Chip kind={b.healthy ? "ok" : "bad"}>{b.healthy ? "정상" : "비정상"}</Chip>),
                  td(st ? fmt(st.requests) : "-", "num"),
                  td(st ? (st.errorRate * 100).toFixed(2) + "%" : "-", "num"),
                  td(st ? st.p95Millis + "ms" : "-", "num"),
                ];
              })}
            />
          </div>
        )}
      </section>
    </div>
  );
}

const when = (s: string) =>
  new Date(s).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** A base backup older than this is late: the schedule is daily. */
const STALE_MS = 26 * 3_600_000;

/** What the console says about one database's backups (platform ADR 0025). */
export function backupStatus(d: DatabaseCluster, now = Date.now()): { chip: ChipKind; label: string; detail: string } {
  const b = d.backup;
  if (!b) return { chip: "neu", label: "백업 없음", detail: "" };
  const last = b.lastSuccessfulBackup ? Date.parse(b.lastSuccessfulBackup) : NaN;
  const failed = b.lastFailedBackup ? Date.parse(b.lastFailedBackup) : NaN;
  const detail = ["마지막 백업 " + (b.lastSuccessfulBackup ? when(b.lastSuccessfulBackup) : "없음"), b.firstRecoverabilityPoint ? when(b.firstRecoverabilityPoint) + "부터 복구 가능" : ""]
    .filter(Boolean)
    .join(", ");
  const [chip, label]: [ChipKind, string] = !b.walArchiving
    ? ["bad", "WAL 보관 실패"]
    : !Number.isNaN(failed) && (Number.isNaN(last) || failed > last)
      ? ["warn", "마지막 백업 실패"]
      : Number.isNaN(last)
        ? ["warn", "백업 기록 없음"]
        : now - last > STALE_MS
          ? ["warn", "백업 오래됨"]
          : ["ok", "백업 정상"];
  return { chip, label, detail };
}

/** Every database: whether it is backed up, the last backup and how far back a restore reaches. */
function DbBackups({ dbs }: { dbs?: DatabaseCluster[] }) {
  if (!dbs?.length) return <>-</>;
  return (
    <>
      {dbs.map((d) => {
        const st = backupStatus(d);
        return (
          <div key={d.namespace + "/" + d.name}>
            <span className="m">{d.namespace + "/" + d.name}</span> <Chip kind={st.chip}>{st.label}</Chip>
            {st.detail && <div className="hint">{st.detail}</div>}
          </div>
        );
      })}
    </>
  );
}

function SimEnvs() {
  const { S } = useSim();
  const [observedAt] = useState(Date.now);
  const at = (hoursAgo: number) => new Date(observedAt - hoursAgo * 3_600_000).toISOString();
  const m = S.mig;
  const writeBackend = ENV[m.run?.engine.trafficOnTarget ? m.tgt : m.src].id;
  const weight = m.run ? targetReadShare(m.run) : 0;
  const readWeights = !weight
    ? { [ENV[m.src].id]: 100 }
    : weight === 100 ? { [ENV[m.tgt].id]: 100 } : { [ENV[m.src].id]: 100 - weight, [ENV[m.tgt].id]: weight };
  const environments: Environment[] = ENV_ORDER.map((key) => {
    const e = ENV[key];
    const status: Environment["status"] = { reachable: key !== "onprem", checkedAt: at(0) };
    if (key !== "onprem") {
      status.kubernetesVersion = e.k8s;
      status.nodes = { ready: e.nodes, total: e.nodes, architectures: ["amd64"] };
    }
    if (key === "aws") status.databases = [
      { namespace: "demo-main", name: "demo-main-db", instances: 1, readyInstances: 1, replica: false,
        backup: { objectStore: "demo-main-db", walArchiving: true, lastSuccessfulBackup: at(2), firstRecoverabilityPoint: at(48) } },
      { namespace: "demo-report", name: "demo-report-db", instances: 1, readyInstances: 1, replica: false,
        backup: { objectStore: "demo-report-db", walArchiving: true, lastSuccessfulBackup: at(3), lastFailedBackup: at(1), firstRecoverabilityPoint: at(48) } },
    ];
    if (key === "gcp") status.error = "시연: CNPG 조회 권한이 없어 DB 상태를 읽지 못했습니다.";
    if (key === "onprem") status.error = "시연: Kubernetes API 연결 시간 초과";
    return { name: e.id, provider: key === "aws" ? "aws" : key === "gcp" ? "gcp" : "onprem", displayName: e.name, region: e.region, kubeContext: e.id,
      gatewayBackend: e.id, live: e.id === writeBackend, status };
  });
  const traffic: TrafficState = {
    writeBackend, readWeights, writesHeld: m.run?.engine.writesHeld ?? false, heldWrites: Math.max(0, m.held), maxHold: "30s",
    inFlight: { reads: 0, writes: 0 }, updatedAt: at(0),
    backends: ENV_ORDER.map((key) => ({ name: ENV[key].id, url: "https://" + ENV[key].id + ".example.invalid", healthy: key !== "onprem", lastCheck: at(0) })),
    stats: Object.fromEntries(ENV_ORDER.map((key) => [ENV[key].id, { windowSeconds: 60, requests: key === "aws" ? 1200 : 0, errors: 0, errorRate: 0, rps: key === "aws" ? 20 : 0,
      p50Millis: key === "aws" ? 38 : 0, p95Millis: key === "aws" ? 118 : 0, p99Millis: key === "aws" ? 160 : 0 }])),
    totals: Object.fromEntries(ENV_ORDER.map((key) => [ENV[key].id, { requests: key === "aws" ? 1200 : 0, errors: 0 }])),
  };
  return <EnvsView demo envs={{ data: environments, error: undefined, reload: () => {} }} traffic={{ data: traffic, error: undefined, reload: () => {} }} />;
}
