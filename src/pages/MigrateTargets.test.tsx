import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeSession, installFetch, json } from "../api/fakes";
import type { App, Environment, PlanRecord } from "../api/types";
import { chooseMode, initAuth, startSession } from "../data/live";
import { useLiveMigration } from "../data/migration";
import { enginePlan } from "../sim/mig";
import { Migrate } from "./Migrate";
import { AppDetail } from "./Apps";
import { AppsList } from "../components/deploy";

function app(registered = false): App {
  return { name: "moimroom-mig", namespace: "moimroom-mig", database: { name: "app", user: "app", schemas: [] },
    environments: ["gke", "eks", ...(registered ? ["onprem"] : [])].map((env) => ({ env, cnpgCluster: "moimroom-mig-db", dbHost: "db-" + env })),
    deploy: { repo: "org/moimroom-mig", branch: "main", environments: ["gke", "eks"], autoDeploy: false, spec: { name: "moimroom-mig", services: [], resources: [] }, specCommit: "abc", createdAt: new Date().toISOString(), createdBy: "operator", status: [], instances: [] },
  };
}
const environments: Environment[] = [
  { name: "gke", displayName: "GCP 서울", provider: "gcp" },
  { name: "eks", displayName: "AWS 서울", provider: "aws" },
  { name: "onprem", displayName: "내 노트북 k3s", provider: "onprem" },
].map((e) => ({ ...e, kubeContext: e.name, gatewayBackend: e.name, live: e.name === "eks", status: { reachable: true, checkedAt: "2026-11-07T12:00:00Z" } })) as Environment[];

function stateless(name = "docker-doom", envs = ["eks", "gke"]): App {
  const value = app();
  return { ...value, name, namespace: name, environments: [], deploy: { ...value.deploy!, environments: envs, spec: { name, services: [{ name: "web", path: ".", dockerfile: "Dockerfile", port: 8080, public: true, replicas: 1 }], resources: [] } } };
}

function setup(registered = false, envs: Environment[] | null = environments, view = true, application = app(registered), writeBackend: string | null = "eks") {
  let savedPlan: PlanRecord | undefined;
  const calls = installFetch((c) => {
    const path = new URL(c.url, "https://test.invalid").pathname;
    if (path === "/v1/apps") return json(200, { apps: [application] });
    if (path === "/v1/apps/" + application.name) return json(200, application);
    if (path === "/v1/envs") return envs ? json(200, { environments: envs }) : json(502, { error: { code: "upstream_unavailable", message: "environment list unavailable" } });
    if (path === "/v1/traffic") return writeBackend ? json(200, { writeBackend, readWeights: { [writeBackend]: 100 }, writesHeld: false, heldWrites: 0, maxHold: "30s", inFlight: { reads: 0, writes: 0 }, updatedAt: new Date().toISOString(), backends: [], stats: {}, totals: {} }) : json(502, { error: { code: "gateway_unavailable", message: "gateway unavailable" } });
    if (path === "/v1/plans/draft") {
      const draft = enginePlan("aws", "onprem");
      const request = JSON.parse(c.body!);
      if (!application.environments.length && !application.deploy?.spec.resources?.some((r) => r.type === "postgres")) return json(200, { ...draft, source: { kind: "none", env: request.source }, target: { kind: "none", env: request.target } });
      return json(200, draft);
    }
    if (path === "/v1/plans" && c.method === "POST") {
      savedPlan = { ref: "pln_onprem", status: "pending_approval", revision: 1, submittedBy: "operator", submittedAt: new Date().toISOString(), summary: { planId: "move-onprem", source: { env: "eks", namespace: "moimroom-mig", cluster: "db" }, target: { env: "onprem", namespace: "moimroom-mig", cluster: "db" }, files: false, gatewayMode: "http", fenceGate: true, maxDowntime: "30s" } };
      return json(201, savedPlan);
    }
    if (path === "/v1/plans") return json(200, { plans: savedPlan ? [savedPlan] : [] });
    if (path === "/v1/migrations") return json(200, { runs: [] });
    if (path === "/v1/agent/sessions") return json(200, { sessions: [] });
    if (path === "/v1/ai-runs") return json(200, { runs: [] });
    if (path === "/v1/audit") return json(200, { entries: [] });
    return json(404, { error: { code: "not_found", message: "not configured in fixture" } });
  });
  chooseMode("live"); startSession(fakeSession());
  window.location.hash = "#migrate-app?app=" + application.name;
  if (view) render(<Migrate />);
  return { calls, user: userEvent.setup() };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); initAuth(); });

