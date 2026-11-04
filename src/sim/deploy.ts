// Apps registered from GitHub and their deployments, in the platform's contract
// shapes (App with deploy, Deployment, DeploymentEvent, AppSpecValidation,
// GitHubRepo). Every app deploys its own branch as the default instance and up
// to two added branches as instances `<app>--<slug>` (ADR 0015). Time advances
// 1 simulated second per tick while a deployment is unfinished, like the old
// deploy demo, so a three-environment deploy takes 2 min 41 s of simulated time.
import type {
  App,
  AppCreateRequest,
  AppInstance,
  AppSpec,
  AppSpecFieldError,
  AppSpecValidation,
  Deployment,
  DeploymentEnvironmentStatus,
  DeploymentEvent,
  DeploymentEventType,
  DeploymentStatus,
  DeploymentTrigger,
  GitHubRepo,
} from "../api/types";
import { DEP_READY, ENV, ENV_ORDER, envKeyOf } from "./data";
import { dur } from "./format";
import { iso } from "./mig";
import { freshSecrets, type SecretsSim } from "./secrets";

export const APP_DOMAIN = "hopcharlie.dev";
/** Names the platform serves itself under the app domain (409 app_exists, ADR 0012). */
export const RESERVED = ["api", "console", "app"];
/** Instances per app, the default one included (appspec.MaxInstances). */
export const MAX_INSTANCES = 3;
/** The Helm release name limit, which instance names keep to (appspec.MaxInstanceName). */
export const MAX_INSTANCE_NAME = 53;
const REGISTRY = "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com";
const ORG = "team-charlie";

/* ---------- repositories ---------- */

interface BranchHead {
  commit: string;
  spec?: AppSpec;
  errors: AppSpecFieldError[];
  /** the build of this commit fails with this error line */
  buildError?: string;
}

interface RepoFixture {
  repo: GitHubRepo;
  /** base image and build commands, for the build log */
  base: string;
  install: string;
  build: string;
  branches: Record<string, BranchHead>;
}

const gh = (name: string, priv = false): GitHubRepo => ({
  fullName: ORG + "/" + name,
  private: priv,
  defaultBranch: "main",
  htmlUrl: "https://github.com/" + ORG + "/" + name,
});

const svc = (name: string, port: number, p: Partial<AppSpec["services"][number]> = {}): AppSpec["services"][number] => ({
  name,
  path: ".",
  dockerfile: "Dockerfile",
  port,
  public: false,
  replicas: 1,
  ...p,
});

const photoSpec = (port: number): AppSpec => ({
  name: "photo-album",
  services: [svc("web", 8080, { healthCheck: "/healthz", public: true }), svc("worker", port, { path: "worker", env: { QUEUE: "thumbnails" } })],
  resources: [
    { name: "db", type: "postgres" },
    { name: "photos", type: "s3" },
  ],
});

