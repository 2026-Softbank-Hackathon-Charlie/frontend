import { useEnvironments, useTraffic } from "../api/hooks";
import type { DatabaseCluster } from "../api/types";
import { Chip, type ChipKind, LoadError, PageHead, Skeleton, Table, td } from "../components/ui";
import { errorText, useLive } from "../data/live";
import { ENV, ENV_ORDER } from "../sim/data";
import { fmt } from "../sim/format";

export function Envs() {
  return useLive() ? <LiveEnvs /> : <SimEnvs />;
}

function LiveEnvs() {
  const envs = useEnvironments(10_000);
  const traffic = useTraffic(5_000, "1m");
  const t = traffic.data;
  return (
    <div className="page">
      <PageHead icon="server" title="환경" sub="플랫폼 API가 보고하는 클러스터와 트래픽 게이트웨이 상태입니다. 10초마다 다시 읽습니다." />
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
                td(e.region ?? "-"),
                td(e.status.kubernetesVersion ?? "-", "m"),
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
        <h2>트래픽 게이트웨이</h2>
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
  return (
    <div className="page">
      <PageHead
        icon="server"
        title="환경"
        sub="환경마다 독립된 Kubernetes 클러스터를 둡니다. 환경 차이는 Helm values(환경 프로필)로만 흡수하고, 같은 chart로 모든 클러스터에 배포합니다."
        acts={
          <>
            <span className="hint" id="env-register-why">
              시연에서는 쓸 수 없습니다. 클러스터는 Terraform으로 만든 뒤 등록합니다.
            </span>
            <button type="button" className="btn ghost" disabled aria-describedby="env-register-why">
              환경 등록
            </button>
          </>
        }
      />
      <section className="sec">
        <h2>대상 클러스터</h2>
        <div className="box">
          <Table
            head={["환경", "위치", "Kubernetes", "노드", "파일 저장소", "StorageClass", "프로필", "상태"]}
            rows={ENV_ORDER.map((k) => {
              const e = ENV[k];
              return [
                td(<b>{e.name}</b>),
                td(e.region),
                td(e.k8s, "m"),
                td(e.nodes + "대"),
                td(e.storage),
                td(e.sc, "m"),
                td("values-" + k + ".yaml", "m"),
                td(<Chip kind="ok">정상</Chip>),
              ];
            })}
          />
        </div>
      </section>
      <section className="sec">
        <h2>관리 영역과 연결</h2>
        <div className="box">
          <Table
            head={["구성 요소", "위치", "역할"]}
            rows={[
              [td(<b>관리 호스트</b>), td("AWS"), td("플랫폼 API, 워크플로, Argo CD. 대상 클러스터와 분리")],
              [td(<b>Tailscale</b>), td("3개 클러스터 + 관리 호스트"), td("공인 IP 없이 사설망 연결, DB 복제와 rclone 경로")],
              [td(<b>Cloudflare</b>), td("외부"), td("도메인, HTTPS, Tunnel. DNS로 트래픽을 전환하지 않음")],
              [td(<b>트래픽 게이트웨이</b>), td("클러스터 밖 중립 위치"), td("환경별 비율, 전환 때 쓰기 보류, 연결 drain")],
              [td(<b>Amazon ECR</b>), td("AWS"), td("모든 클러스터가 같은 이미지를 받음")],
            ]}
          />
        </div>
      </section>
      <div className="box fillbox">
        <div className="bb">
          <p>새 클러스터는 Terraform으로 만든 뒤 여기에 등록합니다. 모든 클러스터에는 같은 CloudNativePG와 Tailscale을 설치합니다.</p>
        </div>
      </div>
    </div>
  );
}
