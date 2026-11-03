// Views of the apps registered from GitHub and their deployments, from the simulation or the platform API.
// Both sides hand over contract types (App, Deployment, DeploymentEvent, AppSpecValidation, GitHubRepo),
// so every page has one code path. Pages mount a live hook only in live mode: it fetches as soon as it mounts.
import { useCallback, useEffect, useState } from "react";
import { ApiError, createApp, createDeployment, deleteApp, specInvalid } from "../api/client";
import { useApp, useApps, useAppSpecValidation, useDeployment, useDeployments, useEnvironments, useGitHubRepos, type SpecCheck } from "../api/hooks";
import { isFinalDeploymentStatus } from "../api/sse";
import type { App, AppCreateRequest, AppSpecValidation, Deployment, DeploymentEvent, GitHubRepo } from "../api/types";
import { ENV, ENV_ORDER, SAMPLE } from "../sim/data";
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
  error: string;
  notFound: boolean;
  /** newest first */
  deployments: Deployment[] | undefined;
  now: number;
  redeploy(): Promise<SubmitResult>;
  /** Resolves with an error message, or "" once the app is unregistered. */
  remove(): Promise<string>;
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

/** A short Korean message for a failed deploy call. */
export function deployErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "app_exists") return "같은 이름의 앱이 이미 있거나 플랫폼이 쓰는 이름입니다: " + e.message;
    if (e.code === "app_not_registered") return "PLATFORM_APPS_FILE에만 있는 앱이라 여기서 배포하거나 지울 수 없습니다";
    if (e.code === "github_not_configured") return "서버에 GitHub App이 설정되어 있지 않습니다";
    if (e.code === "github_unreachable") return "GitHub에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요";
  }
  return errorText(e);
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

async function submitting(call: () => Promise<{ id: string }>): Promise<SubmitResult> {
  try {
    return { deploymentId: (await call()).id };
  } catch (e) {
    const validation = specInvalid(e);
    return validation ? { validation } : { error: deployErrorText(e) };
  }
}

/* ---------- simulation ---------- */

const simNow = (S: SimState) => Date.parse(iso(S.deploy.now));
const SIM_ENVS: EnvOption[] = ENV_ORDER.map((k) => ({ value: ENV[k].id, label: ENV[k].name }));

/** The simulation's apps as GET /v1/apps lists them: the migration app first, then the registered ones. */
export function simApps(S: SimState): App[] {
  const files = S.appOrder.map((id): App => {
    const e = ENV[S.apps[id].loc];
    return {
      name: id,
      namespace: id,
      database: { name: "app", user: "app", schemas: [] },
      environments: [{ env: e.id, cnpgCluster: SAMPLE.db + "-" + e.id, dbHost: SAMPLE.db + "-" + e.id + "-rw." + id + ":5432", bucket: e.bucket }],
    };
  });
  return [...files, ...S.deploy.apps];
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
  const app = S.deploy.apps.find((a) => a.name === name);
  return {
    live: false,
    app,
    error: "",
    notFound: !app,
    deployments: S.deploy.deployments.filter((d) => d.app === name),
    now: simNow(S),
    redeploy: async () => {
      if (!app) return { error: "앱을 찾을 수 없습니다" };
      dispatch({ type: "app-redeploy", name });
      return { deploymentId: S.deploy.deployments[0].id };
    },
    remove: async () => {
      dispatch({ type: "app-delete", name });
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
  const app = useApp(name, 5000);
  const deployments = useDeployments(name, 5000);
  const active = deployments.data?.some((d) => !isFinalDeploymentStatus(d.status)) ?? false;
  const now = useNow(active, 5000);
  return {
    live: true,
    app: app.data,
    error: app.error && !app.data ? errorText(app.error) : "",
    notFound: app.error?.status === 404,
    deployments: deployments.data,
    now,
    redeploy: () =>
      submitting(async () => {
        const d = await createDeployment(name);
        deployments.reload();
        return d;
      }),
    remove: async () => {
      try {
        await deleteApp(name);
        return "";
      } catch (e) {
        return deployErrorText(e);
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
