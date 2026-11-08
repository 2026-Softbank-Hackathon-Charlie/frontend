import html from "../../public/migration-map-live.html?raw";
import { buildMapSnapshot } from "./mapSnapshot";
import type { MigrationView } from "./migration";
import type { AIServiceTopology } from "./aiServices";

const now = Date.parse("2026-11-08T00:00:00Z");
const noop = () => {};
function view(): MigrationView { return { live: true, app: "shop", stage: "setup", src: "gke", tgt: "eks", srcLabel: "", tgtLabel: "", targets: [], setTarget: noop, ready: true, sessions: [], sessionEvents: () => [], selectSession: noop, events: [], busy: false, notice: "", makePlan: noop, approve: noop, reject: noop, doSwitch: noop, abort: noop, resume: noop, rollback: noop, reset: noop }; }
function topology(): AIServiceTopology {
  return { app: "shop", generatedAt: new Date(now).toISOString(), window: { from: new Date(now - 300000).toISOString(), to: new Date(now).toISOString() }, sources: [{ name: "hyperdx", status: "observed", message: "" }], services: [
    { id: "a", serviceId: "local", name: "local", kind: "self_hosted", callerEnv: "gke", location: { environment: "onprem", accelerator: "gpu" }, activity: { state: "active", requests: 1, lastSeen: new Date(now).toISOString() }, evidence: [] },
    { id: "b", serviceId: "managed", name: "Bedrock", kind: "managed", callerEnv: "onprem", location: { provider: "aws", accelerator: "unknown" }, activity: { state: "active", requests: 1, lastSeen: new Date(now).toISOString() }, evidence: [] },
    { id: "c", serviceId: "outside", name: "<img src=x onerror=alert(1)>", kind: "external", callerEnv: "eks", location: { accelerator: "unknown" }, activity: { state: "idle", requests: 0 }, evidence: [] },
  ] };
}
function renderer(reduced = false) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const script = doc.querySelector("script:not([src])")!.textContent!;
  document.body.replaceChildren(...doc.body.childNodes);
  const frames: FrameRequestCallback[] = [];
  let receive: ((event: MessageEvent) => void) | undefined;
  vi.spyOn(window, "addEventListener").mockImplementation((type, fn) => { if (type === "message") receive = fn as (e: MessageEvent) => void; });
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return 1; });
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: noop }));
  Object.defineProperty(SVGElement.prototype, "getTotalLength", { configurable: true, value: () => 800 });
  Object.defineProperty(SVGElement.prototype, "getPointAtLength", { configurable: true, value: () => ({ x: 200, y: 200 }) });
  localStorage.removeItem("hc.motion");
  window.eval(script);
  return {
    send: (r: AIServiceTopology, error = false) => receive!(new MessageEvent("message", { origin: location.origin, source: window, data: { type: "hc-snapshot", snap: buildMapSnapshot(view(), { now, aiServices: r, aiServicesError: error }) } })),
    tick: () => { let at = performance.now() + 1000; for (let i = 0; i < 20; i++) frames.shift()!(at += 100); },
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
describe("actual SVG AI service renderer (DOM unit verification)", () => {
  it("puts GPU in onprem, managed cloud in AWS and external API outside, with safe text", () => {
    const r = renderer(); r.send(topology());
    const local = document.querySelector('[data-ai-service="local"]')!;
    expect(local.getAttribute("data-ai-icon")).toBe("gpu");
    expect(Number(local.querySelector("rect")!.getAttribute("y"))).toBeGreaterThan(338);
    const managed = document.querySelector('[data-ai-service="managed"]')!;
    expect(managed.getAttribute("data-ai-icon")).toBe("managed");
    expect(Number(managed.querySelector("rect")!.getAttribute("y"))).toBeLessThan(162);
    const outside = document.querySelector('[data-ai-service="outside"]')!;
    expect(Number(outside.querySelector("rect")!.getAttribute("y"))).toBeGreaterThan(462);
    expect(outside.querySelector("img")).toBeNull();
    expect(document.querySelectorAll('[data-app-ai-route][data-active="true"]')).toHaveLength(2);
  });
  it("removes in-flight AI rabbits when telemetry fails and honors reduced motion", () => {
    const r = renderer(); r.send(topology()); r.tick();
    expect([...document.querySelectorAll<SVGElement>('#gParticles > g')].some(g => g.style.display !== "none")).toBe(true);
    r.send(topology(), true);
    expect([...document.querySelectorAll<SVGElement>('#gParticles > g')].every(g => g.style.display === "none")).toBe(true);
    r.send(topology()); r.tick();
    r.send({ ...topology(), services: [] });
    expect([...document.querySelectorAll<SVGElement>('#gParticles > g')].every(g => g.style.display === "none")).toBe(true);
    const quiet = renderer(true); quiet.send(topology()); quiet.tick();
    expect(document.querySelectorAll('#gParticles > g')).toHaveLength(0);
  });
  it("bounds visual overflow and retains every model in the evidence list", () => {
    const r = renderer(); const data = topology();
    for (let i = 0; i < 8; i++) data.services.push({ ...data.services[0], id: "more" + i, serviceId: "more" + i, name: "model " + i });
    r.send(data);
    expect(document.querySelectorAll('[data-ai-icon="gpu"]')).toHaveLength(3);
    expect(document.querySelector('[data-ai-service="group:onprem"]')).not.toBeNull();
    expect(document.querySelector('#appAIList')!.children).toHaveLength(11);
  });
  it("widens the map only when a card needs the extra width", () => {
    const r = renderer(); const data = topology();
    const map = document.getElementById("map")!;
    const width = () => [map.getAttribute("viewBox")!.split(" ")[2], map.style.minWidth, document.querySelector(".lane-box")!.getAttribute("width")];
    const unplaced = (n: number) => Array.from({ length: n }, (_, i) => ({ ...data.services[0], id: "u" + i, serviceId: "u" + i, location: { accelerator: "unknown" as const } }));
    r.send({ ...data, services: unplaced(1) });
    expect(document.querySelector('[data-ai-service="u0"]')).not.toBeNull();
    expect(width()).toEqual(["1020", "760px", "720"]);
    r.send({ ...data, services: unplaced(3) });
    expect(width()).toEqual(["1420", "1060px", "1110"]);
    r.send(data);
    expect(width()).toEqual(["1420", "1060px", "1110"]);
  });
});