// MOCK: 데모용 레포. 실제 화면은 GET /v1/github/repos가 GitHub App 설치에서 보이는 레포를 준다.
export const REPOS: RepoFixture[] = [
  {
    repo: gh("todo-api"),
    base: "golang:1.25-alpine",
    install: "go mod download",
    build: "go build -o /out/api ./cmd/api",
    branches: {
      main: {
        commit: "a41c9e2d8b7f60c3e15a9d4b2f8c7e6a1d0b3f95",
        spec: { name: "todo-api", services: [svc("api", 8080, { healthCheck: "/healthz", public: true, replicas: 2 })], resources: [{ name: "db", type: "postgres" }] },
        errors: [],
      },
    },
  },
  {
    repo: gh("notice-board"),
    base: "node:22-alpine",
    install: "npm ci",
    build: "npm run build",
    branches: {
      main: {
        commit: "3f9c1a0b2d4e6f8a1c3e5b7d9f0a2c4e6b8d0f13",
        spec: { name: "notice-board", services: [svc("web", 3000, { healthCheck: "/healthz", public: true })], resources: [{ name: "main-db", type: "postgres" }] },
        errors: [],
      },
      // platform.yaml passes, but the build breaks: shows a failed deployment, or a failed instance next to a healthy main
      dev: {
        commit: "8c21e7f4a9b3d5c6e0f1a2b3c4d5e6f7a8b9c0d1",
        spec: { name: "notice-board", services: [svc("web", 3000, { healthCheck: "/healthz", public: true })], resources: [{ name: "main-db", type: "postgres" }] },
        errors: [],
        buildError: 'ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
      },
      // builds fine: a healthy added instance, named notice-board--feature-search
      "feature/search": {
        commit: "c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5",
        spec: { name: "notice-board", services: [svc("web", 3000, { healthCheck: "/healthz", public: true })], resources: [{ name: "main-db", type: "postgres" }] },
        errors: [],
      },
    },
  },
  {
    repo: gh("photo-album", true),
    base: "python:3.13-slim",
    install: "pip install -r requirements.txt",
    build: "python -m compileall app",
    branches: {
      main: {
        commit: "5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e",
        spec: photoSpec(70000),
        errors: [
          { path: "services[1].port", message: "must be between 1 and 65535" },
          { path: "services[1].env.WORKERS", message: "must be a string: quote the value 4" },
        ],
      },
      "fix-worker": {
        commit: "e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2",
        spec: photoSpec(9000),
        errors: [],
      },
    },
  },
  {
    repo: gh("analytics-worker"),
    base: "",
    install: "",
    build: "",
    branches: {
      main: { commit: "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c", errors: [{ path: "", message: "platform.yaml not found at the repository root" }] },
    },
  },
];

const fixture = (repo: string) => REPOS.find((r) => r.repo.fullName === repo);

/** Like POST /v1/apps/validate with repo and branch. */
export function validate(repo: string, branch: string): AppSpecValidation {
  const f = fixture(repo);
  if (!f) return { valid: false, errors: [{ path: "", message: `repository ${repo} is not visible to the GitHub App` }] };
  const b = branch || f.repo.defaultBranch;
  // own keys only: a branch named "constructor" or "toString" is not found, like any other
  const head = Object.hasOwn(f.branches, b) ? f.branches[b] : undefined;
  if (!head) return { valid: false, errors: [{ path: "", message: `branch ${branch} not found` }] };
  return { valid: head.errors.length === 0, ...(head.spec ? { spec: head.spec } : {}), commit: head.commit, errors: head.errors };
}

/** The server's validBranch (internal/api/handlers_apps.go): a git branch name of letters, digits and . _ / -. */
export function validBranch(b: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,200}$/.test(b) &&
    !b.startsWith("-") &&
    !b.startsWith("/") &&
    !b.startsWith(".") &&
    !b.endsWith("/") &&
    !b.endsWith(".") &&
    !b.endsWith(".lock") &&
    !b.includes("..") &&
    !b.includes("//") &&
    !b.includes("/.")
  );
}

