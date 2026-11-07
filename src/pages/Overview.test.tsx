import { render, screen, waitFor, within } from "@testing-library/react";
import { fakeDeployment, fakeRun, fakeSession, installFetch, json } from "../api/fakes";
import type { App as ApiApp, AuditEntry, Environment } from "../api/types";
import { App } from "../App";
import { initAuth } from "../data/live";
import { auditText } from "./Overview";
import { createSim, SimProvider } from "../sim/store";

afterEach(() => {
  localStorage.clear();
  initAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const zero = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
const spec = { name: "board", services: [] };
const failed = fakeDeployment({ app: "board", instance: "board", status: "failed", finishedAt: "2026-11-02T03:05:00Z" });

// The platform names the on-prem environment "onprem"; the simulation calls it "k3s".
const apps: ApiApp[] = [
  {
    name: "moimroom",
    namespace: "moimroom",
    database: { name: "app", user: "app", schemas: [] },
    environments: ["gke", "eks", "onprem"].map((env) => ({ env, cnpgCluster: "moimroom-db-" + env, dbHost: "h" })),
  },
  {
    name: "board",
    namespace: "board",
    database: { name: "app", user: "app", schemas: [] },
    environments: [],
    deploy: {
      repo: "team-charlie/board",
      branch: "main",
      environments: ["eks", "onprem"],
      autoDeploy: true,
      spec,
      specCommit: "9fceb02",
      createdAt: "2026-11-02T03:00:00Z",
      createdBy: "t",
      lastDeployment: failed,
      status: [
        { env: "eks", status: "healthy" },
        { env: "onprem", status: "failed" },
      ],
      instances: [],
    },
  },
];

describe("overview (platform API)", () => {
  it("matches the platform's onprem environment in the route matrix and the app chips, and shows runs in progress", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const onprem = { env: "onprem", namespace: "shop", cluster: "shop-db" };
    installFetch((c) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/apps") return json(200, { apps });
      if (u.pathname === "/v1/matrix")
        return json(200, { routes: [{ source: "eks", target: "onprem", runId: "run_0", status: "succeeded", finishedAt: "2026-11-02T03:02:04Z", result: { durationMillis: 124_000 } }] });
      if (u.pathname === "/v1/migrations")
        return json(200, { runs: [fakeRun({ runId: "run_2", target: onprem, status: "running", phase: "canary" }), fakeRun({ runId: "run_1", status: "succeeded", endedAt: twoDaysAgo })] });
      if (u.pathname === "/v1/security") return json(200, { generatedAt: "2026-11-02T03:00:00Z", summary: { bySeverity: zero, byEnvironment: {} }, sources: [], findings: [] });
      return json(404, { error: { code: "not_found", message: "no" } });
    });
    localStorage.setItem("hopcharlie.mode", "live");
    localStorage.setItem("hopcharlie.session", JSON.stringify(fakeSession()));
    window.location.hash = "#overview";
    initAuth();
    render(
      <SimProvider sim={createSim()} intervalMs={0}>
        <App />
      </SimProvider>,
    );

    // the finished route and the run in progress laid over the matrix
    expect(await screen.findByRole("link", { name: "EKS에서 k3s로 성공, 2분 4초" })).toHaveAttribute("href", "#routes");
    expect(await screen.findByRole("link", { name: "GKE에서 k3s로 진행 중" })).toHaveAttribute("href", "#migrate-app");

    // a failure on onprem shows on its chip; a file app is only registered, not healthy
    const board = (await screen.findByRole("link", { name: "board" })).closest("tr") as HTMLElement;
    expect(within(board).getByTitle("온프레미스 k3s 실패")).toHaveClass("bad");
    expect(within(board).getByTitle("AWS EKS 정상")).toHaveClass("ok");
    expect(within(board).getByTitle("GCP GKE 그 환경에 없음")).toHaveClass("off");
    const moimroom = screen.getByRole("link", { name: "moimroom" }).closest("tr") as HTMLElement;
    for (const name of ["AWS EKS", "GCP GKE", "온프레미스 k3s"]) expect(within(moimroom).getByTitle(name + " 등록됨, 상태 모름")).toHaveAttribute("class", "chip");

    // the run in progress needs a look; a run that ended two days ago does not
    const now = screen.getByRole("heading", { name: "지금 볼 것" }).closest("section") as HTMLElement;
    expect(await within(now).findByText("shop 이전이 진행 중입니다")).toBeInTheDocument();
    expect(within(now).getByText((_, el) => el?.textContent === "GCP GKE에서 온프레미스 k3s로, 카나리 중")).toBeInTheDocument();
    expect(within(now).queryByText("shop 이전을 마쳤습니다")).not.toBeInTheDocument();
    expect(within(now).getByText("1건")).toBeInTheDocument();
  });
});

