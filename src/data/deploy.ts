// Views of the apps registered from GitHub and their deployments, from the simulation or the platform API.
// Both sides hand over contract types (App, Deployment, DeploymentEvent, AppSpecValidation, GitHubRepo),
// so every page has one code path. Pages mount a live hook only in live mode: it fetches as soon as it mounts.
import { useCallback, useEffect, useRef, useState } from "react";
import { addAppEnvironment, ApiError, createApp, createAppInstance, createDeployment, deleteApp, deleteAppInstance, removeAppEnvironment, specInvalid } from "../api/client";
import { useApp, useApps, useAppSpecValidation, useDeployment, useDeployments, useEnvironments, useGitHubRepos, useTraffic, type SpecCheck } from "../api/hooks";
import { isFinalDeploymentStatus } from "../api/sse";
import type { App, AppCreateRequest, AppInstance, AppSpecValidation, Deployment, DeploymentEvent, GitHubRepo } from "../api/types";
import { ENV, ENV_ORDER, SAMPLE, sampleBucket } from "../sim/data";
import * as dep from "../sim/deploy";
import { iso } from "../sim/mig";
import { migActive, migLabel, type SimState } from "../sim/state";
import { useSim } from "../sim/store";
import { errorText } from "./live";
import type { EnvOption } from "./migration";

/** What a register or deploy button got back: the deployment to follow, what failed in platform.yaml, or why it was refused. */
export type SubmitResult = { deploymentId: string } | { validation: AppSpecValidation } | { error: string };

export interface NewAppModel {
  live: boolean;
  repos: GitHubRepo[] | undefined;
  reposError: string;
  /** full name of a registered repository → its app name */
  registered: Record<string, string>;
  envs: EnvOption[] | undefined;
  envsError: string;
  /** the check of the repo and branch last given to setQuery */
  check: SpecCheck;
  setQuery(repo: string, branch: string): void;
  submit(req: AppCreateRequest): Promise<SubmitResult>;
}

export interface AppsModel {
  live: boolean;
  /** file apps (migration) first, then the other registered apps, as GET /v1/apps lists them */
  apps: App[] | undefined;
  error: string;
  now: number;
  /** app name → work in progress on it besides deploys (a migration in the simulation) */
  busy: Record<string, string>;
}

export interface AppModel {
  live: boolean;
  app: App | undefined;
  /** the app's instances, the default one first (instancesOf) */
  instances: AppInstance[];
  error: string;
  notFound: boolean;
  /** newest first, of every instance */
  deployments: Deployment[] | undefined;
  now: number;
  /** live, for an app with a database pair (deploy.dbTopology): the gateway's write backend; undefined when it did not answer */
  writeBackend?: string;
  /** Deploys the head of `branch` into its instance; without one, the app's own branch (the default instance). */
  redeploy(branch?: string): Promise<SubmitResult>;
  /** Deploys the last healthy deployment of `branch`'s instance again without a build (trigger redeploy), with the secrets as they are now. */
  redeployNoBuild(branch: string): Promise<SubmitResult>;
  /** Deploys another branch as its own instance; the result is its first deployment. */
  addBranch(branch: string, autoDeploy: boolean): Promise<SubmitResult>;
  /** Resolves with an error message, or "" once the instance is removed. */
  removeInstance(instance: string): Promise<string>;
  /** Resolves with an error message, or "" once the app is unregistered. */
  remove(): Promise<string>;
  /** the server's environments (GET /v1/envs), to pick one to add; undefined while loading or after envOptionsError */
  envOptions: EnvOption[] | undefined;
  /** why the server's environments could not be read */
  envOptionsError: string;
  /** Adds an environment to the app (ADR 0037); the result is the deployment that takes the app there. */
  addEnvironment(env: string): Promise<SubmitResult>;
  /** Takes an environment out of the app with its data there. Resolves with an error message, or "" once it is out. */
  removeEnvironment(env: string): Promise<string>;
}

export interface DeploymentModel {
  live: boolean;
  deployment: Deployment | undefined;
  events: DeploymentEvent[];
  /** the deployed app, for its public URL */
  app: App | undefined;
  /** a connection problem, or why the watch stopped */
  error: string;
  notFound: boolean;
  connected: boolean;
  /** epoch ms, for the elapsed timer */
  now: number;
}