/** appspec.BranchSlug: ASCII letters lowercased, every run of other characters one "-", no "-" at either end. */
export function branchSlug(branch: string): string {
  return branch
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The instance name of a branch added to `app`, like appspec.InstanceName:
 * `<app>--<slug>`, or past MAX_INSTANCE_NAME as much of the slug as fits
 * (without a trailing "-"), "-" and 6 hex digits of a hash of the branch. The
 * server hashes with SHA-256; the simulation uses its deterministic FNV `hex`,
 * so a cut name ends in other digits than the server's. Null when the slug is
 * empty (400 on the server).
 */
export function instanceName(app: string, branch: string): string | null {
  const slug = branchSlug(branch);
  if (!slug) return null;
  const name = app + "--" + slug;
  if (name.length <= MAX_INSTANCE_NAME) return name;
  const keep = MAX_INSTANCE_NAME - app.length - "--".length - 1 - 6;
  return app + "--" + slug.slice(0, keep).replace(/-+$/, "") + "-" + hex(branch, 6);
}

/* ---------- state ---------- */

interface Step {
  at: number;
  type: DeploymentEventType;
  phase?: DeploymentStatus;
  env?: string;
  envStatus?: DeploymentEnvironmentStatus;
  message: string;
}

interface Active {
  start: number;
  steps: Step[];
  i: number;
}

export interface DeploySim {
  /** simulated seconds; moves only while a deployment is unfinished */
  now: number;
  /** registered apps by name, with `deploy` */
  apps: App[];
  /** every deployment, newest first */
  deployments: Deployment[];
  events: Record<string, DeploymentEvent[]>;
  active: Record<string, Active>;
  seq: number;
  nextId: number;
  /** the registered apps' secrets (sim/secrets.ts) */
  secrets: SecretsSim;
}

/** Deterministic hex for ids, digests and commits. */
function hex(seed: string, n: number): string {
  let out = "";
  let h = 0x811c9dc5;
  while (out.length < n) {
    for (const c of seed + out.length) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, n);
}

const envOrder = (envs: string[]) => ENV_ORDER.map((k) => ENV[k].id).filter((e) => envs.includes(e));
const ready = (env: string) => DEP_READY[envKeyOf(env) ?? "aws"];

export function isFinal(s: DeploymentStatus): boolean {
  return s === "healthy" || s === "failed" || s === "superseded";
}

function steps(f: RepoFixture | undefined, instance: string, spec: AppSpec, commit: string, envs: string[], trigger: DeploymentTrigger): Step[] {
  const c7 = commit.slice(0, 7);
  const s: Step[] = [{ at: 0, type: "phase", phase: "queued", message: "대기열에 들어갔습니다 (trigger " + trigger + ")" }];
  // A redeploy builds nothing: the last healthy deployment's images go out again with the current secrets.
  const again = trigger === "redeploy";
  if (!again) s.push({ at: 2, type: "phase", phase: "building", message: "이미지 빌드 시작 (CodeBuild, 서비스 " + spec.services.length + "개)" });
  const broken = again ? undefined : Object.values(f?.branches ?? {}).find((b) => b.commit === commit)?.buildError;
  if (broken) {
    const v = spec.services[0];
    const p = (at: number, message: string) => s.push({ at, type: "log", phase: "building", message: "[" + v.name + "] " + message });
    p(3, "#1 [internal] load build definition from " + v.dockerfile);
    p(4, "#2 [internal] load metadata for docker.io/library/" + (f?.base || "alpine:3.22"));
    p(7, "#5 [build 2/3] RUN " + (f?.install || "make deps"));
    p(31, "#5 DONE 24.1s");
    p(33, "#6 [build 3/3] RUN " + (f?.build || "make"));
    p(36, "#6 src/pages/Board.tsx(14,7): error TS2304: Cannot find name 'useBoard'.");
    p(37, "#6 " + broken);
    s.push({ at: 38, type: "done", phase: "failed", message: v.name + ": " + broken });
    return s;
  }
  if (!again) spec.services.forEach((v, i) => {
    const o = 2 + i; // services build side by side
    const p = (at: number, message: string) => s.push({ at: o + at, type: "log", phase: "building", message: "[" + v.name + "] " + message });
    p(1, "#1 [internal] load build definition from " + (v.path === "." ? "" : v.path + "/") + v.dockerfile);
    p(2, "#2 [internal] load metadata for docker.io/library/" + (f?.base || "alpine:3.22"));
    p(4, "#4 [build 1/3] COPY . .");
    p(5, "#5 [build 2/3] RUN " + (f?.install || "make deps"));
    p(29, "#5 DONE 24.1s");
    p(31, "#6 [build 3/3] RUN " + (f?.build || "make"));
    p(44, "#7 [runtime 1/1] COPY --from=build /out /app");
    p(46, "#8 exporting to image");
    p(47, "#9 pushing " + REGISTRY + "/hopcharlie/apps/" + spec.name + "/" + v.name + ":" + c7);
    p(49, "#9 digest: sha256:" + hex(commit + v.name, 64));
  });
  const o = again ? -50 : 0;
  s.push({ at: 52 + o, type: "phase", phase: "committing", message: (again ? "빌드 없이 마지막 정상 배포의 이미지로 " : "") + "gitops에 apps/" + instance + "/<env>.yaml 커밋" });
  for (const e of envs) s.push({ at: 52 + o, type: "log", phase: "committing", message: "apps/" + instance + "/" + e + ".yaml: " + c7 + (again ? ", 시크릿 다시 봉인, appChecksum 갱신" : ", 이미지 digest 고정") });
  s.push({ at: 54 + o, type: "log", phase: "committing", message: "commit " + hex(commit + (again ? "gitops-redeploy" : "gitops"), 7) + " (2026-Softbank-Hackathon-Charlie/gitops)" });
  s.push({ at: 55 + o, type: "phase", phase: "syncing", message: "Argo CD에 refresh 요청, 환경 " + envs.length + "곳에 동시에 적용" });
  for (const e of envs) s.push({ at: 56 + o, type: "environment", env: e, envStatus: "syncing", message: "OutOfSync, Progressing" });
  for (const e of envs) s.push({ at: ready(e) + o, type: "environment", env: e, envStatus: "healthy", message: "Synced, Healthy" });
  const end = Math.max(...envs.map(ready)) + o + 1;
  s.push({ at: end, type: "done", phase: "healthy", message: "모든 환경이 Synced, Healthy" });
  return s.sort((a, b) => a.at - b.at);
}

function emit(d: DeploySim, dep: Deployment, st: Step, sec: number): void {
  const ev: DeploymentEvent = { seq: ++d.seq, deploymentId: dep.id, time: iso(sec), type: st.type, message: st.message };
  if (st.phase) ev.phase = st.phase;
  if (st.env) ev.env = st.env;
  (d.events[dep.id] ??= []).push(ev);
}

const instanceOf = (app: App | undefined, name: string) => app?.deploy?.instances.find((i) => i.name === name);

/** Applies one step to the deployment and its instance, the way the deployer would. */
function step(d: DeploySim, dep: Deployment, st: Step, sec: number): void {
  const inst = instanceOf(d.apps.find((a) => a.name === dep.app), dep.instance);
  const t = iso(sec);
  if (st.type === "phase" && st.phase) {
    dep.status = st.phase;
    if (st.phase === "building") {
      dep.startedAt = t;
      dep.buildId = "hopcharlie-apps:" + hex(dep.id + "build", 8) + "-" + hex(dep.id + "b2", 4);
    }
    if (st.phase === "committing") {
      dep.images = (inst?.spec.services ?? []).map((v) => ({
        service: v.name,
        image: REGISTRY + "/hopcharlie/apps/" + dep.app + "/" + v.name + "@sha256:" + hex(dep.commit + v.name, 64),
      }));
    }
  }
  if (st.type === "environment" && st.env && st.envStatus) {
    const healthy = st.envStatus === "healthy";
    const pods = (inst?.spec.services ?? []).reduce((n, v) => n + v.replicas, 0);
    const e = dep.environments.find((x) => x.env === st.env);
    const message = healthy ? "Pod " + pods + "/" + pods + " 준비" : "새 커밋 적용 중";
    if (e) Object.assign(e, { status: st.envStatus, syncStatus: healthy ? "Synced" : "OutOfSync", healthStatus: healthy ? "Healthy" : "Progressing", message });
    // The default instance's status is also the app's deploy.status (the same array).
    const a = inst?.status.find((x) => x.env === st.env);
    if (a) Object.assign(a, { status: st.envStatus, syncStatus: healthy ? "Synced" : "OutOfSync", healthStatus: healthy ? "Healthy" : "Progressing", updatedAt: t, ...(healthy ? { commit: dep.commit } : {}) });
  }
  if (st.type === "done" && st.phase) {
    dep.status = st.phase;
    dep.finishedAt = t;
    if (st.phase === "failed") dep.error = st.message;
  }
  emit(d, dep, st, sec);
}

function newDeployment(d: DeploySim, app: App, inst: AppInstance, trigger: DeploymentTrigger, triggeredBy: string, ref: string, commit: string, at: number): Deployment {
  const envs = app.deploy!.environments;
  const dep: Deployment = {
    id: "dep_" + hex(app.name + d.nextId++, 12),
    app: app.name,
    branch: inst.branch,
    instance: inst.name,
    ref,
    commit,
    trigger,
    triggeredBy,
    status: "queued",
    images: [],
    environments: envs.map((env) => ({ env, status: "pending" })),
    createdAt: iso(at),
  };
  // A new deployment of the same instance to the same environments (or more) supersedes an unfinished one.
  for (const old of d.deployments) {
    if (old.instance !== inst.name || isFinal(old.status) || !old.environments.every((e) => envs.includes(e.env))) continue;
    old.status = "superseded";
    old.finishedAt = iso(at);
    emit(d, old, { at: 0, type: "done", phase: "superseded", message: "새 배포 " + dep.id + "가 생겨서 멈췄습니다" }, at);
    delete d.active[old.id];
  }
  d.deployments.unshift(dep);
  d.events[dep.id] = [];
  inst.lastDeployment = dep;
  if (inst.default) app.deploy!.lastDeployment = dep;
  const f = fixture(app.deploy!.repo);
  d.active[dep.id] = { start: at, steps: steps(f, inst.name, inst.spec, commit, envs, trigger), i: 0 };
  advance(d, dep.id, at);
  return dep;
}

/** Emits every step of a deployment due by `sec`. Returns true when it just finished. */
function advance(d: DeploySim, id: string, sec: number): boolean {
  const a = d.active[id];
  const dep = d.deployments.find((x) => x.id === id);
  if (!a || !dep) return false;
  while (a.i < a.steps.length && a.start + a.steps[a.i].at <= sec + 1e-9) {
    const st = a.steps[a.i++];
    step(d, dep, st, a.start + st.at);
  }
  if (a.i < a.steps.length) return false;
  delete d.active[id];
  return true;
}

function newInstance(name: string, branch: string, isDefault: boolean, autoDeploy: boolean, v: AppSpecValidation, envs: string[], at: number, by: string): AppInstance {
  return {
    name,
    branch,
    default: isDefault,
    autoDeploy,
    spec: v.spec!,
    specCommit: v.commit!,
    ...(v.spec!.services.some((s) => s.public) ? { url: "https://" + name + "." + APP_DOMAIN } : {}),
    createdAt: iso(at),
    createdBy: by,
    status: envs.map((env) => ({ env, status: "pending" })),
  };
}

function register(d: DeploySim, repo: string, branch: string, environments: string[], autoDeploy: boolean, at: number, by = "operator"): App {
  const v = validate(repo, branch);
  const spec = v.spec!;
  const envs = envOrder(environments);
  const inst = newInstance(spec.name, branch, true, autoDeploy, v, envs, at, by);
  const app: App = {
    name: spec.name,
    namespace: spec.name,
    database: { name: "app", user: "app", schemas: [] },
    environments: [],
    // The top-level fields describe the default instance; `status` is its array, so the deployer updates both.
    deploy: {
      repo,
      branch,
      environments: envs,
      autoDeploy,
      spec,
      specCommit: inst.specCommit,
      ...(inst.url ? { url: inst.url } : {}),
      createdAt: inst.createdAt,
      createdBy: by,
      status: inst.status,
      instances: [inst],
    },
  };
  d.apps.push(app);
  d.apps.sort((x, y) => x.name.localeCompare(y.name));
  return app;
}

export function freshDeploy(): DeploySim {
  const d: DeploySim = { now: 0, apps: [], deployments: [], events: {}, active: {}, seq: 0, nextId: 1, secrets: freshSecrets() };
  // todo-api: registered yesterday, deployed again by a push 12 minutes ago.
  const envs = ENV_ORDER.map((k) => ENV[k].id);
  const app = register(d, ORG + "/todo-api", "main", envs, true, -86_700);
  const main = app.deploy!.instances[0];
  const first = newDeployment(d, app, main, "register", "operator", "main", "7be03d1f2a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b", -86_400);
  advance(d, first.id, 0);
  const push = newDeployment(d, app, main, "push", "github:charlie-dev", "main", app.deploy!.specCommit, -720);
  advance(d, push.id, 0);
  return d;
}

/* ---------- operations (POST /v1/apps, POST /v1/apps/{name}/deployments, DELETE /v1/apps/{name}, POST and DELETE /v1/apps/{name}/instances) ---------- */

export type CreateCheck = { validation: AppSpecValidation } | { error: string } | null;

/** A refusal as the server answers it: the HTTP status, the error code and the server's message. */
export interface Refusal {
  status: number;
  code: string;
  message: string;
}

/** What POST /v1/apps would refuse, or null when it would register. */
export function checkCreate(d: DeploySim, req: AppCreateRequest): CreateCheck {
  if (!req.environments.length) return { error: "배포할 환경을 하나 이상 고르세요" };
  const v = validate(req.repo, req.branch ?? "main");
  if (!v.valid || !v.spec) return { validation: v };
  if (RESERVED.includes(v.spec.name)) return { error: "이름 " + v.spec.name + "은(는) 플랫폼이 쓰는 이름이라 등록할 수 없습니다" };
  if (d.apps.some((a) => a.name === v.spec!.name)) return { error: "이름 " + v.spec.name + "은(는) 이미 등록된 앱입니다" };
  return null;
}

/** Registers the repository and queues its first deployment. Returns the deployment id. */
export function createApp(d: DeploySim, req: AppCreateRequest): string | null {
  if (checkCreate(d, req)) return null;
  const branch = req.branch ?? "main";
  const app = register(d, req.repo, branch, req.environments, req.autoDeploy ?? true, d.now);
  return newDeployment(d, app, app.deploy!.instances[0], "register", "operator", branch, app.deploy!.specCommit, d.now).id;
}

/** A manual deployment of the head of `branch` (default: the app's own) into its instance, to all of the app's environments. */
export function redeploy(d: DeploySim, name: string, branch?: string): string | null {
  const app = d.apps.find((a) => a.name === name);
  if (!app?.deploy) return null;
  const inst = app.deploy.instances.find((i) => i.branch === (branch ?? app.deploy!.branch));
  if (!inst) return null;
  const v = validate(app.deploy.repo, inst.branch);
  if (!v.valid || !v.spec) return null;
  inst.spec = v.spec;
  inst.specCommit = v.commit!;
  if (inst.default) {
    app.deploy.spec = v.spec;
    app.deploy.specCommit = v.commit!;
  }
  return newDeployment(d, app, inst, "manual", "operator", inst.branch, v.commit!, d.now).id;
}

const lastHealthy = (d: DeploySim, instance: string) => d.deployments.find((x) => x.instance === instance && x.status === "healthy");

/** What POST /v1/apps/{name}/deployments with `redeploy` would refuse, or null when it would deploy. */
export function checkRedeploy(d: DeploySim, name: string, branch: string): Refusal | null {
  const app = d.apps.find((a) => a.name === name);
  if (!app?.deploy) return { status: 404, code: "app_not_found", message: "app not found" };
  const inst = app.deploy.instances.find((i) => i.branch === branch);
  if (!inst) return { status: 400, code: "invalid_request", message: `app ${name} does not deploy branch ${branch}` };
  if (d.deployments.some((x) => x.instance === inst.name && !isFinal(x.status)))
    return { status: 409, code: "deployment_in_progress", message: `instance ${inst.name} has a deployment in progress` };
  if (!lastHealthy(d, inst.name)) return { status: 409, code: "nothing_to_redeploy", message: `instance ${inst.name} has no healthy deployment to deploy again` };
  return null;
}

/** The instance's last healthy deployment again (trigger redeploy): same commit and images, no build. */
export function redeployNoBuild(d: DeploySim, name: string, branch: string): void {
  if (checkRedeploy(d, name, branch)) return;
  const app = d.apps.find((a) => a.name === name)!;
  const inst = app.deploy!.instances.find((i) => i.branch === branch)!;
  const last = lastHealthy(d, inst.name)!;
  newDeployment(d, app, inst, "redeploy", "operator", last.ref, last.commit, d.now);
}

/**
 * What POST /v1/apps/{name}/instances would refuse, in the server's order
 * (createAppInstance, then the store): a bad branch name, the app's own
 * branch, an empty slug, the branch and its platform.yaml, then a branch
 * already added, a taken instance name and the instance limit. Null when it
 * would add the branch.
 */
export function checkAddInstance(d: DeploySim, name: string, branch: string): { validation: AppSpecValidation } | Refusal | null {
  const app = d.apps.find((a) => a.name === name);
  if (!app?.deploy) return { status: 404, code: "app_not_found", message: "app not found" };
  if (!validBranch(branch)) return { status: 400, code: "invalid_request", message: "branch must be a git branch name of letters, digits and . _ / -" };
  if (branch === app.deploy.branch) return { status: 409, code: "branch_exists", message: `branch ${branch} is app ${name}'s own branch, deployed as its default instance` };
  const inst = instanceName(name, branch);
  if (!inst) return { status: 400, code: "invalid_request", message: `branch "${branch}" has no letter or digit to name an instance after` };
  const v = validate(app.deploy.repo, branch);
  if (!v.valid || !v.spec) return { validation: v };
  if (v.spec.name !== name) {
    const error = { path: "name", message: `is "${v.spec.name}", but the app is registered as "${name}"; register the new name as a new app` };
    return { validation: { ...v, valid: false, errors: [error] } };
  }
  if (app.deploy.instances.some((i) => i.branch === branch)) return { status: 409, code: "branch_exists", message: `app ${name} already deploys branch ${branch}` };
  if (d.apps.some((a) => a.name === inst || a.deploy?.instances.some((i) => i.name === inst)))
    return { status: 409, code: "instance_exists", message: `the instance name ${inst} of branch ${branch} is already taken by another branch or app` };
  if (app.deploy.instances.length >= MAX_INSTANCES)
    return { status: 409, code: "instance_limit", message: `app ${name} already has ${MAX_INSTANCES} instances, the default one included; delete one first` };
  return null;
}

/** Adds `branch` as an instance and queues its first deployment. Returns the deployment id. */
export function addInstance(d: DeploySim, name: string, branch: string, autoDeploy: boolean, by = "operator"): string | null {
  if (checkAddInstance(d, name, branch)) return null;
  const app = d.apps.find((a) => a.name === name)!;
  const inst = newInstance(instanceName(name, branch)!, branch, false, autoDeploy, validate(app.deploy!.repo, branch), app.deploy!.environments, d.now, by);
  // the default instance first, then the others by branch name
  app.deploy!.instances = [...app.deploy!.instances, inst].sort((x, y) => Number(y.default) - Number(x.default) || (x.branch < y.branch ? -1 : 1));
  return newDeployment(d, app, inst, "register", by, branch, inst.specCommit, d.now).id;
}

/** Removes an added instance and forgets its deployments. The default instance goes only with the app. */
export function removeInstance(d: DeploySim, name: string, instance: string): boolean {
  const app = d.apps.find((a) => a.name === name);
  const inst = instanceOf(app, instance);
  if (!app?.deploy || !inst || inst.default) return false;
  app.deploy.instances = app.deploy.instances.filter((i) => i !== inst);
  delete d.secrets[name]?.[instance];
  for (const dep of d.deployments.filter((x) => x.instance === instance)) {
    delete d.events[dep.id];
    delete d.active[dep.id];
  }
  d.deployments = d.deployments.filter((x) => x.instance !== instance);
  return true;
}

/** Unregisters an app and forgets its deployments. */
export function deleteApp(d: DeploySim, name: string): boolean {
  if (!d.apps.some((a) => a.name === name)) return false;
  d.apps = d.apps.filter((a) => a.name !== name);
  delete d.secrets[name];
  for (const dep of d.deployments.filter((x) => x.app === name)) {
    delete d.events[dep.id];
    delete d.active[dep.id];
  }
  d.deployments = d.deployments.filter((x) => x.app !== name);
  return true;
}

export function activeDeployments(d: DeploySim): Deployment[] {
  return d.deployments.filter((x) => !isFinal(x.status));
}

/** One tick. Returns an activity line for every deployment that just finished. */
export function deployTick(d: DeploySim): string[] {
  if (Object.keys(d.active).length === 0) return [];
  d.now += 1;
  const out: string[] = [];
  for (const id of Object.keys(d.active)) {
    if (!advance(d, id, d.now)) continue;
    const dep = d.deployments.find((x) => x.id === id)!;
    const sec = (Date.parse(dep.finishedAt!) - Date.parse(dep.createdAt)) / 1000;
    out.push(dep.status === "failed" ? dep.instance + " 배포 실패 (이미지 빌드, " + dur(sec) + ")" : dep.instance + " 배포 완료 (" + dep.environments.length + "개 환경, " + dur(sec) + ")");
  }
  return out;
}