describe("overview cluster cards: who takes the writes", () => {
  // the platform marks gke live because it is the default gateway's write backend (the old shop example); every app is served by eks
  const env = (name: string, displayName: string, live: boolean): Environment => ({
    name, provider: name === "gke" ? "gcp" : "aws", displayName, kubeContext: name, gatewayBackend: name, live,
    status: { reachable: true, checkedAt: "2026-11-07T00:00:00Z", kubernetesVersion: "1.34", nodes: { ready: 3, total: 3, architectures: ["amd64"] } },
  });
  // an app of the apps file has a gateway of its own; a registered one has none (GET /v1/traffic?app= answers 400) unless it has a database pair
  const registered = (name: string, gateway = true): ApiApp => ({
    name, namespace: name, database: { name: "app", user: "app", schemas: [] },
    environments: gateway ? [{ env: "eks", cnpgCluster: name + "-db", dbHost: "h" }] : [],
  });
  const gateway = (writeBackend: string) =>
    json(200, {
      writeBackend, readWeights: { eks: writeBackend === "eks" ? 100 : 0, gke: writeBackend === "gke" ? 100 : 0 }, writesHeld: false, heldWrites: 0, maxHold: "30s",
      inFlight: { reads: 0, writes: 0 }, backends: [], stats: {}, totals: {}, updatedAt: "2026-11-07T00:00:00Z",
    });

  function open(route: (app: string | null) => Response) {
    const calls = installFetch((c) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/envs") return json(200, { environments: [env("gke", "GCP GKE", true), env("eks", "AWS EKS", false), env("onprem", "온프레미스 k3s", false)] });
      if (u.pathname === "/v1/apps") return json(200, { apps: [registered("docker-doom", false), registered("moimroom-mig"), registered("pxls"), registered("board")] });
      if (u.pathname === "/v1/traffic") return route(u.searchParams.get("app"));
      return json(404, { error: { code: "not_found", message: "no" } });
    });
    localStorage.setItem("hopcharlie.mode", "live");
    localStorage.setItem("hopcharlie.session", JSON.stringify(fakeSession()));
    window.location.hash = "#overview";
    initAuth();
    render(
      <SimProvider sim={createSim()} intervalMs={0}>
        <App />
      </SimProvider>,
    );
    return calls;
  }
  const traffic = async (name: string) => {
    const card = (await screen.findByText(name, { selector: ".envcard .cellh b span" })).closest(".envcard") as HTMLElement;
    return within(card).getByText("트래픽").nextElementSibling;
  };

  it("counts the apps whose own gateway writes to the cluster, instead of the default gateway's flag", async () => {
    const calls = open(() => gateway("eks"));
    await waitFor(async () => expect(await traffic("AWS EKS")).toHaveTextContent("쓰기 받음 (앱 3개)"));
    expect(await traffic("GCP GKE")).toHaveTextContent(/^대기$/);
    expect(await traffic("온프레미스 k3s")).toHaveTextContent(/^대기$/);
    // only the apps that have a gateway are asked, and the gateway without an app is not
    const asked = calls.filter((c) => c.url.includes("/v1/traffic")).map((c) => new URL(c.url, "http://x").searchParams.get("app"));
    expect([...new Set(asked)].sort()).toEqual(["board", "moimroom-mig", "pxls"]);
  });

  it("splits the apps between the clusters", async () => {
    open((app) => gateway(app === "pxls" ? "gke" : "eks"));
    await waitFor(async () => expect(await traffic("AWS EKS")).toHaveTextContent("쓰기 받음 (앱 2개)"));
    expect(await traffic("GCP GKE")).toHaveTextContent("쓰기 받음 (앱 1개)");
  });

  it("goes back to the platform's live flag when no app's gateway can be read", async () => {
    open(() => json(503, { error: { code: "gateway_unreachable", message: "no" } }));
    await waitFor(async () => expect(await traffic("GCP GKE")).toHaveTextContent(/^쓰기 받음$/));
    expect(await traffic("AWS EKS")).toHaveTextContent(/^대기$/);
  });
});

describe("overview recent activity line", () => {
  const entry = (p: Partial<AuditEntry>): AuditEntry => ({ id: 1, time: "2026-11-07T00:00:00Z", actor: "softbankcharlie", role: "operator", action: "POST /v1/plans", target: "/v1/plans", status: 201, ...p });

  it("drops the empty brackets of an entry without a role", () => {
    expect(auditText(entry({ actor: "anonymous", role: "", action: "GET /v1/apps", target: "/v1/apps", status: 401 }))).toBe("anonymous: GET /v1/apps → 401");
    expect(auditText(entry({}))).toBe("softbankcharlie (operator): POST /v1/plans → 201");
  });

  it("shows a path once when the target is the action's own path", () => {
    expect(auditText(entry({ role: "", actor: "github", action: "POST /v1/webhooks/github", target: "/v1/webhooks/github", status: 202 }))).toBe("github: POST /v1/webhooks/github → 202");
  });

  it("shows the real path instead of the route pattern when the target differs", () => {
    expect(auditText(entry({ action: "POST /v1/apps/{name}/environments", target: "/v1/apps/docker-doom/environments", status: 202 }))).toBe(
      "softbankcharlie (operator): POST /v1/apps/docker-doom/environments → 202",
    );
  });

  it("keeps an action that has no path, and the action alone when there is no target", () => {
    expect(auditText(entry({ action: "login", target: "softbankcharlie" }))).toBe("softbankcharlie (operator): login softbankcharlie → 201");
    expect(auditText(entry({ action: "GET /v1/apps", target: "" }))).toBe("softbankcharlie (operator): GET /v1/apps → 201");
  });
});