it("shows a real platform onprem candidate even before the app has it, without allowing migration", async () => {
  const { calls, user } = setup();
  const option = await screen.findByRole("option", { name: /내 노트북 k3s/ });
  expect(option).toHaveTextContent("앱 환경 추가 필요");
  await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "onprem");
  expect(await screen.findByText(/이 앱에 등록되지 않은 환경/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "앱 환경 추가 화면 열기" })).toHaveAttribute("href", "#app-moimroom-mig");
  expect(screen.getByRole("button", { name: "AI 계획·리허설 실행" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeDisabled();
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});

it("allows an already registered onprem environment to create a plan through the existing API", async () => {
  const { calls, user } = setup(true);
  await screen.findByRole("option", { name: "내 노트북 k3s" });
  await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "onprem");
  await waitFor(() => expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "AI 없이 Plan 작성" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/v1/plans/draft"))).toBe(true));
  const request = calls.find((c) => c.method === "POST" && c.url.includes("/v1/plans/draft"))!;
  expect(JSON.parse(request.body!)).toEqual({ app: "moimroom-mig", source: "eks", target: "onprem" });
  expect(await screen.findByRole("button", { name: "승인하고 시작" })).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST" && c.url.includes("/environments"))).toBe(false);
});

it("shows unreachable observations without presenting them as a healthy deployment target", async () => {
  const unreachable = environments.map((e) => e.name === "onprem" ? { ...e, status: { reachable: false, checkedAt: "2026-11-07T12:00:00Z", error: "API timeout" } } : e);
  const { user } = setup(false, unreachable);
  await screen.findByRole("option", { name: /내 노트북 k3s/ });
  await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "onprem");
  expect(await screen.findByText(/연결 안 됨/)).toBeInTheDocument();
  expect(screen.getByText("API timeout")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeDisabled();
});

it("keeps registered choices when the global environment list fails and reports the missing discovery", async () => {
  setup(false, null);
  expect(await screen.findByRole("option", { name: "GCP GKE" })).toBeInTheDocument();
  expect(await screen.findByText(/전체 환경 목록을 읽지 못했습니다/)).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /내 노트북 k3s/ })).not.toBeInTheDocument();
});

it("also guards the plan and AI handlers against an unregistered selected target", async () => {
  const { calls } = setup(false, environments, false);
  const { result } = renderHook(() => useLiveMigration());
  await waitFor(() => expect(result.current.targets.some((e) => e.value === "onprem")).toBe(true));
  act(() => result.current.setTarget("onprem"));
  await waitFor(() => expect(result.current.tgt).toBe("onprem"));
  await act(async () => { result.current.makePlan(); });
  await waitFor(() => expect(result.current.notice).toContain("앱에 먼저 추가"));
  await act(async () => { result.current.aiRun?.start(); });
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});

