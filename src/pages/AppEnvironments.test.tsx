import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { at, fakeDeployment, fakeSession, hang, installFetch, json, type FakeCall } from "../api/fakes";
import type { App as ApiApp, AppDBTopology, AppInstance, AppSpec } from "../api/types";
import { App } from "../App";
import { envErrorText } from "../data/deploy";
import { initAuth, startSession } from "../data/live";
import { readinessBlock } from "../data/migration";
import { ApiError } from "../api/client";
import ja from "../i18n/ja.json";
import { translateDom } from "../i18n/dom";
import { makeTranslator } from "../i18n/translate";
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
    database: { name: "app", user: "app", schemas: [] },
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

function live(app: ApiApp, extra: (c: FakeCall, u: URL) => Response | undefined = () => undefined): FakeCall[] {
  const calls = installFetch((c) => {
    const u = new URL(c.url, "http://x");
    const r = extra(c, u);
    if (r) return r;
    if (u.pathname === "/v1/envs") return json(200, { environments: [env("eks", "AWS EKS"), env("gke", "GCP GKE")] });
    if (u.pathname === "/v1/apps" && c.method === "GET") return json(200, { apps: [app] });
    if (u.pathname === "/v1/apps/moimroom" && c.method === "GET") return json(200, app);
    if (u.pathname === "/v1/apps/moimroom/deployments") return json(200, { deployments: [fakeDeployment({ status: "healthy", finishedAt: at(50) })] });
    if (u.pathname === "/v1/traffic") {
      const [w, ...rest] = app.deploy!.environments;
      return json(200, {
        writeBackend: w,
        readWeights: Object.fromEntries([[w, 100], ...rest.map((e) => [e, 0])]),
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
    if (u.pathname.endsWith("/events")) return hang(c);
    return json(404, { error: { code: "not_found", message: "no" } });
  });
  act(() => startSession(fakeSession()));
  return calls;
}

describe("adding and removing an app's environment (platform API)", () => {
  it("shows the missing peer, keeps 이전 off with the reason, and adds the pair's environment", async () => {
    const { user } = setup("#app-moimroom", "live");
    const calls = live(single, (c, u) =>
      u.pathname === "/v1/apps/moimroom/environments" && c.method === "POST"
        ? json(202, { app: single, deployment: fakeDeployment({ id: "dep_env", trigger: "environment" }) })
        : undefined,
    );
    const pair = (await screen.findByRole("heading", { name: "DB 짝" })).closest("section") as HTMLElement;
    expect(within(pair).getByText("이전 준비 안 됨")).toBeInTheDocument();
    expect(within(pair).getByText(/상대 환경이 아직 앱에 없습니다/)).toBeInTheDocument();
    expect(within(pair).getByText("상대 환경 없음")).toBeInTheDocument();
    expect(screen.getByText("DB 짝 GCP GKE 환경이 아직 앱에 없습니다")).toBeInTheDocument();
    expect(within(head()).getByRole("button", { name: "이전" })).toBeDisabled();
    expect(within(head()).queryByRole("link", { name: "이전" })).toBeNull();
    // the first environment cannot be taken out
    expect(screen.queryByRole("button", { name: /환경 빼기$/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "환경 추가" }));
    const form = screen.getByRole("group", { name: "환경 추가" });
    await waitFor(() => expect(within(form).getByLabelText("더할 환경")).toHaveValue("gke"));
    expect(within(form).queryByRole("option", { name: "AWS EKS" })).toBeNull();
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

  it("keeps the plan buttons of the migration page off while the pair is not ready, and says why", async () => {
    const degraded = appIn(["eks", "gke"], {
      primary: "eks",
      replica: "gke",
      replicaPresent: true,
      readiness: { ready: false, reason: "app_degraded", message: "gke degraded", environments: [] },
    });
    setup("#migrate-app?app=moimroom", "live");
    live(degraded);
    expect(await screen.findByText(/시작할 때 DB에 쓰는 것 같습니다/)).toBeInTheDocument();
    expect(screen.getByText(/cold 모드/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Plan 작성/ })).toBeDisabled();
  });
});

describe("adding and removing an app's environment (simulation)", () => {
  it("takes an environment out of a demo app and adds it back, each with a deployment without a build", async () => {
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
    await waitFor(() => expect(window.location.hash).toMatch(/^#deploy-dep_/));
    expect(app().environments).toEqual(["eks", "gke", "k3s"]);
    expect(sim.state.deploy.deployments[0].trigger).toBe("environment");
    ticks(sim, 200);
    expect(sim.state.deploy.deployments[0].status).toBe("healthy");
    expect(app().status.map((s) => [s.env, s.status])).toEqual([["eks", "healthy"], ["gke", "healthy"], ["k3s", "healthy"]]);
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
      await waitFor(() => expect([...hangul(pair), ...hangul(form), ...hangul(box), ...hangul(document.querySelector(".appd-head") as HTMLElement)]).toEqual([]));
      const strip = document.querySelector(".appd-envs") as HTMLElement;
      expect(hangul(strip)).toEqual([]);
    } finally {
      stop();
    }
  });

  it("has every error and readiness text of ADR 0037 in the dictionary", () => {
    const tr = makeTranslator(ja);
    const add = ["app_not_registered", "env_not_found", "environment_exists", "deployment_in_progress", "migration_in_progress", "nothing_to_redeploy", "db_pair_unavailable", "storage_not_configured", "sealing_not_configured"];
    const remove = ["app_not_registered", "env_not_found", "primary_environment", "write_backend", "deployment_in_progress", "migration_in_progress", "github_unreachable", "gateway_unreachable", "github_not_configured"];
    const reasons = ["replica_missing", "deploy_pending", "app_degraded", "deploy_failed", "gateway_unreachable", "gateway_backend_missing", "cluster_unreadable", "cluster_not_healthy", "topology_mismatch", "something_new"];
    const texts = [
      ...add.map((code) => envErrorText(new ApiError(409, code, "eks, gke"), false)),
      ...remove.map((code) => "환경을 빼지 못했습니다. " + envErrorText(new ApiError(409, code, "no"), true)),
      ...reasons.map((reason) => readinessBlock({ ready: false, reason, message: "not yet", environments: [] })!),
      "DB 짝이 이전할 준비가 되었는지 확인하는 중입니다",
      "DB는 AWS EKS에서 primary로, GCP GKE에서 그 replica로 태어납니다. 이전 버튼은 두 환경이 모두 준비되었을 때 켜집니다.",
      "온프레미스 k3s 환경을 뺐습니다. Argo CD가 그 환경의 네임스페이스와 DB, 파일을 지우고 있습니다.",
      "환경 변경 배포",
    ];
    expect(texts.filter((t) => { const out = tr(t); return out === null || /[가-힣]/.test(out); })).toEqual([]);
  });
});