/** Why a no-build redeploy waits: the unfinished deployment already carries the secrets as they were at its gitops commit. */
export const REDEPLOY_WAIT = "진행 중인 배포가 끝난 뒤 재배포할 수 있습니다. 진행 중인 배포도 커밋할 때의 시크릿을 씁니다";

/** Korean texts for the deploy calls' error codes, used for the simulation's refusals too. The server's English message is not repeated. */
const DEPLOY_ERRORS: Record<string, string> = {
  app_not_registered: "PLATFORM_APPS_FILE에만 있는 앱이라 여기서 배포하거나 지울 수 없습니다",
  github_not_configured: "서버에 GitHub App이 설정되어 있지 않습니다",
  github_unreachable: "GitHub에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요",
  gateway_unreachable: "트래픽 게이트웨이에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요",
  cluster_busy: "이전 중이라 트래픽 게이트웨이가 쓰기를 잡고 있습니다. 이전이 끝난 뒤 다시 시도하세요",
  branch_exists: "이 브랜치는 이미 배포하고 있습니다. 앱의 기본 브랜치이거나 이미 추가한 브랜치입니다",
  instance_exists: "이 브랜치의 인스턴스 이름을 다른 브랜치가 이미 쓰고 있습니다. feature/x와 feature-x처럼 인스턴스 이름이 같아지는 브랜치는 하나만 추가할 수 있습니다",
  instance_limit: "앱 하나에 인스턴스는 기본 인스턴스를 포함해 " + dep.MAX_INSTANCES + "개까지입니다. 인스턴스를 하나 지운 뒤 추가하세요",
  default_instance: "기본 인스턴스는 앱을 삭제할 때만 지울 수 있습니다",
  instance_not_found: "인스턴스를 찾을 수 없습니다. 이미 지워졌을 수 있습니다",
  nothing_to_redeploy: "이 인스턴스에는 아직 정상(healthy) 배포가 없어 재배포할 수 없습니다. 먼저 배포를 한 번 끝내세요",
  deployment_in_progress: REDEPLOY_WAIT,
  secrets_not_configured: "서버에 시크릿 키가 설정되어 있지 않습니다",
  secret_not_found: "시크릿을 찾을 수 없습니다. 다른 곳에서 지웠을 수 있습니다",
};

/** Korean texts for POST /v1/apps/{name}/environments (ADR 0037); the codes it shares with the deploy calls mean something else here. */
const ADD_ENV_ERRORS: Record<string, string> = {
  db_group_full: "DB 복제 그룹은 최대 세 환경을 지원합니다",
  db_bootstrap_primary_required: "DB를 처음 primary로 만든 환경으로 먼저 이전하고 정상 상태를 확인한 뒤 다시 추가하세요",
  db_primary_unknown: "새 복제본의 원본 DB 역할을 확인할 수 없습니다. 관리 서버의 클러스터 연결을 확인하세요",
  app_not_registered: "PLATFORM_APPS_FILE에만 있는 앱이라 환경을 더하거나 뺄 수 없습니다",
  environment_exists: "이 환경은 이미 앱에 있고, 그 환경을 담은 마지막 배포가 정상으로 끝났습니다",
  deployment_in_progress: "기본 인스턴스의 배포가 진행 중입니다(앞서 누른 환경 추가 포함). 배포가 끝난 뒤 다시 시도하세요",
  migration_in_progress: "이 앱의 이전이 진행 중이거나 게이트웨이가 쓰기를 잡고 있습니다. 이전이 끝난 뒤 다시 시도하세요",
  nothing_to_redeploy: "기본 인스턴스에 정상(healthy) 배포가 없어 환경을 더할 수 없습니다. 먼저 기본 브랜치를 배포하세요",
  environment_cleanup_pending:
    "앞서 뺀 이 환경을 Argo CD가 아직 지우고 있습니다(Application이나 네임스페이스의 서비스, Pod가 남아 있음). 예전 환경이 다 지워질 때까지 기다린 뒤 다시 더하세요",
  environment_cleanup_unknown: "앞서 뺀 이 환경이 다 지워졌는지 플랫폼이 확인하지 못했습니다. 잠시 뒤 다시 시도하세요",
  app_changed: "그사이 앱의 환경이나 브랜치가 바뀌어 아무것도 바꾸지 않았습니다. 화면이 새로 읽은 앱을 확인하고 다시 시도하세요",
  db_pair_unavailable:
    "이 앱의 DB를 이 환경과 짝(primary와 replica)으로 맺을 수 없어 환경을 더할 수 없습니다. 짝 없이 더하면 새 환경의 DB가 따로 태어나 다시는 이전할 수 없습니다. 이 기능 전에 한 환경으로 등록한 postgres 앱이면 앱을 삭제하고 다시 등록하세요",
  storage_not_configured: "앱에 s3 리소스가 있는데 이 환경에는 스토리지 드라이버가 설정되어 있지 않습니다",
  sealing_not_configured: "이 환경에 sealed-secrets 인증서가 없어 시크릿과 DB 비밀번호를 봉인할 수 없습니다",
  deployment_not_queued: "환경은 앱에 더했지만 배포를 넣지 못했습니다. 같은 환경으로 환경 추가를 다시 누르면 배포만 다시 넣습니다",
};

