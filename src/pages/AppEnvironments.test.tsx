import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { at, fakeDeployment, fakeRun, fakeSession, hang, installFetch, json, type FakeCall } from "../api/fakes";
import type { App as ApiApp, AppDBReadinessEnvironment, AppDBTopology, AppInstance, AppSpec } from "../api/types";
import { App } from "../App";
import { envErrorText } from "../data/deploy";
import { initAuth, startSession } from "../data/live";
import { pairCheck, runInProgress } from "../data/migration";
import { ApiError } from "../api/client";
import ja from "../i18n/ja.json";
import { translateDom } from "../i18n/dom";
import { makeTranslator } from "../i18n/translate";
import * as dep from "../sim/deploy";
import { createSim, SimProvider, type Sim } from "../sim/store";

function setup(hash: string, mode: "demo" | "live" = "demo") {
  window.location.hash = hash;
  localStorage.setItem("hopcharlie.mode", mode);
  initAuth();
  const sim = createSim();
  const user = userEvent.setup({ delay: null });
  render(
    <SimProvider sim={sim} intervalMs={0}>
      <App />
    </SimProvider>,
  );
  return { sim, user };
}

function ticks(sim: Sim, n: number) {
  act(() => {
    for (let i = 0; i < n; i++) sim.tick();
  });
}

