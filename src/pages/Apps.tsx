import { useId, useState, type ReactNode } from "react";
import { isFinalDeploymentStatus } from "../api/sse";
import type { AppInstance, AppSpecValidation } from "../api/types";
import { ago, AppsList, appHealth, DeployChip, elapsedSec, EnvChip, ExtLink, short, SpecResult, SpecSummary, TRIGGER_LABEL, type AppHealth } from "../components/deploy";
import { AppSecrets } from "../components/secrets";
import { envName } from "../components/shared";
import { Chip, PageHead, Table, td, type Cell } from "../components/ui";
import { REDEPLOY_WAIT, redeployState, useLiveApp, useLiveApps, useSimApp, useSimApps, type AppModel, type AppsModel } from "../data/deploy";
import { useLive } from "../data/live";
import { navigate } from "../router";
import { ENV } from "../sim/data";
import { branchSlug, instanceName, MAX_INSTANCES } from "../sim/deploy";
import { dur } from "../sim/format";
import { useSim } from "../sim/store";

export type AppFilter = "all" | AppHealth;

const TILES: [AppFilter, string, string][] = [
  ["all", "전체", "파일 앱과 GitHub에서 등록한 앱"],
  ["healthy", "정상", "모든 환경이 Synced, Healthy"],
  ["problem", "문제 있음", "배포 실패, 환경 저하나 실패"],
  ["deploying", "배포 중", "빌드, 커밋, 동기화 중"],
];

/** `#apps` or `#apps-<filter>` → the filter, so a filtered list can be shared by its URL. */
export function appFilterOf(route: string): AppFilter {
  const f = route.slice("apps-".length);
  return TILES.some((t) => t[0] === f) ? (f as AppFilter) : "all";
}

export function Apps({ filter = "all" }: { filter?: AppFilter }) {
  return (
    <div className="page">
      <PageHead
        title="앱"
        sub="플랫폼이 Argo CD로 관리하는 앱입니다. GitHub 레포로 새 앱을 등록하거나 플랫폼 밖에서 돌던 앱을 가져올 수 있고, 게이트웨이 뒤에서 한 곳에서만 도는 앱은 다른 클러스터로 이전할 수 있습니다."
        acts={
          <>
            <a className="btn ghost" href="#onboard">
              기존 앱 가져오기
            </a>
            <a className="btn ghost" href="#new">
              새 앱 배포
            </a>
          </>
        }
      />
      {useLive() ? <LiveAppsBody filter={filter} /> : <SimAppsBody filter={filter} />}
    </div>
  );
}
function LiveAppsBody({ filter }: { filter: AppFilter }) {
  return <AppsBody m={useLiveApps()} filter={filter} />;
}
function SimAppsBody({ filter }: { filter: AppFilter }) {
  return <AppsBody m={useSimApps()} filter={filter} />;
}

function AppsBody({ m, filter }: { m: AppsModel; filter: AppFilter }) {
  if (m.error) return <p className="hint">앱을 불러오지 못했습니다: {m.error}</p>;
  if (!m.apps) return <p className="hint">불러오는 중</p>;
  const health = new Map(m.apps.map((a) => [a.name, appHealth(a)]));
  const count = (f: AppFilter) => (f === "all" ? m.apps!.length : m.apps!.filter((a) => health.get(a.name) === f).length);
  const shown = filter === "all" ? m.apps : m.apps.filter((a) => health.get(a.name) === filter);
  return (
    <>
      <nav className="metrics tiles" aria-label="상태로 앱 거르기">
        {TILES.map(([f, label, note]) => (
          <a key={f} className={"metric" + (f === "problem" && count(f) > 0 ? " warn" : "")} href={f === "all" ? "#apps" : "#apps-" + f} aria-current={f === filter ? "true" : undefined}>
            <span>{label}</span>
            <strong>{count(f)}</strong>
            <small>{note}</small>
          </a>
        ))}
      </nav>
      {shown.length === 0 ? (
        <div className="box">
          <div className="empty-state">
            <p className="hint">이 상태의 앱이 없습니다.</p>
            <a className="btn ghost" href="#apps">
              전체 보기
            </a>
          </div>
        </div>
      ) : (
        <AppsList apps={shown} now={m.now} busy={m.busy} full />
      )}
    </>
  );
}

