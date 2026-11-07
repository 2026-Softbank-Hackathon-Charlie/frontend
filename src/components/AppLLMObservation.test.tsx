import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetch, json } from "../api/fakes";
import type { LLMObservability } from "../api/types";
import { AppObservationDialog } from "./AppObservation";
import { AppLLMObservation } from "./AppLLMObservation";

const now = Date.now();
const metrics = { inputTokens: null, outputTokens: 4, totalTokens: null, costUsd: null, latencyMillis: 125 };
function report(status: LLMObservability["source"]["status"] = "observed"): LLMObservability {
  return { app: "shop", generatedAt: new Date(now).toISOString(), window: { from: new Date(now-3600000).toISOString(), to: new Date(now).toISOString() }, source: { name: "langfuse", status, reason: status === "observed" ? "bounded_generation_sample" : "langfuse_not_configured", version: "3.133.0" }, sample: { limit: 100, returned: status === "observed" ? 1 : 0, truncated: false }, summary: status === "observed" ? { generations: 1, traces: 1, errors: null, ...metrics } : null, observations: status === "observed" ? [{ id: "generation-one", traceId: "trace-one", startTime: new Date(now-1000).toISOString(), level: null, model: "Qwen", url: "https://langfuse.example/project/project-shop/traces/trace-one", ...metrics }] : [] };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows actual sample metrics with missing values and a safe trace link", () => {
  render(<AppLLMObservation report={report()} loading={false} malformed={false} now={now} reload={() => {}} />);
  const panel = screen.getByRole("region", { name: "Langfuse LLM 관측" });
  expect(within(panel).getAllByText("미측정").length).toBeGreaterThan(0);
  expect(within(panel).getAllByText("125 ms")).toHaveLength(2);
  expect(within(panel).getByRole("link", { name: /Langfuse trace 보기/ })).toHaveAttribute("href", "https://langfuse.example/project/project-shop/traces/trace-one");
  expect(panel).toHaveTextContent("최대 100개 generation의 표본");
});
it("does not display zero metrics for an unconfigured provider and marks retained data stale", () => {
  const view = render(<AppLLMObservation report={report("not_configured")} loading={false} malformed={false} now={now} reload={() => {}} />);
  expect(screen.getByText("미연결")).toBeInTheDocument();
  expect(screen.queryByText("평균 지연")).not.toBeInTheDocument();
  view.rerender(<AppLLMObservation report={report()} loading={false} malformed={false} now={now+90000} error="network" reload={() => {}} />);
  expect(screen.getByText("마지막 수신 결과")).toBeInTheDocument();
});

it("adds LLM beside HyperDX only after actual app AI evidence, and keeps sources independent", async () => {
  let answer!: (r: Response) => void;
  const pending = new Promise<Response>(resolve => { answer = resolve; });
  const calls = installFetch(c => c.url.includes("/llm-observability") ? pending : c.url.includes("/ai-services") ? json(200, { app: "shop", generatedAt: new Date().toISOString(), window: { from: new Date(Date.now()-300000).toISOString(), to: new Date().toISOString() }, sources: [{ name: "hyperdx", status: "unobserved", message: "" }], services: [] }) : c.url.includes("/observability") ? json(200, { since: new Date().toISOString(), total: 0, errors: 0, warnings: 0, buckets: [], services: [], patterns: [] }) : json(200, { deployments: [] }));
  render(<AppObservationDialog app="shop" onClose={() => {}} />);
  const llm = screen.getByRole("button", { name: "Langfuse LLM 관측" });
  expect(llm).toBeDisabled();
  await act(async () => answer(json(200, report())));
  expect(llm).toBeEnabled();
  await userEvent.setup().click(llm);
  expect(screen.getByRole("region", { name: "Langfuse LLM 관측" })).toHaveTextContent("Trace / generation");
  expect(calls.some(c => c.url === "/v1/apps/shop/llm-observability?minutes=60")).toBe(true);
  expect(calls.every(c => c.method === "GET")).toBe(true);
  await userEvent.setup().click(screen.getByRole("button", { name: "HyperDX 분석" }));
  expect(screen.queryByRole("region", { name: "Langfuse LLM 관측" })).not.toBeInTheDocument();
});

it("allows an app with observed AI calls to see the real unconfigured Langfuse state", async () => {
  installFetch(c => c.url.includes("/llm-observability") ? json(200, report("not_configured")) : c.url.includes("/ai-services") ? json(200, { app: "shop", generatedAt: new Date(now).toISOString(), window: { from: new Date(now-300000).toISOString(), to: new Date(now).toISOString() }, sources: [{ name: "hyperdx", status: "observed", message: "" }], services: [{ id: "call", serviceId: "ai", name: "AI", kind: "unknown", callerEnv: "", location: { accelerator: "unknown" }, activity: { state: "active", requests: 1, lastSeen: new Date(now-1000).toISOString() }, evidence: [] }] }) : c.url.includes("/observability") ? json(200, { since: new Date(now).toISOString(), total: 0, errors: 0, warnings: 0, buckets: [], services: [], patterns: [] }) : json(200, { deployments: [] }));
  render(<AppObservationDialog app="shop" onClose={() => {}} />);
  const button = await screen.findByRole("button", { name: "Langfuse LLM 관측" });
  await vi.waitFor(() => expect(button).toBeEnabled());
  await userEvent.setup().click(button);
  const panel = screen.getByRole("region", { name: "Langfuse LLM 관측" });
  expect(panel).toHaveTextContent("이 서버에 Langfuse 조회 연결이 설정되지 않았습니다.");
  expect(within(panel).queryByText("Trace / generation")).not.toBeInTheDocument();
});

it("does not activate LLM observations from a different app's report", async () => {
  installFetch(c => c.url.includes("/llm-observability") ? json(200, { ...report(), app: "other" }) : c.url.includes("/ai-services") ? json(200, { app: "shop", generatedAt: new Date(now).toISOString(), window: { from: new Date(now-300000).toISOString(), to: new Date(now).toISOString() }, sources: [{ name: "hyperdx", status: "unobserved", message: "" }], services: [] }) : c.url.includes("/observability") ? json(200, { since: new Date(now).toISOString(), total: 0, errors: 0, warnings: 0, buckets: [], services: [], patterns: [] }) : json(200, { deployments: [] }));
  render(<AppObservationDialog app="shop" onClose={() => {}} />);
  await screen.findByText(/LLM 응답 형식 미확인/);
  expect(screen.getByRole("button", { name: "Langfuse LLM 관측" })).toBeDisabled();
  expect(screen.queryByText("trace-one")).not.toBeInTheDocument();
});
