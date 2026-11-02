import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setToken } from "./api/client";
import { installFetch, json, type FakeCall } from "./api/fakes";
import { App } from "./App";
import { AI_END, SWITCH_AT } from "./sim/mig";
import { createSim, SimProvider, type Sim } from "./sim/store";

function setup() {
  window.location.hash = "";
  const sim = createSim();
  const user = userEvent.setup();
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
  setToken(null);
  vi.unstubAllGlobals();
});

describe("HopCharlie console (simulation)", () => {
  it("shows the demo banner and overview", () => {
    setup();
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "개요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "개요" })).toHaveAttribute("aria-current", "page");
  });

  it("runs a migration end to end from the UI", async () => {
    const { sim, user } = setup();
    await user.click(screen.getByRole("link", { name: /^이전$/ }));
    await user.click(await screen.findByRole("button", { name: "가져오기 완료 상태로 건너뛰기" }));
    expect(await screen.findByRole("heading", { level: 1, name: "shop 이전" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "onprem");
    await user.click(screen.getByRole("button", { name: "AI 계획 시작" }));
    ticks(sim, AI_END);
    expect(screen.getByText(/revision 2\)을 승인할까요\?/)).toBeInTheDocument();
    expect(screen.getAllByText("kubectl get secrets -n shop").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));
    ticks(sim, SWITCH_AT);
    expect(screen.getAllByText("전환 승인 대기").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /읽기: AWS EKS 50%, 온프레미스 k3s 50%/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "전환" }));
    ticks(sim, 68);
    expect(screen.getByText("이전 리포트")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /쓰기: AWS EKS 0%, 온프레미스 k3s 100%/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "롤백" })).toBeEnabled();

    await user.click(screen.getAllByRole("link", { name: "경로별 결과" })[0]);
    expect(screen.getByRole("heading", { level: 1, name: "경로별 결과" })).toBeInTheDocument();
    expect(screen.getByText(/6개 중 1개 경로/)).toBeInTheDocument();
  });

  it("lists the AI sessions on the AI activity page", async () => {
    const { sim, user } = setup();
    act(() => {
      sim.dispatch({ type: "onb-skip" });
      sim.dispatch({ type: "mig-plan" });
    });
    ticks(sim, AI_END);
    await user.click(screen.getByRole("link", { name: "AI 활동" }));
    expect(screen.getByRole("heading", { level: 1, name: "AI 활동" })).toBeInTheDocument();
    expect(screen.getAllByText(/샌드박스 리허설/).length).toBeGreaterThan(0);
  });

  it("disables deploy when no environment is selected", async () => {
    const { user } = setup();
    await user.click(screen.getAllByRole("link", { name: "새 앱 배포" })[0]);
    const start = await screen.findByRole("button", { name: "배포 시작" });
    expect(start).toBeEnabled();
    for (const name of ["AWS EKS", "GCP GKE", "온프레미스 k3s"]) await user.click(screen.getByLabelText(name));
    expect(start).toBeDisabled();
  });

  it("reset returns to the initial state", async () => {
    const { sim, user } = setup();
    act(() => sim.dispatch({ type: "onb-skip" }));
    expect(sim.state.apps.shop).toBeDefined();
    await user.click(screen.getByRole("button", { name: "처음 상태로 되돌리기" }));
    expect(sim.state.apps.shop).toBeUndefined();
  });
});

describe("HopCharlie console (platform API)", () => {
  const plan = {
    ref: "pln_1",
    status: "pending_approval",
    revision: 3,
    summary: {
      planId: "shop-eks-to-gke",
      source: { env: "eks", namespace: "shop", cluster: "shop-db-eks", dbHost: "shop-db-eks-rw:5432" },
      target: { env: "gke", namespace: "shop", cluster: "shop-db-gke" },
      files: true,
      gatewayMode: "http",
      fenceGate: true,
      maxDowntime: "30s",
    },
    submittedBy: "operator",
    submittedAt: "2026-11-06T01:00:00Z",
  };

  function route(calls: () => FakeCall[]) {
    return (c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/apps") return json(200, { apps: [{ name: "shop", namespace: "shop", database: { name: "app", user: "app", schemas: [] }, environments: [{ env: "eks", cnpgCluster: "shop-db-eks", dbHost: "a" }, { env: "gke", cnpgCluster: "shop-db-gke", dbHost: "b" }] }] });
      if (u.pathname === "/v1/plans") return json(200, { plans: calls().some((x) => x.url.includes("/approve")) ? [{ ...plan, status: "started" }] : [plan] });
      if (u.pathname === "/v1/migrations" && c.method === "GET") return json(200, { runs: [] });
      if (u.pathname === "/v1/agent/sessions") return json(200, { sessions: [] });
      if (u.pathname === "/v1/plans/pln_1/approve") return json(200, { ...plan, status: "approved" });
      if (u.pathname === "/v1/migrations" && c.method === "POST") return json(202, { runId: "run_1", planRef: "pln_1", links: { self: "", events: "" } });
      if (u.pathname.startsWith("/v1/migrations/run_1/events")) return new Promise<Response>(() => {});
      return json(404, { error: { code: "not_found", message: "no" } });
    };
  }

  it("approves the revision on screen and starts with a read canary", async () => {
    let calls: FakeCall[] = [];
    calls = installFetch(route(() => calls));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "API 연결" }));
    await user.type(screen.getByLabelText(/토큰/), "test-token");
    await user.click(screen.getByRole("button", { name: "연결" }));
    expect(screen.getByText(/실제 플랫폼 API/)).toBeInTheDocument();

    window.location.hash = "#migrate-shop";
    expect(await screen.findByText(/Plan pln_1 \(revision 3\)을 승인할까요\?/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/migrations"))).toBe(true));
    const approve = calls.find((c) => c.url.includes("/v1/plans/pln_1/approve"))!;
    expect(JSON.parse(approve.body!)).toEqual({ revision: 3 });
    const start = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/migrations"))!;
    expect(JSON.parse(start.body!)).toMatchObject({ planRef: "pln_1", canary: { weights: [10, 50] } });
    expect(start.headers.get("Idempotency-Key")).toBeTruthy();
    expect(approve.headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("makes no API calls in simulation mode", () => {
    const calls = installFetch(() => json(500, {}));
    setup();
    expect(calls).toHaveLength(0);
  });
});