/** Korean texts for DELETE /v1/apps/{name}/environments/{env} (ADR 0037). */
const REMOVE_ENV_ERRORS: Record<string, string> = {
  db_group_removal_unsupported: "세 환경 DB 그룹의 환경 제거는 아직 지원하지 않습니다",
  app_not_registered: ADD_ENV_ERRORS.app_not_registered,
  env_not_found: "앱의 환경이 아닙니다. 이미 빠졌을 수 있습니다",
  primary_environment: "앱의 첫 환경은 뺄 수 없습니다. DB가 primary로 태어난 곳이고, 앱은 환경을 하나 이상 가져야 합니다",
  write_backend:
    "이 환경은 쓰기를 받고 있거나 받은 적이 있어(이전의 원본이나 대상) 뺄 수 없습니다. 이 환경의 DB에 앱 데이터가 있으므로 지우려면 앱을 삭제하세요",
  deployment_in_progress: "앱의 인스턴스 중 배포가 진행 중인 것이 있습니다. 배포가 끝난 뒤 다시 시도하세요",
  environment_has_files:
    "s3 리소스가 있고 공개 서비스가 없어, 앱이 이 환경의 버킷에 파일을 썼는지 알 수 없습니다. 환경을 빼면 그 버킷이 지워지므로 지우려면 앱을 삭제하세요",
  app_changed: ADD_ENV_ERRORS.app_changed,
  migration_in_progress: ADD_ENV_ERRORS.migration_in_progress,
  github_unreachable: "gitops 저장소(GitHub)에 연결하지 못했습니다. 환경은 아직 앱에 남아 있으니 잠시 뒤 다시 빼기를 누르세요",
  gateway_unreachable: "트래픽 게이트웨이에 연결하지 못했습니다. 환경은 아직 앱에 남아 있으니 잠시 뒤 다시 빼기를 누르세요",
  github_not_configured: DEPLOY_ERRORS.github_not_configured,
};

/** A short Korean message for a failed add or removal of an app's environment. */
export function envErrorText(e: unknown, removing: boolean): string {
  if (e instanceof ApiError) {
    const texts = removing ? REMOVE_ENV_ERRORS : ADD_ENV_ERRORS;
    if (Object.hasOwn(texts, e.code)) return texts[e.code];
    // the server's message lists its environments
    if (e.code === "env_not_found") return "서버에 없는 환경입니다: " + e.message;
    // a refusal newer than this console: its code and the server's sentence say what it is
    if (e.status === 409 && !Object.hasOwn(DEPLOY_ERRORS, e.code)) return "플랫폼이 거절했습니다(" + e.code + "): " + e.message;
  }
  return deployErrorText(e);
}

/** A short Korean message for a failed deploy call. */
export function deployErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    // These two need the server's detail: what in the request is wrong, which name is taken.
    if (e.code === "invalid_request") return "요청이 올바르지 않습니다: " + e.message;
    if (e.code === "app_exists") return "같은 이름의 앱이 이미 있거나 플랫폼이 쓰는 이름입니다: " + e.message;
    if (Object.hasOwn(DEPLOY_ERRORS, e.code)) return DEPLOY_ERRORS[e.code];
  }
  return errorText(e);
}