it("discovers non-cloud targets by server ID instead of a hardcoded provider list", async () => {
  const custom = { ...environments[2], name: "edge-gpu-02", displayName: "GPU 실험실" };
  const { user } = setup(false, [...environments, custom]);
  await screen.findByRole("option", { name: /GPU 실험실/ });
  await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "edge-gpu-02");
  expect(await screen.findByText(/이 앱에 등록되지 않은 환경/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeDisabled();
});

it("lets a database-free registered app plan from deployment members and its observed gateway source", async () => {
  const { calls, user } = setup(false, environments, true, stateless());
  expect(await screen.findByRole("heading", { name: "docker-doom 이전" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("원본")).toHaveValue("AWS EKS (지금 쓰기를 받는 곳)"));
  expect(screen.getByLabelText("옮겨 갈 환경")).toHaveValue("gke");
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "AI 없이 Plan 작성" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/v1/plans/draft"))).toBe(true));
  const draft = calls.find((c) => c.method === "POST" && c.url.includes("/v1/plans/draft"))!;
  expect(JSON.parse(draft.body!)).toEqual({ app: "docker-doom", source: "eks", target: "gke" });
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && new URL(c.url, "https://test.invalid").pathname === "/v1/plans")).toBe(true));
  const submitted = calls.find((c) => c.method === "POST" && new URL(c.url, "https://test.invalid").pathname === "/v1/plans")!;
  expect(JSON.parse(submitted.body!).source).toEqual({ kind: "none", env: "eks" });
  expect(JSON.parse(submitted.body!).target).toEqual({ kind: "none", env: "gke" });
});

it("does not guess the source of a database-free app when its gateway cannot be observed", async () => {
  const { calls } = setup(false, environments, true, stateless(), null);
  await screen.findByRole("heading", { name: "docker-doom 이전" });
  expect(await screen.findByText(/원본을 추정하지 않으며/)).toBeInTheDocument();
  expect(screen.getByLabelText("원본")).toHaveValue("미확인");
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeDisabled();
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});

it("opens preparation for a single-environment app instead of silently selecting another app", async () => {
  const { calls } = setup(false, environments, true, stateless("hello-onprem", ["onprem"]), "onprem");
  expect(await screen.findByRole("heading", { name: "hello-onprem 이전" })).toBeInTheDocument();
  expect(await screen.findByText(/이전할 환경이 두 곳 이상 필요/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeDisabled();
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});

it("does not treat a postgres app's deployment environment as proof that its database can migrate", async () => {
  const postgres = stateless("pxls", ["eks"]);
  postgres.deploy!.spec.resources = [{ name: "db", type: "postgres" }];
  setup(false, environments, true, postgres);
  expect(await screen.findByRole("heading", { name: "pxls 이전" })).toBeInTheDocument();
  expect(await screen.findByText(/이전할 환경이 두 곳 이상 필요/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeDisabled();
});

it("still requires database endpoints when a postgres app was deployed into two environments", async () => {
  const postgres = stateless("pxls", ["eks", "gke"]);
  postgres.deploy!.spec.resources = [{ name: "db", type: "postgres" }];
  const { calls } = setup(false, environments, true, postgres);
  expect(await screen.findByRole("heading", { name: "pxls 이전" })).toBeInTheDocument();
  expect(await screen.findByText(/DB 이전 환경 정보가 준비되지 않았습니다/)).toBeInTheDocument();
  expect(screen.getByLabelText("원본")).toHaveValue("미확인");
  expect(screen.getByRole("button", { name: "AI 없이 Plan 작성" })).toBeDisabled();
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});

it("keeps migration entry links for registered apps in the list even without database endpoints", () => {
  const two = stateless(); const one = stateless("hello-onprem", ["onprem"]);
  render(<AppsList apps={[two, one]} now={Date.now()} full />);
  expect(within(screen.getByRole("row", { name: /docker-doom/ })).getByRole("link", { name: "이전" })).toHaveAttribute("href", "#migrate-app?app=docker-doom");
  expect(within(screen.getByRole("row", { name: /hello-onprem/ })).getByRole("link", { name: "이전 준비" })).toHaveAttribute("href", "#migrate-app?app=hello-onprem");
});

it("keeps the registered app detail migration entry when the database endpoint list is empty", async () => {
  const application = stateless(); setup(false, environments, false, application);
  render(<AppDetail id={application.name} />);
  expect(await screen.findByRole("link", { name: "이전" })).toHaveAttribute("href", "#migrate-app?app=docker-doom");
});
