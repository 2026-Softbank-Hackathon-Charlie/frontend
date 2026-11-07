import { cleanup, render, screen, within } from "@testing-library/react";
import { fakeSession, installFetch, json } from "../api/fakes";
import type { App } from "../api/types";
import { chooseMode, initAuth, startSession } from "../data/live";
import { MigrateList } from "./Migrate";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); initAuth(); });

it("lists every migration candidate and does not copy the selected app's plan or location to other apps", async () => {
  const databaseApp: App = {
    name: "moimroom-mig", namespace: "moimroom-mig",
    database: { name: "app", user: "app", schemas: [] },
    environments: ["gke", "eks"].map((env) => ({ env, cnpgCluster: "db", dbHost: "db-" + env })),
  };
  const doom: App = {
    ...databaseApp, name: "docker-doom", namespace: "docker-doom", environments: [],
    deploy: { repo: "org/docker-doom", branch: "main", environments: ["eks"], autoDeploy: false,
      spec: { name: "docker-doom", services: [{ name: "web", path: ".", dockerfile: "Dockerfile", port: 8080, public: true, replicas: 1 }], resources: [] },
      specCommit: "abc", createdAt: "2026-11-07T12:00:00Z", createdBy: "operator", status: [], instances: [] },
  };
  installFetch((call) => {
    const path = new URL(call.url, "https://test.invalid").pathname;
    if (path === "/v1/apps") return json(200, { apps: [databaseApp, doom] });
    if (path === "/v1/plans") return json(200, { plans: [{ ref: "pln_doom", status: "pending_approval", revision: 1,
      submittedBy: "operator", submittedAt: "2026-11-07T12:00:00Z",
      summary: { planId: "doom-move", source: { env: "eks", namespace: "docker-doom", cluster: "" },
        target: { env: "gke", namespace: "docker-doom", cluster: "" }, files: false, gatewayMode: "http", fenceGate: false, maxDowntime: "30s" } }] });
    if (path === "/v1/migrations" || path === "/v1/ai-runs") return json(200, { runs: [] });
    if (path === "/v1/agent/sessions") return json(200, { sessions: [] });
    if (path === "/v1/audit") return json(200, { entries: [] });
    if (path === "/v1/envs") return json(200, { environments: [] });
    return json(404, { error: { code: "not_found", message: "not configured in fixture" } });
  });
  chooseMode("live"); startSession(fakeSession());
  window.location.hash = "#migrate";
  render(<MigrateList />);
  const first = (await screen.findByText("moimroom-mig", { selector: "b" })).closest("tr") as HTMLElement;
  const selected = (await screen.findByText("docker-doom", { selector: "b" })).closest("tr") as HTMLElement;
  expect(within(first).getByText("미확인")).toBeInTheDocument();
  expect(within(first).getByText("상태 미조회")).toBeInTheDocument();
  expect(within(first).queryByText("승인 대기")).not.toBeInTheDocument();
  expect(within(first).getByRole("link")).toHaveAttribute("href", "#migrate-app?app=moimroom-mig");
  expect(within(selected).getByText("승인 대기")).toBeInTheDocument();
  expect(within(selected).getByRole("link")).toHaveAttribute("href", "#migrate-app?app=docker-doom");
});