/** Whether the platform keeps a gateway for this app (GET /v1/traffic?app=): an app of the apps file, or a registered one with a database pair. Any other app answers 400. */
export function hasGateway(a: App): boolean {
  return a.environments.length > 0 || !!a.deploy?.dbTopology;
}

/**
 * A registered app's instances, the default one first. A server from before
 * ADR 0015 sends no `instances`; the app then has only its default instance,
 * which the top-level deploy fields describe.
 */
export function instancesOf(a: App | undefined): AppInstance[] {
  const d = a?.deploy;
  if (!d) return [];
  if (d.instances?.length) return d.instances;
  const { branch, autoDeploy, spec, specCommit, url, createdAt, createdBy, lastDeployment, status } = d;
  return [{ name: a.name, branch, default: true, autoDeploy, spec, specCommit, url, createdAt, createdBy, lastDeployment, status }];
}

/**
 * For a no-build redeploy of `inst`: whether its newest deployment is
 * unfinished (the server answers 409 deployment_in_progress), and the commit
 * of its last healthy deployment, which a redeploy uses again, when the
 * loaded deployments or the instance show one.
 */
export function redeployState(app: string, inst: AppInstance, deployments: Deployment[] | undefined): { running: boolean; commit?: string } {
  // A server from before ADR 0015 names no instance: such a deployment is the default instance's.
  const mine = (deployments ?? []).filter((d) => (d.instance || app) === inst.name);
  const last = inst.lastDeployment;
  const running = (!!mine[0] && !isFinalDeploymentStatus(mine[0].status)) || (!!last && !isFinalDeploymentStatus(last.status));
  const healthy = mine.find((d) => d.status === "healthy") ?? (last?.status === "healthy" ? last : undefined);
  return { running, commit: healthy?.commit };
}

function registeredRepos(apps: App[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of apps ?? []) if (a.deploy) out[a.deploy.repo] = a.name;
  return out;
}

/** Re-renders every `everyMs` while `active`; returns epoch ms. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}

function useQuery(): [{ repo: string; branch: string }, (repo: string, branch: string) => void] {
  const [q, setQ] = useState({ repo: "", branch: "" });
  const set = useCallback((repo: string, branch: string) => setQ((p) => (p.repo === repo && p.branch === branch ? p : { repo, branch })), []);
  return [q, set];
}

async function submitting(call: () => Promise<{ id: string }>, text: (e: unknown) => string = deployErrorText): Promise<SubmitResult> {
  try {
    return { deploymentId: (await call()).id };
  } catch (e) {
    const validation = specInvalid(e);
    return validation ? { validation } : { error: text(e) };
  }
}

/* ---------- simulation ---------- */

const simNow = (S: SimState) => Date.parse(iso(S.deploy.now));
const SIM_ENVS: EnvOption[] = ENV_ORDER.map((k) => ({ value: ENV[k].id, label: ENV[k].name }));

/** The simulation's apps as GET /v1/apps lists them: the migration app first, then the registered ones. */
export function simApps(S: SimState): App[] {
  const files = S.appOrder.map((id): App => {
    const loc = S.apps[id].loc;
    const e = ENV[loc];
    return {
      name: id,
      namespace: id,
      database: { name: "app", user: "app", schemas: [] },
      resources: { postgres: true, s3: true },
      environments: [{ env: e.id, cnpgCluster: SAMPLE.db + "-" + e.id, dbHost: SAMPLE.db + "-" + e.id + "-rw." + id + ":5432", bucket: sampleBucket(loc) }],
    };
  });
  // a migration of the simulation moves only the sample file app
  return [...files, ...S.deploy.apps.map((a) => dep.withReadiness(S.deploy, a))];
}

