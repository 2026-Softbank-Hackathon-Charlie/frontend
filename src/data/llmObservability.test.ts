import { hasObservedAI, llmReport, traceUrl } from "./llmObservability";
import type { LLMObservability } from "../api/types";
import type { AIServiceTopology } from "./aiServices";

const now = Date.parse("2026-11-08T01:00:00Z");
const base: LLMObservability = { app: "shop", generatedAt: new Date(now).toISOString(), window: { from: new Date(now-3600000).toISOString(), to: new Date(now).toISOString() }, source: { name: "langfuse", status: "not_configured", reason: "langfuse_not_configured" }, sample: { limit: 100, returned: 0, truncated: false }, summary: null, observations: [] };
it("accepts unavailable data without inventing measurements and rejects another app or malformed reports", () => {
  expect(llmReport(base, "shop", now)).toEqual(base);
  expect(llmReport({ ...base, app: "other" }, "shop", now)).toBeUndefined();
  expect(llmReport({}, "shop", now)).toBeUndefined();
  expect(llmReport({ ...base, source: { name: "hyperdx", status: "observed" } }, "shop", now)).toBeUndefined();
  expect(llmReport({ ...base, source: { ...base.source, status: "observed" } }, "shop", now)).toBeUndefined();
  expect(llmReport({ ...base, generatedAt: new Date(now+60000).toISOString() }, "shop", now)).toBeUndefined();
  expect(llmReport({ ...base, window: { ...base.window, to: new Date(now+60000).toISOString() } }, "shop", now)).toBeUndefined();
});
it("requires observed app calls, not a configured endpoint, to mark an app AI use confirmed", () => {
  const topology: AIServiceTopology = { app: "shop", generatedAt: base.generatedAt, window: base.window, sources: [{ name: "hyperdx", status: "observed", message: "" }], services: [{ id: "call", serviceId: "ai", name: "AI", kind: "unknown", callerEnv: "", location: { accelerator: "unknown" }, activity: { state: "idle", requests: 0, lastSeen: new Date(now-600000).toISOString() }, evidence: [] }] };
  expect(hasObservedAI(topology, "shop", now)).toBe(true);
  expect(hasObservedAI(topology, "other", now)).toBe(false);
  expect(hasObservedAI({ ...topology, sources: [{ name: "hyperdx", status: "unavailable", message: "" }] }, "shop", now)).toBe(false);
  expect(hasObservedAI({ ...topology, services: [{ ...topology.services[0], activity: { state: "unknown" } }] }, "shop", now)).toBe(false);
});
it("accepts only actual safe trace URLs without credentials or authentication parameters", () => {
  expect(traceUrl("https://langfuse.example/project/project-shop/traces/trace-one")).toBeTruthy();
  for (const url of ["javascript:alert(1)", "https://user:secret@langfuse.example/project/p/traces/t", "https://langfuse.example/project/p/traces/t?token=private", "https://langfuse.example/project/other"]) expect(traceUrl(url)).toBe("");
});