/* ---------- detail ---------- */

export function AppDetail({ id }: { id: string }) {
  return useLive() ? <LiveAppDetail id={id} /> : <SimAppDetail id={id} />;
}
function LiveAppDetail({ id }: { id: string }) {
  return <AppDetailView m={useLiveApp(id)} name={id} />;
}
function SimAppDetail({ id }: { id: string }) {
  const { S } = useSim();
  // The migration app keeps its own demo view; registered apps use the contract one.
  return S.apps[id] ? <ServiceDetail id={id} /> : <SimRegisteredDetail id={id} />;
}
function SimRegisteredDetail({ id }: { id: string }) {
  return <AppDetailView m={useSimApp(id)} name={id} />;
}

const crumb = <a href="#apps">앱</a>;

function NotFound({ id }: { id: string }) {
  return (
    <div className="page">
      <PageHead title="앱을 찾을 수 없습니다" crumb={crumb} />
      <div className="box">
        <div className="empty-state">
          <p>{id}은(는) 아직 등록되지 않았습니다.</p>
          <a className="btn" href="#apps">
            앱 목록으로
          </a>
        </div>
      </div>
    </div>
  );
}

/** What the app page is doing. Every button waits while one action is in flight. */
type Busy = "" | "deploy" | "redeploy" | "delete" | "add" | "remove";