export function useSimNewApp(): NewAppModel {
  const { S, dispatch } = useSim();
  const [q, setQuery] = useQuery();
  return {
    live: false,
    repos: dep.REPOS.map((r) => r.repo),
    reposError: "",
    registered: registeredRepos(S.deploy.apps),
    envs: SIM_ENVS,
    envsError: "",
    check: { data: q.repo ? dep.validate(q.repo, q.branch) : undefined, error: undefined, loading: false, reload: () => {} },
    setQuery,
    submit: async (req) => {
      const refused = dep.checkCreate(S.deploy, req);
      if (refused) return refused;
      dispatch({ type: "app-create", req });
      return { deploymentId: S.deploy.deployments[0].id };
    },
  };
}

export function useSimApps(): AppsModel {
  const { S } = useSim();
  return { live: false, apps: simApps(S), error: "", now: simNow(S), busy: migActive(S) ? { [SAMPLE.id]: migLabel(S) } : {} };
}

export function useSimApp(name: string): AppModel {
  const { S, dispatch } = useSim();
  const app = simApps(S).find((a) => a.name === name);
  // the simulated migration moves the sample app (S.mig), whose name a registered app may have
  const migrating = migActive(S) && name === SAMPLE.id;
  return {
    live: false,
    app,
    instances: instancesOf(app),
    error: "",
    notFound: !app,
    deployments: S.deploy.deployments.filter((d) => d.app === name),
    now: simNow(S),
    redeploy: async (branch) => {
      if (!app) return { error: "앱을 찾을 수 없습니다" };
      if (!app.deploy) return { error: DEPLOY_ERRORS.app_not_registered };
      dispatch({ type: "app-redeploy", name, branch });
      return { deploymentId: S.deploy.deployments[0].id };
    },
    redeployNoBuild: async (branch) => {
      const refused = dep.checkRedeploy(S.deploy, name, branch);
      if (refused) return { error: deployErrorText(new ApiError(refused.status, refused.code, refused.message)) };
      dispatch({ type: "app-redeploy-nobuild", name, branch });
      return { deploymentId: S.deploy.deployments[0].id };
    },
    addBranch: async (branch, autoDeploy) => {
      const refused = dep.checkAddInstance(S.deploy, name, branch);
      if (refused && "code" in refused) return { error: deployErrorText(new ApiError(refused.status, refused.code, refused.message)) };
      if (refused) return refused;
      dispatch({ type: "instance-create", name, branch, autoDeploy });
      return { deploymentId: S.deploy.deployments[0].id };
    },
    removeInstance: async (instance) => {
      const inst = instancesOf(app).find((i) => i.name === instance);
      if (!inst) return deployErrorText(new ApiError(404, "instance_not_found", "instance not found"));
      if (inst.default) return deployErrorText(new ApiError(409, "default_instance", "the default instance goes only with the app"));
      dispatch({ type: "instance-delete", name, instance });
      return "";
    },
    remove: async () => {
      if (app && !app.deploy) return DEPLOY_ERRORS.app_not_registered;
      dispatch({ type: "app-delete", name });
      return "";
    },
    envOptions: SIM_ENVS,
    envOptionsError: "",
    addEnvironment: async (env) => {
      const refused = dep.checkAddEnvironment(S.deploy, name, env, migrating);
      if (refused) return { error: envErrorText(new ApiError(refused.status, refused.code, refused.message), false) };
      dispatch({ type: "env-add", name, env });
      return { deploymentId: S.deploy.deployments[0].id };
    },
    removeEnvironment: async (env) => {
      const refused = dep.checkRemoveEnvironment(S.deploy, name, env, migrating);
      if (refused) return envErrorText(new ApiError(refused.status, refused.code, refused.message), true);
      dispatch({ type: "env-remove", name, env });
      return "";
    },
  };
}

export function useSimDeployment(id: string): DeploymentModel {
  const { S } = useSim();
  const d = S.deploy.deployments.find((x) => x.id === id);
  return {
    live: false,
    deployment: d,
    events: S.deploy.events[id] ?? [],
    app: d && S.deploy.apps.find((a) => a.name === d.app),
    error: "",
    notFound: !d,
    connected: true,
    now: simNow(S),
  };
}

/* ---------- platform API ---------- */

