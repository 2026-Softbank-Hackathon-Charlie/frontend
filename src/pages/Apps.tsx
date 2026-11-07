import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { isFinalDeploymentStatus } from "../api/sse";
import type { AppDBReadinessEnvironment, AppDBTopology, AppInstance, AppSpecValidation, Deployment } from "../api/types";
import { ago, AppsList, appHealth, DeployChip, DeploymentEnvLabels, elapsedSec, EnvChip, ENV_STATUS, ExtLink, short, SpecResult, SpecSummary, TRIGGER_LABEL, type AppHealth } from "../components/deploy";
import { AppObservationDialog } from "../components/AppObservation";
import { AppSecrets, SecretsSummary } from "../components/secrets";
import { EnvLabel, envName } from "../components/shared";
import { Icon } from "../components/Icon";
import { Chip, LoadError, PageHead, Skeleton, Table, Tabs, td } from "../components/ui";
import { REDEPLOY_WAIT, redeployState, useLiveApp, useLiveApps, useSimApp, useSimApps, type AppModel, type AppsModel } from "../data/deploy";
import { dbRoles, readinessBlock, type DBRole, type EnvOption } from "../data/migration";
import { migrationEntryLabel } from "../data/migrationMembership";
import { useLive } from "../data/live";
import { useLiveSecrets, useSimSecrets, type SecretsModel } from "../data/secrets";
import { navigate, type AppTab } from "../router";
import { ENV, SAMPLE } from "../sim/data";
import { branchSlug, instanceName, MAX_INSTANCES } from "../sim/deploy";
import { dur } from "../sim/format";
import { useSim } from "../sim/store";
import "../styles/app-detail.css";

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
        icon="boxes"
        title="앱"
        sub="플랫폼이 Argo CD로 관리하는 앱입니다. GitHub 레포로 새 앱을 등록하거나 플랫폼 밖에서 돌던 앱을 가져올 수 있고, 게이트웨이 뒤에서 한 곳에서만 도는 앱은 다른 클러스터로 이전할 수 있습니다."
        acts={
          <>
            <a className="btn ghost" href="#onboard">
              <Icon name="download" size={16} />
              기존 앱 가져오기
            </a>
            <a className="btn ghost" href="#new">
              <Icon name="upload" size={16} />
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
  return <AppsBody m={useLiveApps()} filter={filter} observable />;
}
function SimAppsBody({ filter }: { filter: AppFilter }) {
  return <AppsBody m={useSimApps()} filter={filter} />;
}