function AppDetailView({ m, name }: { m: AppModel; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
  const [msg, setMsg] = useState("");
  const [invalid, setInvalid] = useState<AppSpecValidation>();
  const a = m.app;
  if (!a) {
    if (m.notFound) return <NotFound id={name} />;
    return (
      <div className="page">
        <PageHead title={name} crumb={crumb} />
        <p className="hint">{m.error ? "앱을 불러오지 못했습니다: " + m.error : "불러오는 중"}</p>
      </div>
    );
  }
  const d = a.deploy;
  const deps = m.deployments ?? [];
  const running = deps.find((x) => !isFinalDeploymentStatus(x.status));
  const def = "기본 인스턴스(" + a.name + ")";

  /** Deploys `branch` into its instance; without one, the default instance. */
  async function redeploy(branch?: string) {
    setBusy("deploy");
    setMsg("");
    setInvalid(undefined);
    try {
      const r = await m.redeploy(branch);
      if ("deploymentId" in r) navigate("#deploy-" + r.deploymentId);
      else if ("validation" in r) setInvalid(r.validation);
      else setMsg(r.error);
    } finally {
      setBusy("");
    }
  }
  /** Deploys the instance's last healthy deployment again without a build, with the secrets as they are now. */
  async function redeployNoBuild(i: AppInstance) {
    setBusy("redeploy");
    setMsg("");
    setInvalid(undefined);
    try {
      const r = await m.redeployNoBuild(i.branch);
      if ("deploymentId" in r) navigate("#deploy-" + r.deploymentId);
      else if ("validation" in r) setInvalid(r.validation);
      else setMsg(i.name + " 재배포: " + r.error);
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    setBusy("delete");
    setMsg("");
    try {
      const err = await m.remove();
      if (err) setMsg(err);
      else navigate("#apps");
    } finally {
      setBusy("");
    }
  }

  const acts = (
    <>
      {d && (
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => redeploy()}>
          기본 브랜치 다시 배포
        </button>
      )}
      {a.environments.length > 0 && (
        <a className="btn ghost" href="#migrate-shop">
          이전
        </a>
      )}
      {d && (
        <button type="button" className="btn ghost" disabled={!!busy || confirming} onClick={() => setConfirming(true)}>
          앱 삭제
        </button>
      )}
    </>
  );
  return (
    <div className="page">
      <PageHead
        title={a.name}
        sub={d ? <span className="m">{d.repo}</span> : "PLATFORM_APPS_FILE에 있는 앱입니다. 클러스터 사이로 이전할 수 있습니다."}
        acts={acts}
        crumb={crumb}
      />
      {confirming && d && (
        <ConfirmDelete label="앱 삭제 확인" kind="앱" name={a.name} busy={!!busy} deleting={busy === "delete"} onConfirm={remove} onCancel={() => setConfirming(false)}>
          gitops 저장소에서 {m.instances.map((i) => "apps/" + i.name + "/").join(", ")}을 지우고, Argo CD가 환경 {d.environments.length}곳({d.environments.map((e) => envName(e)).join(", ")})의 앱과 DB, 버킷을 지웁니다. 데이터는 되돌릴 수 없습니다.
        </ConfirmDelete>
      )}
      {msg && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <p>{msg}</p>
          </div>
        </div>
      )}
      {invalid && <SpecResult check={{ data: invalid, error: undefined, loading: false, reload: () => setInvalid(undefined) }} />}
      {running && (
        <div className="box fillbox" role="status">
          <div className="bb">
            <div className="actrow">
              <DeployChip s={running.status} />
              <span>
                배포 {running.id}가 진행 중입니다 ({[running.instance, short(running.commit), ago(running.createdAt, m.now)].filter(Boolean).join(", ")}).
              </span>
              <a className="more" href={"#deploy-" + running.id}>
                진행 보기
              </a>
            </div>
          </div>
        </div>
      )}
      {d && (
        <>
          <section className="sec">
            <h2>배포 설정</h2>
            <div className="box">
              <div className="bb">
                <dl className="kv">
                  <dt>레포</dt>
                  <dd>
                    <ExtLink href={"https://github.com/" + d.repo} />
                  </dd>
                  <dt>기본 브랜치</dt>
                  <dd className="m">{d.branch}</dd>
                  <dt>기본 인스턴스 자동 배포</dt>
                  <dd>{d.autoDeploy ? "켜짐: push할 때마다 배포합니다" : "꺼짐: 기본 브랜치 다시 배포를 눌러야 배포합니다"}</dd>
                  <dt>기본 인스턴스 공개 주소</dt>
                  <dd>{d.url ? <ExtLink href={d.url} /> : "없음"}</dd>
                  <dt>platform.yaml</dt>
                  <dd>
                    <span className="m">{short(d.specCommit)}</span>에서 읽음
                  </dd>
                  <dt>등록</dt>
                  <dd>
                    {d.createdBy}, {ago(d.createdAt, m.now)}
                  </dd>
                </dl>
              </div>
            </div>
          </section>
          <Instances m={m} app={a.name} busy={busy} setBusy={setBusy} deploy={redeploy} redeployNoBuild={redeployNoBuild} />
          <AppSecrets m={m} app={a.name} busy={!!busy} setRedeploying={(on) => setBusy(on ? "redeploy" : "")} />
          <section className="sec">
            <h2>{def} 환경별 상태</h2>
            <div className="box">
              <Table
                head={["환경", "상태", "Argo CD", "커밋", "주소", "갱신"]}
                rows={d.status.map((s) => [
                  td(envName(s.env)),
                  td(<EnvChip s={s.status} />),
                  td([s.syncStatus, s.healthStatus].filter(Boolean).join(", ") || "-", "m nw"),
                  td(short(s.commit), "m"),
                  td(s.url ? <ExtLink href={s.url} /> : "-", "nw"),
                  td(ago(s.updatedAt, m.now), "nw"),
                ])}
              />
            </div>
          </section>
          <section className="sec">
            <h2>{def} platform.yaml</h2>
            <div className="box">
              <div className="bb">
                <SpecSummary spec={d.spec} />
              </div>
            </div>
          </section>
          <section className="sec">
            <h2>배포 이력</h2>
            <div className="box">
              {deps.length === 0 ? (
                <div className="empty-state">
                  <p className="hint">{m.deployments ? "아직 배포가 없습니다." : "불러오는 중"}</p>
                </div>
              ) : (
                <Table
                  head={["배포", "브랜치", "상태", "트리거", "커밋", "환경", "시작", "소요"]}
                  rows={deps.map((x) => [
                    td(<a href={"#deploy-" + x.id}>{x.id}</a>, "m"),
                    td(x.branch || "-", "m"),
                    td(<DeployChip s={x.status} />),
                    td(TRIGGER_LABEL[x.trigger] + (x.trigger === "push" ? " (" + x.triggeredBy + ")" : ""), "nw"),
                    td(x.ref + " " + short(x.commit), "m"),
                    td(x.environments.map((e) => envName(e.env)).join(", ")),
                    td(ago(x.createdAt, m.now), "nw"),
                    td(isFinalDeploymentStatus(x.status) ? dur(elapsedSec(x, m.now)) : "진행 중", "nw"),
                  ])}
                />
              )}
            </div>
          </section>
        </>
      )}
      {a.environments.length > 0 && (
        <section className="sec">
          <h2>이전 설정</h2>
          <div className="box">
            <Table
              head={["환경", "CNPG 클러스터", "DB 주소", "버킷"]}
              rows={a.environments.map((e) => [td(envName(e.env)), td(e.cnpgCluster, "m"), td(e.dbHost, "m"), td(e.bucket ?? "-", "m")])}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/** An in-page delete confirmation whose button works only once `name` is typed. Never window.confirm. */
function ConfirmDelete(p: { label: string; kind: string; name: string; busy: boolean; deleting: boolean; error?: string; onConfirm: () => void; onCancel: () => void; children: ReactNode }) {
  const [typed, setTyped] = useState("");
  const id = useId();
  return (
    <div className="box badbox" role="group" aria-label={p.label}>
      <div className="bb">
        <b>{p.name}을(를) 삭제할까요?</b>
        <p>{p.children}</p>
        <div className="field">
          <label htmlFor={id}>
            확인하려면 {p.kind} 이름 {p.name}을(를) 입력하세요
          </label>
          <input id={id} value={typed} spellCheck={false} autoComplete="off" autoFocus onChange={(e) => setTyped(e.target.value)} />
        </div>
        {p.error && <p role="alert">{p.error}</p>}
        <div className="actrow">
          <button type="button" className="btn primary" disabled={p.busy || typed.trim() !== p.name} onClick={p.onConfirm}>
            {p.deleting ? "삭제하는 중" : "삭제"}
          </button>
          <button type="button" className="btn ghost" disabled={p.busy} onClick={p.onCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

/** The instance name a branch gets, for the add form. The hash at the end of a shortened name is the server's, so it is not shown. */
function namePreview(app: string, branch: string): string {
  const inst = instanceName(app, branch);
  if (!inst) return "브랜치 이름에 영문자나 숫자가 없어 인스턴스 이름을 만들 수 없습니다.";
  return "인스턴스 이름: " + (inst === app + "--" + branchSlug(branch) ? inst : inst.slice(0, -6) + "(해시 6자리)");
}

/** The no-build redeploy button's text, with the short commit it deploys again when known. */
const noBuildLabel = (commit?: string) => "재배포 (빌드 없이" + (commit ? ", " + short(commit) : "") + ")";

/** One row per instance (ADR 0015), the form that adds a branch, and the typed confirmation that removes one. */
function Instances({
  m,
  app,
  busy,
  setBusy,
  deploy,
  redeployNoBuild,
}: {
  m: AppModel;
  app: string;
  busy: Busy;
  setBusy: (b: Busy) => void;
  deploy: (branch?: string) => void;
  redeployNoBuild: (i: AppInstance) => void;
}) {
  const [branch, setBranch] = useState("");
  const [autoDeploy, setAutoDeploy] = useState(true);
  /** what the last add got back instead of a deployment */
  const [refused, setRefused] = useState<{ validation?: AppSpecValidation; error?: string }>();
  /** the instance whose removal is being confirmed */
  const [removing, setRemoving] = useState("");
  const [removeError, setRemoveError] = useState("");
  // A server from before ADR 0015 lists no instances: only the default one, so there is nothing to add or remove.
  const listed = Array.isArray(m.app?.deploy?.instances);
  const full = m.instances.length >= MAX_INSTANCES;
  const again = new Map(m.instances.map((i) => [i.name, redeployState(app, i, m.deployments)]));
  const waiting = listed ? m.instances.filter((i) => again.get(i.name)!.running) : [];

  async function add() {
    setBusy("add");
    setRefused(undefined);
    try {
      const r = await m.addBranch(branch, autoDeploy);
      if ("deploymentId" in r) navigate("#deploy-" + r.deploymentId);
      else setRefused(r);
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    setBusy("remove");
    setRemoveError("");
    try {
      const err = await m.removeInstance(removing);
      if (err) setRemoveError(err);
      else setRemoving("");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="sec">
      <h2>브랜치별 인스턴스</h2>
      <p className="hint">
        기본 브랜치 외에는 운영자가 추가한 브랜치만 배포합니다. 브랜치마다 주소, 네임스페이스, DB, 버킷이 따로 생기고, 기본 인스턴스를 포함해 {MAX_INSTANCES}개까지 둘 수 있습니다.
      </p>
      <div className="box">
        <Table
          head={["브랜치", "인스턴스", "주소", "환경별 상태", "최근 배포", "자동 배포", ""]}
          rows={m.instances.map((i) => [
            td(
              <span className="chips">
                <span className="m">{i.branch || "-"}</span>
                {i.default && <Chip>기본</Chip>}
              </span>,
            ),
            td(i.name, "m"),
            td(i.url ? <ExtLink href={i.url} /> : "-", "nw"),
            td(
              <div className="chips">
                {i.status.map((s) => (
                  <EnvChip key={s.env} s={s.status} env={s.env} />
                ))}
              </div>,
            ),
            td(
              i.lastDeployment ? (
                <span className="chips">
                  <a href={"#deploy-" + i.lastDeployment.id} aria-label={i.name + " 최근 배포"}>
                    <DeployChip s={i.lastDeployment.status} />
                  </a>
                  <span className="hint">{ago(i.lastDeployment.createdAt, m.now)}</span>
                </span>
              ) : (
                "-"
              ),
              "nw",
            ),
            td(i.autoDeploy ? "켜짐" : "꺼짐", "nw"),
            td(
              <div className="actrow">
                {/* The default instance's deployment names no branch: the server picks the app's own. */}
                <button type="button" className="btn ghost" aria-label={i.name + " 배포"} disabled={!!busy} onClick={() => deploy(i.default ? undefined : i.branch)}>
                  배포
                </button>
                {/* A server that lists no instances predates ADR 0015, and redeploy (ADR 0019) with it. */}
                {listed && (
                  <button
                    type="button"
                    className="btn ghost"
                    aria-label={i.name + " " + noBuildLabel(again.get(i.name)!.commit)}
                    disabled={!!busy || again.get(i.name)!.running}
                    onClick={() => redeployNoBuild(i)}
                  >
                    {noBuildLabel(again.get(i.name)!.commit)}
                  </button>
                )}
                {listed && !i.default && (
                  <button
                    type="button"
                    className="btn ghost"
                    aria-label={i.name + " 삭제"}
                    disabled={!!busy || removing === i.name}
                    onClick={() => {
                      setRemoving(i.name);
                      setRemoveError("");
                    }}
                  >
                    삭제
                  </button>
                )}
              </div>,
              "nw",
            ),
          ])}
        />
      </div>
      {waiting.length > 0 && (
        <p className="hint">
          {waiting.map((i) => i.name).join(", ")}: {REDEPLOY_WAIT}.
        </p>
      )}
      {removing && (
        <ConfirmDelete
          key={removing}
          label="인스턴스 삭제 확인"
          kind="인스턴스"
          name={removing}
          busy={!!busy}
          deleting={busy === "remove"}
          error={removeError && "인스턴스를 지우지 못했습니다: " + removeError}
          onConfirm={remove}
          onCancel={() => setRemoving("")}
        >
          gitops 저장소에서 apps/{removing}/을 지우고, Argo CD가 이 인스턴스의 네임스페이스와 DB, 버킷을 지웁니다. 데이터는 되돌릴 수 없습니다. 다른 인스턴스는 그대로 둡니다.
        </ConfirmDelete>
      )}
      {!listed ? (
        <p className="hint">서버가 인스턴스 목록을 보내지 않아 브랜치를 추가하거나 지울 수 없습니다.</p>
      ) : (
        <div className="box">
          <div className="bh">
            <b>브랜치 추가</b>
            <span className="hint">
              인스턴스 {m.instances.length}/{MAX_INSTANCES}개
            </span>
          </div>
          <div className="bb">
            {full && <p>인스턴스가 {MAX_INSTANCES}개라 브랜치를 더 추가할 수 없습니다. 다른 브랜치를 배포하려면 추가한 인스턴스를 하나 삭제하세요.</p>}
            <div className="form">
              <div className="field">
                <label htmlFor="inst-branch">추가할 브랜치</label>
                <input
                  id="inst-branch"
                  value={branch}
                  disabled={full}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => {
                    setBranch(e.target.value.trim());
                    setRefused(undefined);
                  }}
                />
                <small>{branch ? namePreview(app, branch) : "이 브랜치의 head에서 platform.yaml을 읽어 새 인스턴스로 배포합니다. platform.yaml의 name은 앱 이름과 같아야 합니다."}</small>
              </div>
              <label className="check">
                <input type="checkbox" checked={autoDeploy} disabled={full} onChange={(e) => setAutoDeploy(e.target.checked)} /> push할 때마다 자동으로 배포
              </label>
            </div>
            <div className="actrow">
              <button type="button" className="btn primary" disabled={full || !!busy || !instanceName(app, branch)} onClick={add}>
                {busy === "add" ? "추가하는 중" : "브랜치 추가"}
              </button>
            </div>
          </div>
        </div>
      )}
      {refused?.error && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <b>브랜치를 추가하지 못했습니다.</b>
            <p>{refused.error}</p>
          </div>
        </div>
      )}
      {refused?.validation && <SpecResult check={{ data: refused.validation, error: undefined, loading: false, reload: () => setRefused(undefined) }} />}
    </section>
  );
}

/** The simulation's migration app (shop): where it runs, its resources and its history. */
function ServiceDetail({ id }: { id: string }) {
  const { S } = useSim();
  const a = S.apps[id];
  const rows: Cell[][] = [[td(ENV[a.loc].name), td(<Chip kind="ok">정상</Chip>), td("Pod 10/10", "m"), td("shop.charlie.example", "m"), td("100%", "m")]];
  if (a.prev) rows.push([td(ENV[a.prev].name), td(<Chip>축소됨, 읽기 전용</Chip>), td("-", "m"), td("-", "m"), td("0%", "m")]);
  return (
    <div className="page">
      <PageHead
        title={id}
        sub={<span className="m">{a.repo}</span>}
        acts={
          <a className="btn primary" href="#migrate-shop">
            이전
          </a>
        }
        crumb={crumb}
      />
      <div className="box fillbox">
        <div className="bb">
          {/* MOCK: 서현님 샘플 앱이 정해지면 서비스 목록과 주소를 바꾼다 */}
          <p>서비스 도메인은 Cloudflare와 게이트웨이를 거칩니다. 게이트웨이가 모든 요청을 {ENV[a.loc].name}로 보내고 있습니다.</p>
        </div>
      </div>
      <section className="sec">
        <h2>실행 위치</h2>
        <div className="box">
          <Table head={["위치", "상태", "실행", "주소", "트래픽"]} rows={rows} />
        </div>
      </section>
      <section className="sec">
        <h2>리소스</h2>
        <div className="box">
          <Table head={["종류", "이름", "내용"]} rows={a.res.map((r) => [td(r[0]), td(r[1], "m"), td(r[2])])} />
        </div>
      </section>
      <section className="sec">
        <h2>변경 이력</h2>
        <div className="box">
          <Table head={["커밋", "내용", "시각", "소요"]} rows={a.deploys.map((r) => [td(r[0], "m"), td(r[1]), td(r[2], "nw"), td(r[3], "nw")])} />
        </div>
      </section>
    </div>
  );
}
