import { render, screen, within } from "@testing-library/react";
import { fakeDeployment, fakeRun, fakeSession, installFetch, json } from "../api/fakes";
import type { App as ApiApp } from "../api/types";
import { App } from "../App";
import { initAuth } from "../data/live";
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
    expect(within(now).getByText("GCP GKE에서 온프레미스 k3s로, 카나리 중")).toBeInTheDocument();
    expect(within(now).queryByText("shop 이전을 마쳤습니다")).not.toBeInTheDocument();
    expect(within(now).getByText("1건")).toBeInTheDocument();
  });
});