function AppsBody({ m, filter, observable = false }: { m: AppsModel; filter: AppFilter; /** live mode only: the logs are the platform's */ observable?: boolean }) {
  const [observing, setObserving] = useState<string | null>(null);
  if (m.error) return <LoadError title="앱 목록을 불러오지 못했습니다." error={m.error} />;
  if (!m.apps) return <Skeleton box />;
  const health = new Map(m.apps.map((a) => [a.name, appHealth(a)]));
  const count = (f: AppFilter) => (f === "all" ? m.apps!.length : m.apps!.filter((a) => health.get(a.name) === f).length);
  const shown = filter === "all" ? m.apps : m.apps.filter((a) => health.get(a.name) === filter);
  return (
    <>
      <nav className="metrics tiles" aria-label="상태로 앱 거르기">
        {TILES.map(([f, label, note]) => (
          <a key={f} className={"metric" + (f === "problem" && count(f) > 0 ? " bad" : "")} href={f === "all" ? "#apps" : "#apps-" + f} aria-current={f === filter ? "true" : undefined}>
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
        <AppsList apps={shown} now={m.now} busy={m.busy} full onObserve={observable ? setObserving : undefined} />
      )}
      {observing && <AppObservationDialog app={observing} onClose={() => setObserving(null)} />}
    </>
  );
}

/* ---------- detail ---------- */

export function AppDetail({ id, tab = "overview" }: { id: string; tab?: AppTab }) {
  return useLive() ? <LiveAppDetail id={id} tab={tab} /> : <SimAppDetail id={id} tab={tab} />;
}
function LiveAppDetail({ id, tab }: { id: string; tab: AppTab }) {
  const m = useLiveApp(id);
  // One read of the secret names for the whole page (overview summary and secrets tab), once the app is known to be registered: a file app has none.
  const s = useLiveSecrets(m.app?.deploy ? id : "");
  return <AppDetailView m={m} s={s} name={id} tab={tab} />;
}
function SimAppDetail({ id, tab }: { id: string; tab: AppTab }) {
  const { S } = useSim();
  const m = useSimApp(id);
  const s = useSimSecrets(m.app?.deploy ? id : "");
  return <AppDetailView m={m} s={s} name={id} tab={tab} fileDetails={S.apps[id] ? <FileAppDemoInfo id={id} /> : undefined} />;
}

/** The app page's head: the name with where the app comes from, one line about it, and the actions. */
function AppHead({ name, source, line, acts }: { name: string; source?: string; line?: ReactNode; acts?: ReactNode }) {
  return (
    <div className="appd-head">
      <div className="appd-title">
        <div className="appd-name">
          <h1 className="icon-label"><Icon name="boxes" size={24} /><span>{name}</span></h1>
          {source && <Chip>{source}</Chip>}
        </div>
        {line && <p>{line}</p>}
      </div>
      {acts && <div className="acts">{acts}</div>}
    </div>
  );
}

/** A card whose title is a heading; `side` sits at the right of the title. */
function Card({ title, side, children }: { title: ReactNode; side?: ReactNode; children: ReactNode }) {
  return (
    <section className="box">
      <div className="bh">
        <h2>{title}</h2>
        {side}
      </div>
      {children}
    </section>
  );
}

/** One cell per environment, always above the tabs. */
function EnvStrip({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="appd-envsec" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="box appd-envs">{children}</div>
    </section>
  );
}
function EnvCell({ env, chip, children }: { env: string; chip: ReactNode; children: ReactNode }) {
  return (
    <div className="appd-env">
      <div className="appd-envh">
        <b><EnvLabel env={env} label={envName(env)} /></b>
        {chip}
      </div>
      {children}
    </div>
  );
}

/** One environment of a database pair: whether the gateway sends it the writes, and its database's role. */
function DBRoleLine({ r }: { r: DBRole }) {
  return (
    <span className="appd-dbrole">
      {r.traffic && <Chip kind={r.traffic === "active" ? "ok" : "neu"}>{r.traffic === "active" ? "트래픽 받는 중" : "대기"}</Chip>}
      <span className="hint">DB {r.role === "unknown" ? "역할 미확인" : r.role === "primary" ? "primary" : "replica(읽기 전용)"}{r.traffic || r.observed || r.role === "unknown" ? "" : ", 처음 만든 역할"}</span>
    </span>
  );
}

/**
 * A "더 보기" disclosure: a button that shows a few rarer actions under it. A click outside, focus moving
 * out of it, or choosing an action closes it; Escape closes it and puts focus back on the button.
 */
function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div
      className="appd-more"
      ref={ref}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button ref={button} type="button" className="btn ghost" aria-label="더 보기" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      <div id={id} className="appd-menu" hidden={!open} onClick={() => setOpen(false)}>
        {children}
      </div>
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="page appd-page">
      <AppHead name="앱을 찾을 수 없습니다" />
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
type Busy = "" | "deploy" | "redeploy" | "delete" | "add" | "remove" | "add-env" | "remove-env";

const triggerText = (x: Deployment) => TRIGGER_LABEL[x.trigger] + (x.trigger === "push" ? " (" + x.triggeredBy + ")" : "");

function AppDetailView({ m, s, name, tab, fileDetails }: { m: AppModel; s: SecretsModel; name: string; tab: AppTab; fileDetails?: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
  const [msg, setMsg] = useState("");
  const [invalid, setInvalid] = useState<AppSpecValidation>();
  /** the add-environment form is open */
  const [addingEnv, setAddingEnv] = useState(false);
  /** the environment whose removal is being confirmed, and why the last try failed */
  const [removingEnv, setRemovingEnv] = useState("");
  const [removeEnvError, setRemoveEnvError] = useState("");
  /** what the last finished action did, when it stays on this page */
  const [done, setDone] = useState("");
  /** the environments taken out on this page; Argo CD may still be deleting them when one is added again */
  const [removedEnvs, setRemovedEnvs] = useState<string[]>([]);
  const migWarnId = useId();
  // Once opened, the instances and secrets tabs stay mounted (hidden on the other tabs): an open form, a staged change, the
  // redeploy offer and an answer that arrives meanwhile all outlive a tab switch, as on the one long page before.
  const [kept, setKept] = useState<AppTab[]>([]);
  if ((tab === "instances" || tab === "secrets") && !kept.includes(tab)) setKept([...kept, tab]);
  const a = m.app;
  if (!a) {
    if (m.notFound) return <NotFound id={name} />;
    return (
      <div className="page appd-page">
        <AppHead name={name} />
        {m.error ? <LoadError title="앱을 불러오지 못했습니다." error={m.error} /> : <Skeleton box />}
      </div>
    );
  }
  const d = a.deploy;
  const deps = m.deployments ?? [];
  const running = deps.find((x) => !isFinalDeploymentStatus(x.status));
  const def = "기본 인스턴스(" + a.name + ")";
  // the database pair's roles now, by where the gateway sends the writes (ADR 0030); none without a pair
  const roles = d?.dbTopology ? dbRoles(d.dbTopology, m.writeBackend, d.environments) : undefined;
  // ADR 0037: a pair whose replica is not one of the app's environments yet; a server from before it sends no replicaPresent
  const peerMissing = d?.dbTopology?.replicaPresent === false;
  // why the pair cannot be migrated now; a warning beside 이전, which stays a link: the migration page and the
  // platform's start check again, and an unknown or passing problem must not hide the way there
  const blocked = readinessBlock(d?.dbTopology?.readiness);
  const readiness = d?.dbTopology?.readiness;
  // the platform refuses an environment change while a deployment of the app is not finished
  const envBusyWhy = running ? "배포가 진행 중이라 끝난 뒤 환경을 더하거나 뺄 수 있습니다" : "";
  /** Why `env` cannot be taken out, or "" when it can (the first environment has no button). */
  const removeWhy = (env: string): string => {
    if (d?.dbTopology && d.environments.length > 2) return "세 환경 DB 그룹의 환경 제거는 아직 지원하지 않습니다";
    if (env === m.writeBackend) return "지금 쓰기를 받는 환경이라 뺄 수 없습니다";
    if (readiness?.environments.find((e) => e.env === env)?.role === "primary" || roles?.[env]?.role === "primary") return "지금 DB primary가 있는 환경이라 뺄 수 없습니다";
    return envBusyWhy;
  };
  /**
   * Adding `env` again would deploy it again (202): the default instance's newest deployment that got there (one that
   * stopped before, such as a failed build, is passed over) is not healthy there, or none got there. Not while one runs.
   */
  const addFailed = (env: string): boolean => {
    if (!m.deployments || running) return false;
    const at = (x: Deployment) => x.environments.find((e) => e.env === env)?.status;
    const got = deps.find((x) => (x.instance || a.name) === a.name && at(x) !== undefined && at(x) !== "pending");
    return !got || at(got) !== "healthy";
  };
  const tabHref = (t: string) => "#app-" + a.name + (t === "overview" ? "" : "/" + t);

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
  /** Takes `env` out of the app (ADR 0037); the deployment to the other environments shows in the running banner. */
  async function removeEnv() {
    const env = removingEnv;
    setBusy("remove-env");
    setRemoveEnvError("");
    setDone("");
    try {
      const err = await m.removeEnvironment(env);
      if (err) setRemoveEnvError(err);
      else {
        setRemovedEnvs((l) => [...l, env]);
        setRemovingEnv("");
        setDone(envName(env) + " 환경을 뺐습니다. Argo CD가 그 환경의 네임스페이스와 DB, 파일을 지우고 있습니다.");
      }
    } finally {
      setBusy("");
    }
  }
  /** Adds `env` again after its deployment there failed; the server deploys it again (202). */
  async function retryAddEnv(env: string) {
    setBusy("add-env");
    setMsg("");
    setDone("");
    try {
      const r = await m.addEnvironment(env);
      if ("deploymentId" in r) navigate("#deploy-" + r.deploymentId);
      else if ("error" in r) setMsg(r.error);
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
          <Icon name="refresh-cw" size={16} />
          기본 브랜치 다시 배포
        </button>
      )}
      {d && (
        <button
          type="button"
          className="btn ghost"
          disabled={!!busy || addingEnv || !!envBusyWhy}
          title={envBusyWhy || undefined}
          aria-describedby={envBusyWhy ? "appd-running" : undefined}
          onClick={() => setAddingEnv(true)}
        >
          <Icon name="plus" size={16} />
          환경 추가
        </button>
      )}
      {(a.environments.length > 0 || !!d) && (
        <a className="btn ghost" href={"#migrate-app?app=" + encodeURIComponent(a.name)} aria-describedby={blocked ? migWarnId : undefined}>
          <Icon name="arrow-right-left" size={16} />
          {migrationEntryLabel(a)}
        </a>
      )}
      {d && (
        <MoreMenu>
          <button type="button" disabled={!!busy || confirming} onClick={() => setConfirming(true)}>
            앱 삭제
          </button>
        </MoreMenu>
      )}
    </>
  );
  const line = d ? (
    <>
      <a className="m" href={"https://github.com/" + d.repo} target="_blank" rel="noreferrer">
        {d.repo}
      </a>
      , 기본 브랜치 <span className="m">{d.branch}</span>
      {d.url && (
        <>
          ,{" "}
          <a href={d.url} target="_blank" rel="noreferrer">
            {d.url.replace(/^https?:\/\//, "")}
          </a>
        </>
      )}
    </>
  ) : (
    "PLATFORM_APPS_FILE에 있는 앱입니다. 클러스터 사이로 이전할 수 있습니다."
  );
  const migration = a.environments.length > 0 && (
    <Card title="이전 설정">
      <Table
        head={["환경", "CNPG 클러스터", "DB 주소", "버킷"]}
        rows={a.environments.map((e) => [td(<EnvLabel env={e.env} label={envName(e.env)} />), td(e.cnpgCluster, "m"), td(e.dbHost, "m"), td(e.bucket ?? "-", "m")])}
      />
    </Card>
  );

  let panel: ReactNode = null;
  if (d && tab === "overview") {
    const last = deps[0];
    panel = (
      <>
        <div className="appd-cols">
          <div className="appd-main">
            <Card title="최근 배포" side={last && <DeployChip s={last.status} />}>
              <div className="bb">
                {last ? (
                  <dl className="kv">
                    <dt>배포</dt>
                    <dd>
                      <a className="m" href={"#deploy-" + last.id}>
                        {last.id}
                      </a>
                    </dd>
                    <dt>트리거</dt>
                    <dd>{triggerText(last)}</dd>
                    <dt>커밋</dt>
                    <dd className="m">{last.ref + " " + short(last.commit)}</dd>
                    <dt>환경</dt>
                    <dd><DeploymentEnvLabels environments={last.environments} /></dd>
                    <dt>시간</dt>
                    <dd>
                      {ago(last.createdAt, m.now)} 시작, {isFinalDeploymentStatus(last.status) ? dur(elapsedSec(last, m.now)) + " 걸림" : "진행 중"}
                    </dd>
                  </dl>
                ) : m.deployments ? (
                  <p className="hint">아직 배포가 없습니다. 기본 브랜치 다시 배포를 누르면 여기에 나옵니다.</p>
                ) : (
                  <Skeleton />
                )}
              </div>
            </Card>
            <Card
              title={def + " platform.yaml"}
              side={
                <span className="hint">
                  <span className="m">{short(d.specCommit)}</span>에서 읽음
                </span>
              }
            >
              <div className="bb">
                <SpecSummary spec={d.spec} />
              </div>
            </Card>
          </div>
          <div className="appd-side">
            <Card title="배포 설정">
              <div className="bb">
                <dl className="kv">
                  <dt>기본 브랜치</dt>
                  <dd className="m">{d.branch}</dd>
                  <dt>기본 인스턴스 자동 배포</dt>
                  <dd>{d.autoDeploy ? "켜짐: push할 때마다 배포합니다" : "꺼짐: 기본 브랜치 다시 배포를 눌러야 배포합니다"}</dd>
                  <dt>기본 인스턴스 공개 주소</dt>
                  <dd>{d.url ? <ExtLink href={d.url} /> : "없음"}</dd>
                  <dt>등록</dt>
                  <dd>
                    {d.createdBy}, {ago(d.createdAt, m.now)}
                  </dd>
                </dl>
              </div>
            </Card>
            <Card
              title={<span className="icon-label"><Icon name="key-round" /><span>시크릿</span></span>}
              side={
                <a className="btn ghost sm" href={tabHref("secrets")}>
                  관리
                </a>
              }
            >
              <div className="bb">
                <SecretsSummary s={s} />
              </div>
            </Card>
          </div>
        </div>
        {d.dbTopology && <DBPair t={d.dbTopology} envs={d.environments} />}
        {migration}
      </>
    );
  } else if (d && tab === "deploys") {
    panel = (
      <Card title="배포 이력" side={deps.length > 0 && <span className="hint">{deps.length}건</span>}>
        {!m.deployments ? (
          <Skeleton />
        ) : deps.length === 0 ? (
          <div className="empty-state">
            <p className="hint">아직 배포가 없습니다. 기본 브랜치 다시 배포를 누르거나 브랜치에 push하면 여기에 쌓입니다.</p>
          </div>
        ) : (
          <Table
            head={["배포", "브랜치", "상태", "트리거", "커밋", "환경", "시작", "소요"]}
            rows={deps.map((x) => [
              td(<a href={"#deploy-" + x.id}>{x.id}</a>, "m"),
              td(x.branch || "-", "m"),
              td(<DeployChip s={x.status} />),
              td(triggerText(x), "nw"),
              td(x.ref + " " + short(x.commit), "m"),
              td(<DeploymentEnvLabels environments={x.environments} />),
              td(ago(x.createdAt, m.now), "nw"),
              td(isFinalDeploymentStatus(x.status) ? dur(elapsedSec(x, m.now)) : "진행 중", "num"),
            ])}
          />
        )}
      </Card>
    );
  }

  return (
    <div className="page appd-page">
      <AppHead name={a.name} source={d ? "GitHub" : "파일 앱"} line={line} acts={acts} />
      {blocked && (
        <div className="box fillbox" id={migWarnId}>
          <div className="bb">
            <b>이전 준비 안 됨</b>
            <p>{blocked}</p>
          </div>
        </div>
      )}
      {confirming && d && (
        <ConfirmDelete label="앱 삭제 확인" kind="앱" name={a.name} busy={!!busy} deleting={busy === "delete"} onConfirm={remove} onCancel={() => setConfirming(false)}>
          gitops 저장소에서 {m.instances.map((i) => "apps/" + i.name + "/").join(", ")}을 지우고, Argo CD가 환경 {d.environments.length}곳({d.environments.map((e) => envName(e)).join(", ")})의 앱과 DB, 버킷을 지웁니다. 데이터는 되돌릴 수 없습니다.
        </ConfirmDelete>
      )}
      {addingEnv && d && (
        <AddEnvironment
          m={m}
          have={d.environments}
          topology={d.dbTopology}
          removed={removedEnvs}
          busy={!!busy}
          busyWhy={envBusyWhy}
          setBusy={(on) => setBusy(on ? "add-env" : "")}
          onCancel={() => setAddingEnv(false)}
        />
      )}
      {removingEnv && d && (
        <ConfirmDelete
          key={removingEnv}
          label="환경 빼기 확인"
          kind="환경"
          name={removingEnv}
          busy={!!busy}
          deleting={busy === "remove-env"}
          error={removeEnvError && "환경을 빼지 못했습니다. " + removeEnvError}
          onConfirm={removeEnv}
          onCancel={() => setRemovingEnv("")}
        >
          {"앱의 모든 인스턴스에서 " +
            envName(removingEnv) +
            " 환경을 뺍니다. gitops 저장소에서 각 인스턴스의 " +
            removingEnv +
            // only the pair's replica is a copy of the app's database; elsewhere say no more than what goes
            (d.dbTopology?.replica === removingEnv && roles?.[removingEnv]?.role !== "primary"
              ? ".yaml을 지우고, Argo CD가 이 환경의 네임스페이스와 그 안의 DB 복제본, 파일(버킷)을 지웁니다. 데이터는 되돌릴 수 없습니다. 다른 환경은 그대로 두고, DB 짝 설정은 남아 나중에 같은 환경을 다시 더할 수 있습니다."
              : ".yaml을 지우고, Argo CD가 이 환경의 네임스페이스와 그 안의 파일(버킷)을 지웁니다. 데이터는 되돌릴 수 없습니다. 다른 환경은 그대로 둡니다.")}
        </ConfirmDelete>
      )}
      {done && (
        <div className="box fillbox" role="status">
          <div className="bb">
            <p>{done}</p>
          </div>
        </div>
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
        <div className="box fillbox" role="status" id="appd-running">
          <div className="bb">
            <div className="actrow">
              <DeployChip s={running.status} />
              <span>
                배포 {running.id}가 진행 중입니다 ({[running.instance, short(running.commit), ago(running.createdAt, m.now)].filter(Boolean).join(", ")}).
              </span>
              {d && <span className="hint">배포가 끝나야 환경을 더하거나 뺄 수 있습니다.</span>}
              <a className="more" href={"#deploy-" + running.id}>
                진행 보기
              </a>
            </div>
          </div>
        </div>
      )}
      {d ? (
        <>
          <EnvStrip title={def + " 환경별 상태"}>
            {d.status.map((s) => (
              <EnvCell key={s.env} env={s.env} chip={<Chip kind={ENV_STATUS[s.status][0]}>{ENV_STATUS[s.status][1]}</Chip>}>
                <span className="hint">{[s.syncStatus, s.healthStatus].filter(Boolean).join(", ") || "Argo CD 상태 없음"}</span>
                {(s.commit || s.updatedAt) && (
                  <span className="hint">
                    <span className="m">{short(s.commit)}</span>, {ago(s.updatedAt, m.now)}
                  </span>
                )}
                {s.url && <ExtLink href={s.url} />}
                {roles?.[s.env] && <DBRoleLine r={roles[s.env]} />}
                {peerMissing && s.env === d.dbTopology!.primary && (
                  <span className="appd-dbrole">
                    <Chip kind="warn">상대 환경 없음</Chip>
                    <span className="hint">{"DB 짝 " + envName(d.dbTopology!.replica) + " 환경이 아직 앱에 없습니다"}</span>
                  </span>
                )}
                {/* the first environment stays: the app's database was born primary there (ADR 0037) */}
                {s.env !== d.environments[0] && (
                  <div className="actrow">
                    {addFailed(s.env) && (
                      <button
                        type="button"
                        className="btn ghost sm"
                        aria-label={envName(s.env) + " 환경 추가 다시 시도"}
                        disabled={!!busy || !!envBusyWhy}
                        onClick={() => retryAddEnv(s.env)}
                      >
                        환경 추가 다시 시도
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn ghost sm"
                      aria-label={envName(s.env) + " 환경 빼기"}
                      disabled={!!busy || removingEnv === s.env || !!removeWhy(s.env)}
                      aria-describedby={removeWhy(s.env) ? "appd-rm-why-" + s.env : undefined}
                      onClick={() => {
                        setRemovingEnv(s.env);
                        setRemoveEnvError("");
                        setDone("");
                      }}
                    >
                      환경 빼기
                    </button>
                    {removeWhy(s.env) && (
                      <span className="hint" id={"appd-rm-why-" + s.env}>
                        {removeWhy(s.env)}
                      </span>
                    )}
                  </div>
                )}
              </EnvCell>
            ))}
          </EnvStrip>
          <div className="appd-tabs">
            <Tabs
              label="앱 정보"
              current={tab}
              hrefOf={tabHref}
              items={[
                { id: "overview", label: "개요" },
                {
                  id: "instances",
                  label: (
                    <>
                      인스턴스{" "}
                      <span className="appd-cnt">
                        {m.instances.length}/{MAX_INSTANCES}
                      </span>
                    </>
                  ),
                },
                { id: "secrets", label: "시크릿" },
                { id: "deploys", label: <>배포 이력 {m.deployments && <span className="appd-cnt">{deps.length}</span>}</> },
              ]}
            />
            {panel}
            {kept.includes("instances") && (
              <div hidden={tab !== "instances"}>
                <Instances m={m} app={a.name} busy={busy} setBusy={setBusy} deploy={redeploy} redeployNoBuild={redeployNoBuild} />
              </div>
            )}
            {kept.includes("secrets") && (
              <div hidden={tab !== "secrets"}>
                <AppSecrets s={s} m={m} busy={!!busy} setRedeploying={(on) => setBusy(on ? "redeploy" : "")} />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {migration}
          {fileDetails}
        </>
      )}
    </div>
  );
}

/**
 * The form that adds one of the server's environments to the app (ADR 0037). On success the page follows the
 * deployment that takes the app there, as after any other deploy button.
 */
function AddEnvironment(p: {
  m: AppModel;
  have: string[];
  topology?: AppDBTopology;
  /** environments taken out on this page, which Argo CD may still be deleting */
  removed: string[];
  busy: boolean;
  /** why nothing can be added now (a deployment in progress), or "" */
  busyWhy: string;
  setBusy: (on: boolean) => void;
  onCancel: () => void;
}) {
  // Add the original peer first; a complete pair may then gain a third member.
  // The server verifies DB bootstrap readiness and configured host templates.
  const peerPresent = !!p.topology && p.have.includes(p.topology.replica);
  const options: EnvOption[] = (p.m.envOptions ?? []).filter((o) => !p.have.includes(o.value) && (!p.topology || (p.have.length < 3 && (peerPresent || o.value === p.topology.replica))));
  const [env, setEnv] = useState("");
  const [error, setError] = useState("");
  const picked = options.some((o) => o.value === env) ? env : (options[0]?.value ?? "");
  const id = useId();
  const justRemoved = p.removed.includes(picked);

  async function add() {
    p.setBusy(true);
    setError("");
    try {
      const r = await p.m.addEnvironment(picked);
      if ("deploymentId" in r) navigate("#deploy-" + r.deploymentId);
      else if ("error" in r) setError(r.error);
    } finally {
      p.setBusy(false);
    }
  }

  return (
    <div className="box" role="group" aria-label="환경 추가">
      <div className="bb">
        <b>환경 추가</b>
        <p>기본 인스턴스의 마지막 정상 배포(커밋과 이미지)를 빌드 없이, 새 환경을 포함한 앱의 모든 환경에 다시 배포합니다. 새 환경은 이전하기 전까지 요청을 받지 않습니다.</p>
        {p.topology && !peerPresent && (
          <p>
            {"postgres DB는 새 환경에서 지금 DB의 replica로 태어납니다. DB 짝이 " +
              envName(p.topology.primary) +
              "와 " +
              envName(p.topology.replica) +
              "로 정해져 있어 " +
              envName(p.topology.replica) +
              "만 더할 수 있습니다. 다른 환경에서는 DB가 따로 태어나 이전할 수 없어 플랫폼이 거절합니다."}
          </p>
        )}
        {p.topology && peerPresent && <p>DB 복제 그룹은 최대 세 환경을 지원합니다. 세 번째 환경은 DB를 처음 primary로 만든 {envName(p.topology.primary)}에서 복제하므로, 그 환경으로 먼저 이전하고 정상 상태를 확인해야 합니다.</p>}
        {p.m.envOptionsError ? (
          <p className="hint" role="alert">
            {"서버의 환경 목록을 읽지 못했습니다. " + p.m.envOptionsError}
          </p>
        ) : !p.m.envOptions ? (
          <Skeleton />
        ) : options.length === 0 ? (
          <p className="hint">{p.topology ? "DB 복제 그룹에 더할 수 있는 환경이 없습니다." : "더할 수 있는 환경이 없습니다. 서버의 환경이 모두 이 앱에 있습니다."}</p>
        ) : (
          <div className="field">
            <label htmlFor={id}>더할 환경</label>
            <select id={id} value={picked} disabled={p.busy} onChange={(e) => setEnv(e.target.value)} aria-describedby={justRemoved ? id + "-removed" : undefined}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {p.removed.includes(o.value) ? o.label + " (정리 중일 수 있음)" : o.label}
                </option>
              ))}
            </select>
            {justRemoved && (
              <small id={id + "-removed"}>
                방금 뺀 환경입니다. Argo CD가 예전 환경을 다 지울 때까지 플랫폼이 다시 더하기를 거절하니, 그때는 잠시 뒤 다시 누르세요.
              </small>
            )}
          </div>
        )}
        {p.busyWhy && <p className="hint">{p.busyWhy}</p>}
        {error && (
          <div role="alert">
            <b>환경을 더하지 못했습니다.</b>
            <p>{error}</p>
          </div>
        )}
        <div className="actrow">
          <button type="button" className="btn primary" disabled={p.busy || !picked || !!p.busyWhy} onClick={add}>
            {p.busy ? "추가하는 중" : "환경 추가"}
          </button>
          <button type="button" className="btn ghost" disabled={p.busy} onClick={p.onCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

/** One row of the pair: the readiness check's view of an environment, or (an older server) only whether it is the app's. */
type PairRow = Partial<AppDBReadinessEnvironment> & { env: string; inApp: boolean };

/** An environment's part in the pair, in a chip. */
function pairChip(e: PairRow): ReactNode {
  if (!e.inApp) return <Chip kind="warn">상대 환경 없음</Chip>;
  if (e.deployed === undefined) return <Chip kind="neu">앱 환경</Chip>;
  if (e.role === "unknown") return <Chip kind="neu">확인 불가</Chip>;
  return e.deployed && e.gatewayBackend && e.healthy ? <Chip kind="ok">준비됨</Chip> : <Chip kind="warn">준비 중</Chip>;
}

const yesNo = (v: boolean | undefined, yes: string, no: string) => (v === undefined ? "-" : v ? yes : no);

/**
 * The app's database pair (ADR 0030, 0037): each environment's part in it and whether a migration can move the
 * app now. Without readiness (an older server), only whether each environment is the app's.
 */
function DBPair({ t, envs }: { t: AppDBTopology; envs: string[] }) {
  const r = t.readiness;
  const rows: PairRow[] = r?.environments ?? (envs.length > 2 ? envs : [t.primary, t.replica]).map((env) => ({ env, inApp: env === t.replica ? t.replicaPresent !== false : envs.includes(env) }));
  // t.primary and t.replica are the roles the databases were created with; a migration swaps them, so the roles now come from the readiness
  const roleEnv = (role: "primary" | "replica") => {
    const found = r?.environments.filter((e) => e.role === role) ?? [];
    return found.length === 1 ? found[0].env : undefined;
  };
  const nowPrimary = roleEnv("primary");
  const nowReplica = roleEnv("replica");
  return (
    <Card title={envs.length > 2 ? "DB 복제 그룹" : "DB 짝"} side={r && <Chip kind={r.ready ? "ok" : "warn"}>{r.ready ? "이전 준비됨" : "이전 준비 안 됨"}</Chip>}>
      <div className="bb">
        <p className="hint">
          {envs.length > 2 ? "등록된 세 환경의 DB 상태입니다. DB 역할을 읽지 못하면 미확인으로 표시하며, 이전 가능한 복제 경로는 실행 전에 다시 검사합니다." : (nowPrimary && nowReplica
            ? "DB는 지금 " + envName(nowPrimary) + "에서 primary로, " + envName(nowReplica) + "에서 그 replica로 있습니다."
            : "DB는 처음 " + envName(t.primary) + "에서 primary로, " + envName(t.replica) + "에서 그 replica로 만들어졌습니다. 이전하면 역할이 서로 바뀝니다.") + " 두 환경이 모두 준비되면 이전할 수 있습니다."}
        </p>
      </div>
      <Table
        head={["환경", "DB 짝", "배포", "게이트웨이 백엔드", "DB 역할", "CNPG 상태"]}
        rows={rows.map((e) => [
          td(<EnvLabel env={e.env} label={envName(e.env)} />),
          td(pairChip(e), "nw"),
          td(yesNo(e.deployed, "정상", "아직"), "nw"),
          td(yesNo(e.gatewayBackend, "있음", "없음"), "nw"),
          td(e.role === undefined ? "-" : e.role === "unknown" ? "알 수 없음" : e.role, "nw"),
          td(e.phase ?? "-"),
        ])}
      />
    </Card>
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

/** One row per instance (ADR 0015), the form that adds a branch (opened by its button), and the typed confirmation that removes one. */
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
  const [adding, setAdding] = useState(false);
  /** the form was closed with 취소: the 브랜치 추가 button that comes back takes the focus */
  const [closed, setClosed] = useState(false);
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
  function close() {
    setAdding(false);
    setClosed(true);
    setBranch("");
    setRefused(undefined);
  }

  return (
    <div className="appd-stack">
      <section className="box">
        <div className="bh">
          <div className="appd-titles">
            <h2>브랜치별 인스턴스</h2>
            <span className="hint">
              기본 브랜치 외에는 운영자가 추가한 브랜치만 배포합니다. 브랜치마다 주소, 네임스페이스, DB, 버킷이 따로 생기고, 기본 인스턴스를 포함해 {MAX_INSTANCES}개까지 둘 수 있습니다.
            </span>
          </div>
          {listed && (
            <div className="actrow">
              <span className="hint">
                인스턴스 {m.instances.length}/{MAX_INSTANCES}개
              </span>
              {!adding && (
                <button type="button" className="btn" disabled={!!busy} autoFocus={closed} onClick={() => setAdding(true)}>
                  <Icon name="plus" size={16} />
                  브랜치 추가
                </button>
              )}
            </div>
          )}
        </div>
        <Table
          head={["브랜치", "인스턴스", "주소", "환경별 상태", "최근 배포", "자동 배포", ""]}
          rows={m.instances.map((i) => [
            td(
              <span className="chips">
                <span className="m">{i.branch || "-"}</span>
                {i.default && <Chip>기본</Chip>}
              </span>,
            ),
            td(i.name, "m nw"),
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
        {waiting.length > 0 && (
          <p className="hint appd-part">
            {waiting.map((i) => i.name).join(", ")}: {REDEPLOY_WAIT}.
          </p>
        )}
        {listed && adding && (
          <div className="appd-part">
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
                  autoFocus
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
              <button type="button" className="btn ghost" disabled={!!busy} onClick={close}>
                취소
              </button>
            </div>
          </div>
        )}
      </section>
      {!listed && <p className="hint">서버가 인스턴스 목록을 보내지 않아 브랜치를 추가하거나 지울 수 없습니다.</p>}
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
      {refused?.error && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <b>브랜치를 추가하지 못했습니다.</b>
            <p>{refused.error}</p>
          </div>
        </div>
      )}
      {refused?.validation && <SpecResult check={{ data: refused.validation, error: undefined, loading: false, reload: () => setRefused(undefined) }} />}
    </div>
  );
}

/** Extra evidence the file-app simulation has, below the same API-backed app detail view. */
function FileAppDemoInfo({ id }: { id: string }) {
  const { S } = useSim();
  const a = S.apps[id];
  const n = SAMPLE.services.length * SAMPLE.replicas;
  return (
    <>
      <p className="hint">아래 실행 위치·리소스·변경 이력은 시연 데이터입니다. 파일 앱은 일반 모드와 같이 이전 설정을 사용하며 GitHub 배포·시크릿 탭을 제공하지 않습니다.</p>
      <EnvStrip title="시연 실행 위치">
        <EnvCell env={a.loc} chip={<Chip kind="ok">정상</Chip>}>
          <span className="m">{"Pod " + n + "/" + n}</span>
          <span className="hint">트래픽 100%</span>
        </EnvCell>
        {a.prev && (
          <EnvCell env={a.prev} chip={<Chip>축소됨, 읽기 전용</Chip>}>
            <span className="hint">트래픽 0%</span>
          </EnvCell>
        )}
      </EnvStrip>
      <div className="box fillbox">
        <div className="bb">
          <p>
            서비스 주소 <span className="m">https://{SAMPLE.domain}</span>는 Cloudflare와 게이트웨이를 거칩니다. 게이트웨이가 모든 요청을 {ENV[a.loc].name}로 보내고 있습니다.
          </p>
        </div>
      </div>
      <Card title="리소스">
        <Table head={["종류", "이름", "내용"]} rows={a.res.map((r) => [td(r[0]), td(r[1], "m"), td(r[2])])} />
      </Card>
      <Card title="변경 이력">
        <Table head={["커밋", "내용", "시각", "소요"]} rows={a.deploys.map((r) => [td(r[0], "m"), td(r[1]), td(r[2], "nw"), td(r[3], "num")])} />
      </Card>
    </>
  );
}