afterEach(() => {
  localStorage.clear();
  initAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const spec: AppSpec = {
  name: "moimroom",
  services: [{ name: "web", path: ".", dockerfile: "Dockerfile", port: 8080, healthCheck: "/healthz", public: true, replicas: 1 }],
  resources: [{ name: "db", type: "postgres" }],
};
const commit = "9fceb02d0ae598e95dc970b74767f19372d61af8";

/** A registered app in `envs`, with `dbTopology` when given. */
function appIn(envs: string[], dbTopology?: AppDBTopology): ApiApp {
  const status = envs.map((env) => ({ env, status: "healthy" as const, syncStatus: "Synced", healthStatus: "Healthy", commit }));
  const main: AppInstance = { name: "moimroom", branch: "main", default: true, autoDeploy: true, spec, specCommit: commit, createdAt: at(0), createdBy: "operator", status };
  return {
    name: "moimroom",
    namespace: "moimroom",
    database: { name: "app", user: "app", schemas: [] }, resources: { postgres: true, s3: true },
    environments: envs.map((env) => ({ env, cnpgCluster: "moimroom-db-" + env, dbHost: "moimroom-db-" + env + "-rw.moimroom:5432" })),
    deploy: { repo: "org/moimroom", branch: "main", environments: envs, autoDeploy: true, spec, specCommit: commit, createdAt: at(0), createdBy: "operator", status, instances: [main], ...(dbTopology ? { dbTopology } : {}) },
  };
}

const env = (name: string, displayName: string) => ({ name, provider: "aws", displayName, kubeContext: name, gatewayBackend: name, live: true, status: { reachable: true, checkedAt: at(0) } });

/** A one-environment postgres app whose pair's replica (gke) is not added yet. */
const single = appIn(["eks"], {
  primary: "eks",
  replica: "gke",
  replicaPresent: false,
  readiness: {
    ready: false,
    reason: "replica_missing",
    message: "gke is not one of the app's environments",
    environments: [
      { env: "eks", inApp: true, deployed: true, gatewayBackend: true, role: "primary", healthy: true, phase: "Cluster in healthy state" },
      { env: "gke", inApp: false, deployed: false, gatewayBackend: false, role: "unknown", healthy: false },
    ],
  },
});

/** The app page's head with its actions; the side navigation has its own 이전 link. */
const head = () => document.querySelector(".appd-head") as HTMLElement;

/** The gateway's answer with the app's writes in `w`. */
function traffic(w: string, envs: string[]): Response {
  return json(200, {
    writeBackend: w,
    readWeights: Object.fromEntries(envs.map((e) => [e, e === w ? 100 : 0])),
    writesHeld: false,
    heldWrites: 0,
    maxHold: "30s",
    inFlight: { reads: 0, writes: 0 },
    backends: [],
    stats: {},
    totals: {},
    updatedAt: at(0),
  });
}

/** A pair in eks and gke whose readiness says `reason`. */
const pairWith = (reason: string, gke: Partial<AppDBReadinessEnvironment> = {}) =>
  appIn(["eks", "gke"], {
    primary: "eks",
    replica: "gke",
    replicaPresent: true,
    readiness: {
      ready: false,
      reason,
      message: "the server says " + reason,
      environments: [
        { env: "eks", inApp: true, deployed: true, gatewayBackend: true, role: "primary", healthy: true },
        { env: "gke", inApp: true, deployed: true, gatewayBackend: true, role: "replica", healthy: true, ...gke },
      ],
    },
  });

function live(app: ApiApp, extra: (c: FakeCall, u: URL) => Response | Promise<Response> | undefined = () => undefined): FakeCall[] {
  const calls = installFetch((c) => {
    const u = new URL(c.url, "http://x");
    const r = extra(c, u);
    if (r) return r;
    if (u.pathname === "/v1/envs") return json(200, { environments: [env("eks", "AWS EKS"), env("gke", "GCP GKE")] });
    if (u.pathname === "/v1/apps" && c.method === "GET") return json(200, { apps: [app] });
    if (u.pathname === "/v1/apps/moimroom" && c.method === "GET") return json(200, app);
    if (u.pathname === "/v1/apps/moimroom/deployments") return json(200, { deployments: [fakeDeployment({ status: "healthy", finishedAt: at(50) })] });
    if (u.pathname === "/v1/traffic") return traffic(app.deploy!.environments[0], app.deploy!.environments);
    if (u.pathname.endsWith("/events")) return hang(c);
    return json(404, { error: { code: "not_found", message: "no" } });
  });
  act(() => startSession(fakeSession()));
  return calls;
}

describe("adding and removing an app's environment (platform API)", () => {
  it("offers onprem after the original pair and shows all three DB members", async () => {
    const paired = appIn(["gke", "eks"], { primary: "gke", replica: "eks", replicaPresent: true });
    const { user } = setup("#app-moimroom", "live");
    live(paired, (_c,u) => u.pathname === "/v1/envs" ? json(200,{ environments:[env("gke","GCP GKE"),env("eks","AWS EKS"),env("onprem","온프레미스")] }) : undefined);
    await user.click(await screen.findByRole("button",{name:"환경 추가"}));
    const form = screen.getByRole("group",{name:"환경 추가"});
    await waitFor(() => expect(within(form).getByLabelText("더할 환경")).toHaveValue("onprem"));
    expect(form).toHaveTextContent("최대 세 환경");
  });

  it("marks the traffic receiver separately from the onprem primary and offers three-member removal by the pair's rules", async () => {
    const envs = ["gke","eks","onprem"];
    const three = appIn(envs,{ primary:"gke",replica:"eks",replicaPresent:true,readiness:{ready:true,reason:"ready",message:"ready",environments:envs.map((env) => ({env,inApp:true,deployed:true,gatewayBackend:true,healthy:true,role:env === "onprem" ? "primary" as const : "replica" as const}))} });
    setup("#app-moimroom","live");
    live(three,(_c,u) => u.pathname === "/v1/traffic" ? traffic("eks",envs) : undefined);
    const group = (await screen.findByRole("heading",{name:"DB 복제 그룹"})).closest("section") as HTMLElement;
    expect(within(group).getAllByRole("row")).toHaveLength(4);
    expect((await screen.findByText("DB primary")).closest(".appd-env")).toHaveTextContent("온프레미스");
    const star = await screen.findByTitle("트래픽 받는 중");
    expect(star.closest(".appd-envh")).toHaveTextContent("AWS EKS");
    expect(star.nextElementSibling).toHaveTextContent("정상");
    expect(star).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("트래픽 받는 중")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/AWS EKS 환경 빼기/})).toBeDisabled();
    expect(screen.getByText("지금 쓰기를 받는 환경이라 뺄 수 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/온프레미스 k3s 환경 빼기/})).toBeDisabled();
    expect(screen.getByText("지금 DB primary가 있는 환경이라 뺄 수 없습니다")).toBeInTheDocument();
    expect(screen.queryByText(/세 환경 DB 그룹의 환경 제거/)).toBeNull();
  });

  it("offers to take a replica member out of a three-environment DB group", async () => {
    const envs = ["gke","eks","onprem"];
    const three = appIn(envs,{ primary:"gke",replica:"eks",replicaPresent:true,readiness:{ready:true,reason:"ready",message:"ready",environments:envs.map((env) => ({env,inApp:true,deployed:true,gatewayBackend:true,healthy:true,role:env === "gke" ? "primary" as const : "replica" as const}))} });
    setup("#app-moimroom","live");
    live(three,(_c,u) => u.pathname === "/v1/traffic" ? traffic("gke",envs) : undefined);
    expect(await screen.findByRole("button",{name:/온프레미스 k3s 환경 빼기/})).toBeEnabled();
    expect(screen.getByRole("button",{name:/AWS EKS 환경 빼기/})).toBeEnabled();
  });

  it("shows the missing peer, warns beside the 이전 준비 link, and adds the pair's environment", async () => {
    const { user } = setup("#app-moimroom", "live");
    const calls = live(single, (c, u) =>
      u.pathname === "/v1/apps/moimroom/environments" && c.method === "POST"
        ? json(202, { app: single, deployment: fakeDeployment({ id: "dep_env", trigger: "environment" }) })
        : undefined,
    );
    const pair = (await screen.findByRole("heading", { name: "DB 짝" })).closest("section") as HTMLElement;
    expect(within(pair).getByText("이전 준비 안 됨")).toBeInTheDocument();
    expect(within(pair).getByText("상대 환경 없음")).toBeInTheDocument();
    expect(screen.getByText("DB 짝 GCP GKE 환경이 아직 앱에 없습니다")).toBeInTheDocument();
    // the link stays: the warning says why the migration would wait, and is what the link describes
    const link = within(head()).getByRole("link", { name: "이전 준비" });
    expect(link).toHaveAttribute("href", "#migrate-app?app=moimroom");
    expect(document.getElementById(link.getAttribute("aria-describedby")!)).toHaveTextContent(/상대 환경이 아직 앱에 없습니다/);
    // on every tab, not only the overview
    await act(async () => {
      window.location.hash = "#app-moimroom/deploys";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(document.getElementById(within(head()).getByRole("link", { name: "이전 준비" }).getAttribute("aria-describedby")!)).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#app-moimroom";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    // the first environment cannot be taken out
    expect(screen.queryByRole("button", { name: /환경 빼기$/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    await waitFor(() => expect(within(form).getByLabelText("더할 환경")).toHaveValue("gke"));
    expect(within(form).getAllByRole("option").map((o) => o.textContent)).toEqual(["GCP GKE"]);
    expect(form).toHaveTextContent("GCP GKE만 더할 수 있습니다");
    await user.click(within(form).getByRole("button", { name: "환경 추가" }));
    await waitFor(() => expect(window.location.hash).toBe("#deploy-dep_env"));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/v1/apps/moimroom/environments");
    expect(JSON.parse(post.body!)).toEqual({ environment: "gke" });
  });

  it("explains a refused add by its error code", async () => {
    const { user } = setup("#app-moimroom", "live");
    live(single, (c, u) =>
      u.pathname === "/v1/apps/moimroom/environments" && c.method === "POST" ? json(409, { error: { code: "db_pair_unavailable", message: "no pair" } }) : undefined,
    );
    await user.click(await screen.findByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    await waitFor(() => expect(within(form).getByLabelText("더할 환경")).toHaveValue("gke"));
    await user.click(within(form).getByRole("button", { name: "환경 추가" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("환경을 더하지 못했습니다.");
    expect(alert).toHaveTextContent("짝(primary와 replica)으로 맺을 수 없어 환경을 더할 수 없습니다");
    expect(window.location.hash).toBe("#app-moimroom");
  });

  it("takes an added environment out after a typed confirmation, and shows why the server refused", async () => {
    const paired = appIn(["eks", "gke"], { primary: "eks", replica: "gke", replicaPresent: true });
    const { user } = setup("#app-moimroom", "live");
    let refuse = true;
    const calls = live(paired, (c, u) =>
      u.pathname === "/v1/apps/moimroom/environments/gke" && c.method === "DELETE"
        ? refuse
          ? json(409, { error: { code: "write_backend", message: "gke took writes" } })
          : json(202, { app: appIn(["eks"]) })
        : undefined,
    );
    await user.click(await screen.findByRole("button", { name: "GCP GKE 환경 빼기" }));
    expect(screen.queryByRole("button", { name: "AWS EKS 환경 빼기" })).toBeNull();
    const box = screen.getByRole("group", { name: "환경 빼기 확인" });
    expect(box).toHaveTextContent("네임스페이스와 그 안의 DB 복제본, 파일(버킷)을 지웁니다");
    expect(within(box).getByRole("button", { name: "삭제" })).toBeDisabled();
    await user.type(within(box).getByLabelText("확인하려면 환경 이름 gke을(를) 입력하세요"), "gke");
    await user.click(within(box).getByRole("button", { name: "삭제" }));
    expect(await within(box).findByRole("alert")).toHaveTextContent("쓰기를 받고 있거나 받은 적이 있어");

    refuse = false;
    await user.click(within(box).getByRole("button", { name: "삭제" }));
    expect(await screen.findByText(/GCP GKE 환경을 뺐습니다/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/v1/apps/moimroom/environments/gke", "/v1/apps/moimroom/environments/gke"]);
  });

  it("links 이전 once the pair is ready", async () => {
    const ready = appIn(["eks", "gke"], {
      primary: "eks",
      replica: "gke",
      replicaPresent: true,
      readiness: { ready: true, reason: "ready", message: "ok", environments: [] },
    });
    setup("#app-moimroom", "live");
    live(ready);
    expect(await screen.findByText("이전 준비됨")).toBeInTheDocument();
    expect(within(head()).getByRole("link", { name: "이전" })).toHaveAttribute("href", "#migrate-app?app=moimroom");
  });

  it("says which database is primary now, not the roles it was created with, once a migration swapped them", async () => {
    // created with gke as primary and eks as the replica; the readiness reads the Clusters as they are: eks primary, gke replica
    const swapped = appIn(["eks", "gke"], {
      primary: "gke",
      replica: "eks",
      replicaPresent: true,
      readiness: {
        ready: true,
        reason: "ready",
        message: "ok",
        environments: [
          { env: "gke", inApp: true, deployed: true, gatewayBackend: true, role: "replica", healthy: true },
          { env: "eks", inApp: true, deployed: true, gatewayBackend: true, role: "primary", healthy: true },
        ],
      },
    });
    setup("#app-moimroom", "live");
    live(swapped);
    expect(await screen.findByText("DB는 지금 AWS EKS에서 primary로, GCP GKE에서 그 replica로 있습니다. 두 환경이 모두 준비되면 이전할 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/태어납니다/)).toBeNull();
  });

  it("calls the topology the creation roles when the readiness does not tell the roles", async () => {
    setup("#app-moimroom", "live");
    live(appIn(["eks", "gke"], { primary: "gke", replica: "eks", replicaPresent: true }));
    expect(await screen.findByText("DB는 처음 GCP GKE에서 primary로, AWS EKS에서 그 replica로 만들어졌습니다. 이전하면 역할이 서로 바뀝니다. 두 환경이 모두 준비되면 이전할 수 있습니다.")).toBeInTheDocument();
  });

  it("keeps the 이전 link for a server without readiness or replicaPresent", async () => {
    setup("#app-moimroom", "live");
    live(appIn(["eks", "gke"], { primary: "eks", replica: "gke" } as AppDBTopology));
    await screen.findByRole("heading", { name: "DB 짝" });
    const link = within(head()).getByRole("link", { name: "이전" });
    expect(link).toHaveAttribute("href", "#migrate-app?app=moimroom");
    expect(link).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("이전 준비 안 됨")).toBeNull();
  });

  /** The migration page of moimroom; `ai` answers GET /v1/ai-runs, so the AI button shows. */
  async function migratePage(app: ApiApp | null, o: { ai?: boolean; runs?: unknown[] } = {}) {
    setup("#migrate-app?app=moimroom", "live");
    live(app ?? pairWith("ready"), (c, u) => {
      if (u.pathname === "/v1/apps/moimroom" && app === null) return json(500, { error: { code: "internal", message: "boom" } });
      if (u.pathname === "/v1/ai-runs" && o.ai) return json(200, { runs: [] });
      if (u.pathname === "/v1/migrations" && c.method === "GET") return json(200, { runs: o.runs ?? [] });
      if (u.pathname === "/v1/plans") return json(200, { plans: [] });
      return undefined;
    });
  }
  const box = () => document.getElementById("mig-blocked");

  it("stops both plan buttons for a reason that is sure to fail (deploy_pending)", async () => {
    await migratePage(pairWith("deploy_pending", { deployed: false }), { ai: true });
    await waitFor(() => expect(box()).toHaveTextContent("아직 정상 배포가 끝나지 않은 곳이 있습니다"));
    expect(screen.getByRole("button", { name: /AI 계획·리허설 실행/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /AI 없이 Plan 작성/ })).toBeDisabled();
  });

  it("leaves the AI plan on for app_degraded, which can pick cold mode, and says so", async () => {
    await migratePage(pairWith("app_degraded", { deployed: false }), { ai: true });
    await waitFor(() => expect(box()).toHaveTextContent("AI 계획은 cold 모드를 고를 수 있어 실행할 수 있습니다"));
    expect(screen.getByRole("button", { name: /AI 계획·리허설 실행/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /AI 없이 Plan 작성/ })).toBeDisabled();
  });

  it("only warns for what may pass by the start: an unread cluster, an unknown reason", async () => {
    await migratePage(pairWith("cluster_unreadable"));
    await waitFor(() => expect(box()).toHaveTextContent("DB 클러스터(CNPG)를 읽지 못했습니다"));
    expect(screen.getByRole("button", { name: /Plan 작성/ })).toBeEnabled();
    expect(pairCheck(pairWith("something_new").deploy!.dbTopology!.readiness, "gke", undefined)).toEqual({ text: "아직 이전할 수 없습니다: the server says something_new", stop: "none" });
    expect(pairCheck(pairWith("deploy_failed").deploy!.dbTopology!.readiness, "gke", undefined)?.stop).toBe("none");
    expect(pairCheck(pairWith("deploy_failed", { deployed: false }).deploy!.dbTopology!.readiness, "gke", undefined)?.stop).toBe("all");
    expect(pairCheck(pairWith("migration_in_progress").deploy!.dbTopology!.readiness, "gke", undefined)?.stop).toBe("none");
  });

  it("fails open when the app's readiness cannot be read", async () => {
    await migratePage(null);
    await waitFor(() => expect(box()).toHaveTextContent("DB 짝이 이전할 준비가 되었는지 읽지 못했습니다"));
    expect(screen.getByRole("button", { name: /Plan 작성/ })).toBeEnabled();
  });

  it("links the app's migration in progress instead of planning another", async () => {
    const run = fakeRun({ runId: "run_9", planRef: "pln_9", status: "awaiting_switch", phase: "awaiting_switch", source: { env: "eks", namespace: "moimroom", cluster: "moimroom-db" }, target: { env: "gke", namespace: "moimroom", cluster: "moimroom-db" } });
    await migratePage(pairWith("migration_in_progress"), { runs: [run] });
    await waitFor(() => expect(box()).toHaveTextContent("이 앱의 이전이 진행 중이거나 게이트웨이가 쓰기를 잡고 있습니다"));
    expect(screen.getByRole("button", { name: /Plan 작성/ })).toBeDisabled();
    expect(within(box()!).getByRole("button", { name: "진행 중인 이전 보기" })).toBeInTheDocument();
  });

  // the live moimroom-mig keeps an old incident run: halted, phase done, endedAt set; later runs succeeded after it
  const endedHalted = fakeRun({
    runId: "moimroom-mig-eks-to-gke-20261107-021354",
    status: "halted",
    phase: "done",
    endedAt: at(30),
    source: { env: "eks", namespace: "moimroom", cluster: "moimroom-db" },
    target: { env: "gke", namespace: "moimroom", cluster: "moimroom-db" },
  });

  it("counts a run in progress by the platform's rule: not ended, running or awaiting its switch", () => {
    expect(runInProgress(endedHalted)).toBe(false);
    expect(runInProgress(fakeRun({ status: "interrupted", phase: "cutover" }))).toBe(false);
    expect(runInProgress(fakeRun({ status: "running", phase: "sync" }))).toBe(true);
    expect(runInProgress(fakeRun({ status: "awaiting_switch", phase: "awaiting_switch" }))).toBe(true);
    expect(runInProgress(fakeRun({ status: "running", phase: "done", endedAt: at(9) }))).toBe(false);
  });

  it("does not hold the plan buttons for a run that ended halted", async () => {
    // newest first: a later run succeeded, so the page does not open the halted one either
    const later = fakeRun({ runId: "run_later", status: "succeeded", phase: "done", endedAt: at(50), source: endedHalted.target, target: endedHalted.source });
    await migratePage(pairWith("migration_in_progress"), { runs: [later, endedHalted] });
    await waitFor(() => expect(box()).toHaveTextContent("이 앱의 이전이 진행 중이거나 게이트웨이가 쓰기를 잡고 있습니다"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Plan 작성/ })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "진행 중인 이전 보기" })).not.toBeInTheDocument();
  });

  it("does not offer to take out the environment that receives the writes, and keeps the replica's DB out of other texts", async () => {
    // after a migration the gateway writes to gke; the pair still names eks as born primary
    const moved = appIn(["eks", "gke"], { primary: "eks", replica: "gke", replicaPresent: true });
    setup("#app-moimroom", "live");
    live(moved, (_c, u) => (u.pathname === "/v1/traffic" ? traffic("gke", ["eks", "gke"]) : undefined));
    await waitFor(() => expect(screen.getByRole("button", { name: "GCP GKE 환경 빼기" })).toBeDisabled());
    expect(screen.getByText("지금 쓰기를 받는 환경이라 뺄 수 없습니다")).toBeInTheDocument();
  });

  it("describes only the namespace and files when the environment holds no replica of the app's database", async () => {
    const plain = appIn(["eks", "gke"]);
    const { user } = setup("#app-moimroom", "live");
    live(plain);
    await user.click(await screen.findByRole("button", { name: "GCP GKE 환경 빼기" }));
    const box = screen.getByRole("group", { name: "환경 빼기 확인" });
    expect(box).toHaveTextContent("네임스페이스와 그 안의 파일(버킷)을 지웁니다");
    expect(box).not.toHaveTextContent("DB 복제본");
  });

  it("explains a refusal code newer than the console with the server's sentence", async () => {
    const { user } = setup("#app-moimroom", "live");
    live(single, (c, u) =>
      u.pathname === "/v1/apps/moimroom/environments" && c.method === "POST" ? json(409, { error: { code: "quota_exceeded", message: "too many environments" } }) : undefined,
    );
    await user.click(await screen.findByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    await waitFor(() => expect(within(form).getByLabelText("더할 환경")).toHaveValue("gke"));
    await user.click(within(form).getByRole("button", { name: "환경 추가" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("플랫폼이 거절했습니다(quota_exceeded): too many environments");
  });

  it("adds a failed environment again from its row; the server deploys it again", async () => {
    const paired = appIn(["eks", "gke"], { primary: "eks", replica: "gke", replicaPresent: true });
    const failed = fakeDeployment({ id: "dep_add", trigger: "environment", status: "failed", finishedAt: at(40), environments: [{ env: "eks", status: "healthy" }, { env: "gke", status: "degraded" }] });
    const { user } = setup("#app-moimroom", "live");
    const calls = live(paired, (c, u) => {
      if (u.pathname === "/v1/apps/moimroom/deployments") return json(200, { deployments: [failed] });
      if (u.pathname === "/v1/apps/moimroom/environments" && c.method === "POST") return json(202, { app: paired, deployment: fakeDeployment({ id: "dep_again", trigger: "environment" }) });
      return undefined;
    });
    await user.click(await screen.findByRole("button", { name: "GCP GKE 환경 추가 다시 시도" }));
    await waitFor(() => expect(window.location.hash).toBe("#deploy-dep_again"));
    expect(JSON.parse(calls.find((c) => c.method === "POST")!.body!)).toEqual({ environment: "gke" });
  });

  it("shows the removal's answer at once, marks the environment, and explains a re-add while it is still being deleted", async () => {
    const paired = appIn(["eks", "gke"], { primary: "eks", replica: "gke", replicaPresent: true });
    const { user } = setup("#app-moimroom", "live");
    let removed = false;
    live(paired, (c, u) => {
      if (u.pathname === "/v1/apps/moimroom/environments/gke" && c.method === "DELETE") {
        removed = true;
        return json(202, { app: single });
      }
      // the next read does not answer: the page shows the app the removal answered with
      if (u.pathname === "/v1/apps/moimroom" && c.method === "GET" && removed) return hang(c);
      if (u.pathname === "/v1/apps/moimroom/environments" && c.method === "POST")
        return json(409, { error: { code: "environment_cleanup_pending", message: "Argo CD is still deleting Application moimroom-gke" } });
      return undefined;
    });
    await user.click(await screen.findByRole("button", { name: "GCP GKE 환경 빼기" }));
    const box = screen.getByRole("group", { name: "환경 빼기 확인" });
    await user.type(within(box).getByLabelText("확인하려면 환경 이름 gke을(를) 입력하세요"), "gke");
    await user.click(within(box).getByRole("button", { name: "삭제" }));
    expect(await screen.findByText(/GCP GKE 환경을 뺐습니다/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "GCP GKE 환경 빼기" })).toBeNull());
    expect(screen.getByText("DB 짝 GCP GKE 환경이 아직 앱에 없습니다")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    await waitFor(() => expect(within(form).getByRole("option", { name: "GCP GKE (정리 중일 수 있음)" })).toBeInTheDocument());
    expect(form).toHaveTextContent("방금 뺀 환경입니다");
    await user.click(within(form).getByRole("button", { name: "환경 추가" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("예전 환경이 다 지워질 때까지 기다린 뒤 다시 더하세요");
  });

  it("says why the environments could not be read instead of loading forever", async () => {
    const { user } = setup("#app-moimroom", "live");
    live(single, (_c, u) => (u.pathname === "/v1/envs" ? json(500, { error: { code: "internal", message: "envs down" } }) : undefined));
    await user.click(await screen.findByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    expect(await within(form).findByRole("alert")).toHaveTextContent("서버의 환경 목록을 읽지 못했습니다.");
    expect(within(form).getByRole("button", { name: "환경 추가" })).toBeDisabled();
  });

  it("keeps adding and taking out off while a deployment of the app runs", async () => {
    const paired = appIn(["eks", "gke"], { primary: "eks", replica: "gke", replicaPresent: true });
    setup("#app-moimroom", "live");
    live(paired, (_c, u) => (u.pathname === "/v1/apps/moimroom/deployments" ? json(200, { deployments: [fakeDeployment({ id: "dep_run", status: "syncing" })] }) : undefined));
    await waitFor(() => expect(within(head()).getByRole("button", { name: "환경 추가" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "GCP GKE 환경 빼기" })).toBeDisabled();
    expect(screen.getByText("배포가 끝나야 환경을 더하거나 뺄 수 있습니다.")).toBeInTheDocument();
  });
});

describe("adding and removing an app's environment (simulation)", () => {
  it("takes an environment out of a demo app; a postgres app without a pair cannot get it back", async () => {
    const { sim, user } = setup("#app-todo-api");
    const app = () => sim.state.deploy.apps.find((a) => a.name === "todo-api")!.deploy!;
    expect(app().environments).toEqual(["eks", "gke", "k3s"]);
    // every environment is the app's already
    await user.click(screen.getByRole("button", { name: "환경 추가" }));
    expect(screen.getByText("더할 수 있는 환경이 없습니다. 서버의 환경이 모두 이 앱에 있습니다.")).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "환경 추가" })).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("button", { name: "AWS EKS 환경 빼기" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "온프레미스 k3s 환경 빼기" }));
    const box = screen.getByRole("group", { name: "환경 빼기 확인" });
    await user.type(within(box).getByLabelText("확인하려면 환경 이름 k3s을(를) 입력하세요"), "k3s");
    await user.click(within(box).getByRole("button", { name: "삭제" }));
    expect(await screen.findByText(/온프레미스 k3s 환경을 뺐습니다/)).toBeInTheDocument();
    expect(app().environments).toEqual(["eks", "gke"]);
    expect(app().status.map((s) => s.env)).toEqual(["eks", "gke"]);
    expect(sim.state.deploy.deployments[0].trigger).toBe("environment");
    ticks(sim, 200);
    expect(sim.state.deploy.deployments[0].status).toBe("healthy");

    await user.click(screen.getByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    expect(within(form).getByLabelText("더할 환경")).toHaveValue("k3s");
    await user.click(within(form).getByRole("button", { name: "환경 추가" }));
    // todo-api has postgres and no database pair, so the platform would give k3s a separate primary
    expect(await within(form).findByRole("alert")).toHaveTextContent("짝(primary와 replica)으로 맺을 수 없어");
    expect(app().environments).toEqual(["eks", "gke"]);
  });

  it("adds the pair's peer to the demo wiki app, which then is ready to migrate, with the server's guards", async () => {
    const { sim, user } = setup("#app-wiki");
    const wiki = () => sim.state.deploy.apps.find((a) => a.name === "wiki")!;
    const pair = (await screen.findByRole("heading", { name: "DB 짝" })).closest("section") as HTMLElement;
    expect(within(pair).getByText("상대 환경 없음")).toBeInTheDocument();
    expect(screen.getByText(/상대 환경이 아직 앱에 없습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    expect(within(form).getAllByRole("option").map((o) => o.textContent)).toEqual(["GCP GKE"]);
    await user.click(within(form).getByRole("button", { name: "환경 추가" }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#deploy-dep_/));
    ticks(sim, 200);
    expect(dep.withReadiness(sim.state.deploy, wiki()).deploy!.dbTopology).toMatchObject({ replicaPresent: true, readiness: { ready: true, reason: "ready" } });

    expect(dep.checkAddEnvironment(sim.state.deploy, "wiki", "k3s")?.code).toBe("db_pair_unavailable");
    expect(dep.checkAddEnvironment(sim.state.deploy, "wiki", "gke")?.code).toBe("environment_exists");
    expect(dep.checkRemoveEnvironment(sim.state.deploy, "wiki", "gke", true)?.code).toBe("migration_in_progress");
    expect(dep.checkRemoveEnvironment(sim.state.deploy, "wiki", "gke")).toBeNull();
  });
});

describe("Japanese", () => {
  it("translates the new texts of the app page", async () => {
    const paired = appIn(["eks", "gke"], {
      primary: "eks",
      replica: "gke",
      replicaPresent: true,
      readiness: {
        ready: false,
        reason: "deploy_pending",
        message: "pending",
        environments: [
          { env: "eks", inApp: true, deployed: true, gatewayBackend: true, role: "primary", healthy: true, phase: "Cluster in healthy state" },
          { env: "gke", inApp: true, deployed: false, gatewayBackend: false, role: "replica", healthy: false },
        ],
      },
    });
    const { user } = setup("#app-moimroom", "live");
    live(paired, (c, u) =>
      u.pathname === "/v1/apps/moimroom/environments/gke" && c.method === "DELETE" ? json(409, { error: { code: "primary_environment", message: "no" } }) : undefined,
    );
    const pair = (await screen.findByRole("heading", { name: "DB 짝" })).closest("section") as HTMLElement;
    const warn = document.getElementById(within(head()).getByRole("link", { name: "이전" }).getAttribute("aria-describedby")!) as HTMLElement;
    await user.click(screen.getByRole("button", { name: "환경 추가" }));
    await user.click(screen.getByRole("button", { name: "GCP GKE 환경 빼기" }));
    const box = screen.getByRole("group", { name: "환경 빼기 확인" });
    await user.type(within(box).getByLabelText("확인하려면 환경 이름 gke을(를) 입력하세요"), "gke");
    await user.click(within(box).getByRole("button", { name: "삭제" }));
    await within(box).findByRole("alert");
    const form = screen.getByRole("group", { name: "환경 추가" });

    const stop = translateDom(document.body, makeTranslator(ja));
    try {
      const hangul = (el: HTMLElement) => {
        const left: string[] = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[가-힣]/.test(n.nodeValue ?? "")) left.push(n.nodeValue!);
        for (const a of el.querySelectorAll("[aria-label],[title]"))
          for (const k of ["aria-label", "title"]) if (/[가-힣]/.test(a.getAttribute(k) ?? "")) left.push(a.getAttribute(k)!);
        return left;
      };
      await waitFor(() => expect([...hangul(pair), ...hangul(warn), ...hangul(form), ...hangul(box), ...hangul(document.querySelector(".appd-head") as HTMLElement)]).toEqual([]));
      const strip = document.querySelector(".appd-envs") as HTMLElement;
      expect(hangul(strip)).toEqual([]);
    } finally {
      stop();
    }
  });

  it("has every error and readiness text of ADR 0037 in the dictionary", () => {
    const tr = makeTranslator(ja);
    const add = [
      "app_not_registered",
      "env_not_found",
      "environment_exists",
      "deployment_in_progress",
      "migration_in_progress",
      "nothing_to_redeploy",
      "db_pair_unavailable",
      "storage_not_configured",
      "sealing_not_configured",
      "environment_cleanup_pending",
      "environment_cleanup_unknown",
      "app_changed",
      "something_new",
    ];
    const remove = [
      "app_not_registered",
      "env_not_found",
      "primary_environment",
      "write_backend",
      "environment_has_files",
      "deployment_in_progress",
      "migration_in_progress",
      "app_changed",
      "github_unreachable",
      "gateway_unreachable",
      "github_not_configured",
      "db_topology_unready",
      "db_topology_unknown",
      "db_topology_unreachable",
      "db_topology_changed",
      "db_topology_denied",
    ];
    const reasons = [
      "replica_missing",
      "deploy_pending",
      "app_degraded",
      "deploy_failed",
      "migration_in_progress",
      "gateway_unreachable",
      "gateway_backend_missing",
      "cluster_unreadable",
      "cluster_not_healthy",
      "topology_mismatch",
      "write_backend_mismatch",
      "something_new",
    ];
    const texts = [
      ...add.map((code) => envErrorText(new ApiError(409, code, "eks, gke"), false)),
      ...remove.map((code) => "환경을 빼지 못했습니다. " + envErrorText(new ApiError(409, code, "no"), true)),
      ...reasons.map((reason) => pairCheck({ ready: false, reason, message: "not yet", environments: [] }, "gke", "run_1")!.text),
      "DB 짝이 이전할 준비가 되었는지 확인하는 중입니다",
      "DB 짝이 이전할 준비가 되었는지 읽지 못했습니다. 계획은 만들 수 있고, 플랫폼이 시작할 때 다시 확인합니다",
      "진행 중인 이전 보기",
      "DB는 지금 AWS EKS에서 primary로, GCP GKE에서 그 replica로 있습니다. 두 환경이 모두 준비되면 이전할 수 있습니다.",
      "DB는 처음 GCP GKE에서 primary로, AWS EKS에서 그 replica로 만들어졌습니다. 이전하면 역할이 서로 바뀝니다. 두 환경이 모두 준비되면 이전할 수 있습니다.",
      "온프레미스 k3s 환경을 뺐습니다. Argo CD가 그 환경의 네임스페이스와 DB, 파일을 지우고 있습니다.",
      "앱의 모든 인스턴스에서 GCP GKE 환경을 뺍니다. gitops 저장소에서 각 인스턴스의 gke.yaml을 지우고, Argo CD가 이 환경의 네임스페이스와 그 안의 파일(버킷)을 지웁니다. 데이터는 되돌릴 수 없습니다. 다른 환경은 그대로 둡니다.",
      "지금 쓰기를 받는 환경이라 뺄 수 없습니다",
      "지금 DB primary가 있는 환경이라 뺄 수 없습니다",
      "배포가 진행 중이라 끝난 뒤 환경을 더하거나 뺄 수 있습니다",
      "배포가 끝나야 환경을 더하거나 뺄 수 있습니다.",
      "환경 추가 다시 시도",
      "GCP GKE 환경 추가 다시 시도",
      "서버의 환경 목록을 읽지 못했습니다. 서버에 연결할 수 없습니다 (주소, CORS, 네트워크 확인)",
      "DB 짝의 두 환경이 모두 앱에 있어 더할 환경이 없습니다.",
      "GCP GKE (정리 중일 수 있음)",
      "방금 뺀 환경입니다. Argo CD가 예전 환경을 다 지울 때까지 플랫폼이 다시 더하기를 거절하니, 그때는 잠시 뒤 다시 누르세요.",
    ];
    expect(texts.filter((t) => { const out = tr(t); return out === null || /[가-힣]/.test(out); })).toEqual([]);
  });
});
