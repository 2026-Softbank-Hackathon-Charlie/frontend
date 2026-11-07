import { cleanup, render, renderHook, screen, within } from "@testing-library/react";
import { fakeSession, installFetch, json } from "../api/fakes";
import { useSimApp } from "../data/deploy";
import { chooseMode, initAuth, startSession } from "../data/live";
import { createSim, SimProvider } from "../sim/store";
import { AppDetail } from "./Apps";

afterEach(() => {
  cleanup();
  localStorage.clear();
  initAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fileSim() {
  const sim = createSim();
  sim.dispatch({ type: "onb-skip" });
  return sim;
}

describe("app detail mode parity", () => {
  it("uses the API file-app view for an imported demo app without inventing deploy tabs", () => {
    chooseMode("demo");
    render(<SimProvider sim={fileSim()} intervalMs={0}><AppDetail id="moimroom" /></SimProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "moimroom" })).toBeInTheDocument();
    expect(screen.getByText("PLATFORM_APPS_FILE에 있는 앱입니다. 클러스터 사이로 이전할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "이전 설정" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이전 준비" })).toHaveAttribute("href", "#migrate-app?app=moimroom");
    expect(screen.queryByRole("navigation", { name: "앱 정보" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기본 브랜치 다시 배포" })).not.toBeInTheDocument();
    expect(screen.getByText("https://moimroom.hopcharlie.dev")).toBeInTheDocument();
    expect(screen.getByText("Pod 2/2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "리소스" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "변경 이력" })).toBeInTheDocument();
  });

  it("keeps a registered demo app's shared instance and secrets tabs", () => {
    chooseMode("demo");
    render(<SimProvider sim={createSim()} intervalMs={0}><AppDetail id="todo-api" tab="instances" /></SimProvider>);
    const tabs = screen.getByRole("navigation", { name: "앱 정보" });
    expect(within(tabs).getByRole("link", { name: /^인스턴스/ })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "시크릿" })).toHaveAttribute("href", "#app-todo-api/secrets");
    expect(screen.getByRole("heading", { name: "브랜치별 인스턴스" })).toBeInTheDocument();
  });

  it("exposes the imported app through the simulation model but refuses registration-only actions", async () => {
    const sim = fileSim();
    const { result } = renderHook(() => useSimApp("moimroom"), {
      wrapper: ({ children }) => <SimProvider sim={sim} intervalMs={0}>{children}</SimProvider>,
    });
    expect(result.current.app?.name).toBe("moimroom");
    expect(result.current.app?.deploy).toBeUndefined();
    expect(result.current.app?.environments[0].env).toBe("eks");
    expect(result.current.instances).toEqual([]);
    expect(result.current.notFound).toBe(false);
    expect(await result.current.redeploy()).toEqual({ error: expect.stringContaining("PLATFORM_APPS_FILE") });
    expect(await result.current.remove()).toContain("PLATFORM_APPS_FILE");
    expect(sim.state.apps.moimroom).toBeDefined();
  });

  it("keeps the live file-app contract and never uses simulation resources", async () => {
    startSession(fakeSession());
    const calls = installFetch((call) => {
      const url = new URL(call.url, "http://test");
      if (url.pathname === "/v1/apps/moimroom") return json(200, {
        name: "moimroom", namespace: "moimroom", database: { name: "app", user: "app", schemas: [] },
        environments: [{ env: "gke", cnpgCluster: "live-db", dbHost: "live-db-rw:5432", bucket: "live-files" }],
      });
      if (url.pathname === "/v1/apps/moimroom/deployments") return json(200, { deployments: [] });
      return json(404, { error: { code: "not_found", message: "unexpected test endpoint" } });
    });
    render(<SimProvider sim={fileSim()} intervalMs={0}><AppDetail id="moimroom" /></SimProvider>);
    expect(await screen.findByText("live-db-rw:5432")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "이전 설정" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "앱 정보" })).not.toBeInTheDocument();
    expect(screen.queryByText("https://moimroom.hopcharlie.dev")).not.toBeInTheDocument();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.url.includes("/secrets"))).toBe(false);
  });
});