export function useLiveNewApp(): NewAppModel {
  const repos = useGitHubRepos();
  const envs = useEnvironments();
  const apps = useApps();
  const [q, setQuery] = useQuery();
  const check = useAppSpecValidation(q.repo, q.branch);
  return {
    live: true,
    repos: repos.data,
    reposError: repos.error ? deployErrorText(repos.error) : "",
    registered: registeredRepos(apps.data),
    envs: envs.data?.map((e) => ({ value: e.name, label: e.displayName })),
    envsError: envs.error ? errorText(envs.error) : "",
    check,
    setQuery,
    submit: (req) => submitting(async () => (await createApp(req)).deployment),
  };
}

export function useLiveApps(): AppsModel {
  const apps = useApps(5000);
  return { live: true, apps: apps.data, error: apps.error && !apps.data ? errorText(apps.error) : "", now: Date.now(), busy: {} };
}

export function useLiveApp(name: string): AppModel {
  // An app with a database pair is read every 10 seconds: each read looks at both environments' clusters (ADR 0037).
  const [paired, setPaired] = useState(false);
  const read = useApp(name, paired ? 10000 : 5000);
  if (read.data && !!read.data.deploy?.dbTopology !== paired) setPaired(!paired);
  // The app an environment change answered with, shown until the next read replaces the one before the change.
  const [answered, setAnswered] = useState<{ app: App; over: App | undefined }>();
  const latest = useRef(read.data);
  latest.current = read.data;
  const app = { ...read, data: answered && answered.over === read.data ? answered.app : read.data };
  const deployments = useDeployments(name, 5000);
  const active = deployments.data?.some((d) => !isFinalDeploymentStatus(d.status)) ?? false;
  const now = useNow(active, 5000);
  // Which of the pair takes the writes now; only an app with a database pair has two backends to tell apart.
  const traffic = useTraffic(10000, undefined, name, !!app.data?.deploy?.dbTopology);
  // only a registered app can be added an environment
  const envs = useEnvironments(0, !!app.data?.deploy);
  return {
    live: true,
    app: app.data,
    instances: instancesOf(app.data),
    error: app.error && !app.data ? errorText(app.error) : "",
    notFound: app.error?.status === 404,
    deployments: deployments.data,
    now,
    writeBackend: traffic.error ? undefined : traffic.data?.writeBackend,
    redeploy: (branch) =>
      submitting(async () => {
        const d = await createDeployment(name, branch ? { branch } : undefined);
        deployments.reload();
        return d;
      }),
    redeployNoBuild: (branch) =>
      submitting(async () => {
        const d = await createDeployment(name, { branch, redeploy: true });
        deployments.reload();
        return d;
      }),
    addBranch: (branch, autoDeploy) => submitting(async () => (await createAppInstance(name, { branch, autoDeploy })).deployment),
    removeInstance: async (instance) => {
      try {
        await deleteAppInstance(name, instance);
        app.reload();
        deployments.reload();
        return "";
      } catch (e) {
        return deployErrorText(e);
      }
    },
    remove: async () => {
      try {
        await deleteApp(name);
        return "";
      } catch (e) {
        return deployErrorText(e);
      }
    },
    envOptions: envs.data?.map((e) => ({ value: e.name, label: e.displayName })),
    envOptionsError: envs.error && !envs.data ? errorText(envs.error) : "",
    addEnvironment: (env) =>
      submitting(async () => {
        const r = await addAppEnvironment(name, { environment: env });
        setAnswered({ app: r.app, over: latest.current });
        app.reload();
        deployments.reload();
        return r.deployment;
      }, (e) => envErrorText(e, false)),
    removeEnvironment: async (env) => {
      try {
        const r = await removeAppEnvironment(name, env);
        setAnswered({ app: r.app, over: latest.current });
        app.reload();
        deployments.reload();
        return "";
      } catch (e) {
        return envErrorText(e, true);
      }
    },
  };
}

export function useLiveDeployment(id: string): DeploymentModel {
  const w = useDeployment(id);
  const app = useApp(w.deployment?.app);
  const now = useNow(!!w.deployment && !isFinalDeploymentStatus(w.deployment.status));
  return {
    live: true,
    deployment: w.deployment,
    events: w.events,
    app: app.data,
    error: w.error ? errorText(w.error) : "",
    notFound: w.error?.status === 404,
    connected: w.connected,
    now,
  };
}
