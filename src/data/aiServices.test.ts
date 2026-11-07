import { describe, expect, it } from "vitest";
import { aiServiceMap, isAIServiceTopology, type AIServiceTopology } from "./aiServices";

const now = Date.parse("2026-11-08T00:00:00Z");
function report(): AIServiceTopology {
  return { app: "shop", generatedAt: new Date(now).toISOString(), window: { from: new Date(now - 300000).toISOString(), to: new Date(now).toISOString() }, sources: [{ name: "hyperdx", status: "observed", message: "" }], services: [
    { id: "local-route", serviceId: "local", name: "local model", kind: "self_hosted", callerEnv: "gke", location: { environment: "onprem", accelerator: "gpu" }, activity: { state: "active", requests: 2, lastSeen: new Date(now - 10000).toISOString() }, evidence: [{ source: "hyperdx", observedAt: new Date(now).toISOString(), detail: "observed deployment" }] },
    { id: "bedrock-route", serviceId: "bedrock", name: "Bedrock", kind: "managed", callerEnv: "onprem", location: { provider: "aws", accelerator: "unknown" }, activity: { state: "active", requests: 1, lastSeen: new Date(now).toISOString() }, evidence: [] },
    { id: "claude-route", serviceId: "claude", name: "Claude", kind: "external", callerEnv: "eks", location: { provider: "anthropic", accelerator: "unknown" }, activity: { state: "idle", requests: 0 }, evidence: [] },
  ] };
}
describe("observed app AI topology", () => {
  it("rejects malformed responses and retains unknown instead of manufacturing zero", () => {
    expect(isAIServiceTopology({ app: "shop", services: [] })).toBe(false);
    const invalid = { ...report(), services: [{ ...report().services[0], location: null }] };
    expect(isAIServiceTopology(invalid)).toBe(false);
    expect(aiServiceMap(invalid as unknown as AIServiceTopology, "shop", now).nodes).toEqual([]);
  });
  it("places the model host independently of its caller and distinguishes managed AI from GPU", () => {
    const map = aiServiceMap(report(), "shop", now);
    expect(map.nodes.map(n => [n.serviceId, n.lane, n.icon])).toEqual([["local", "onprem", "gpu"], ["bedrock", "aws", "managed"], ["claude", "external", "external"]]);
    expect(map.edges.map(e => [e.caller, e.active])).toEqual([["gcp", true], ["onprem", true], ["aws", false]]);
  });
  it("does not animate stale reports, future calls, explicit idle, zero counts or missing telemetry", () => {
    const r = report();
    expect(aiServiceMap(r, "shop", now + 600000).edges.every(e => !e.active)).toBe(true);
    r.services[0].activity.lastSeen = new Date(now + 1).toISOString();
    r.services[1].activity.requests = 0;
    expect(aiServiceMap(r, "shop", now).edges.every(e => !e.active)).toBe(true);
    expect(aiServiceMap(undefined, "shop", now).status).toBe("unobserved");
    expect(aiServiceMap(r, "shop", now, true).edges.every(e => !e.active)).toBe(true);
    const unavailable = report(); unavailable.sources[0].status = "unavailable";
    expect(aiServiceMap(unavailable, "shop", now).edges.every(e => !e.active)).toBe(true);
  });
  it("never borrows another app's observations or places an unknown host inside the caller's cloud", () => {
    expect(aiServiceMap(report(), "other", now).nodes).toEqual([]);
    const r = report(); r.services[0].location = { accelerator: "unknown" };
    expect(aiServiceMap(r, "shop", now).nodes[0]).toMatchObject({ lane: "unknown", icon: "unknown" });
  });
  it("deduplicates physical hosts while preserving both real caller paths", () => {
    const r = report(); r.services.push({ ...r.services[0], id: "second-caller", callerEnv: "eks", evidence: [{ source: "metadata", observedAt: new Date(now).toISOString(), detail: "explicit placement" }] });
    const m = aiServiceMap(r, "shop", now);
    expect(m.nodes).toHaveLength(3);
    expect(m.edges).toHaveLength(4);
    expect(m.nodes[0].evidence).toHaveLength(2);
  });
});
