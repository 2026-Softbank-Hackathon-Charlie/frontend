import html from "../../public/migration-map-live.html?raw";
import type { App, PlanRecord, TrafficState } from "../api/types";
import { buildMapSnapshot, type MapSnapshot } from "../data/mapSnapshot";
import type { MigrationView } from "../data/migration";

const noop = () => {};
const app: App = { name: "docker-doom", namespace: "docker-doom", database: { name: "", user: "", schemas: [] }, environments: [],
  deploy: { repo: "org/doom", branch: "main", environments: ["gke", "onprem"], autoDeploy: false, spec: { name: "docker-doom", services: [], resources: [] }, specCommit: "a", createdBy: "test", createdAt: "2026-11-08T00:00:00Z", status: [], instances: [] } };
const view: MigrationView = { live: true, app: "docker-doom", stage: "setup", src: "gke", tgt: "onprem", srcLabel: "", tgtLabel: "", targets: [], setTarget: noop, ready: true,
  sessions: [], sessionEvents: () => [], selectSession: noop, events: [], busy: false, notice: "", makePlan: noop, approve: noop, reject: noop, doSwitch: noop, abort: noop, resume: noop, rollback: noop, reset: noop };
function renderer() {
  const doc = new DOMParser().parseFromString(html, "text/html"); document.body.innerHTML = doc.body.innerHTML;
  let receive: ((event: MessageEvent) => void) | undefined;
  vi.spyOn(window, "addEventListener").mockImplementation((type, callback) => { if (type === "message") receive = callback as typeof receive; });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: noop }));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  window.eval(doc.querySelector("script")!.textContent!);
  return (snap: MapSnapshot) => receive!(new MessageEvent("message", { origin: location.origin, source: window.parent, data: { type: "hc-snapshot", snap } }));
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("removes DB nodes and links for registered DB-free apps while preserving app, files and AI paths", () => {
  const send = renderer();
  const traffic: TrafficState = { writeBackend: "gke", readWeights: { gke: 100, onprem: 0 }, writesHeld: false, heldWrites: 0, maxHold: "30s", inFlight: { reads: 0, writes: 0 }, backends: [], stats: {}, totals: {}, updatedAt: new Date().toISOString() };
  for (const name of ["docker-doom", "hello-onprem"]) {
    const snap = buildMapSnapshot({ ...view, app: name }, { app: { ...app, name }, traffic, now: Date.now() });
    snap.aiServices = { status: "observed", message: "", nodes: [{ serviceId: "local-qwen", name: "Local Qwen", lane: "onprem", icon: "gpu", detail: "GPU evidence", evidence: ["test-only evidence"] }], edges: [{ id: "inference", serviceId: "local-qwen", caller: "gcp", active: true, requests: 4 }] };
    send(snap);
    expect(snap.database).toBe("none");
    expect(Object.keys(snap.nodes).filter(key => key.endsWith(".db"))).toEqual([]);
    expect(document.querySelectorAll('[data-node$=".db"], [data-edge$=".a2d"], .cross')).toHaveLength(0);
    expect(document.querySelector('[data-node="gcp.app"]')).toBeInTheDocument();
    expect(document.querySelector('[data-node="onprem.store"]')).toBeInTheDocument();
    expect(document.querySelector('[data-edge="gcp.c2a"]')).toBeInTheDocument();
    expect(document.querySelector('[data-edge="gcp.c2a"]')).toHaveClass("on");
    expect(document.querySelector('[data-node="hopai"]')).toBeInTheDocument();
    expect(document.querySelector('[data-node="claude"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ai-service="local-qwen"]')).toHaveTextContent("Local Qwen");
    expect(document.querySelector("[data-app-ai-route]")).toBeInTheDocument();
  }
});

it("keeps a file-only data pipe and removes it when the plan explicitly moves no data", () => {
  const send = renderer();
  const endpoint = { kind: "none", env: "gke", namespace: "", cluster: "" };
  const plan: PlanRecord = { ref: "p", status: "approved", revision: 1, submittedBy: "operator", submittedAt: "2026-11-08T00:00:00Z",
    summary: { planId: "p", source: endpoint, target: { ...endpoint, env: "onprem" }, files: true, gatewayMode: "http", fenceGate: false, maxDowntime: "30s" } };
  send(buildMapSnapshot({ ...view, stage: "review", plan }, { now: Date.now() }));
  expect(document.querySelectorAll(".pipe")).toHaveLength(1);
  expect(document.querySelectorAll('[data-node$=".db"]')).toHaveLength(0);
  send(buildMapSnapshot({ ...view, stage: "review", plan: { ...plan, summary: { ...plan.summary, files: false } } }, { now: Date.now() }));
  expect(document.querySelectorAll(".pipe, .cross")).toHaveLength(0);
  expect(document.getElementById("kSync")).toHaveTextContent("해당 없음");
});

it("rebuilds DB components when dependencies become known and retains them when metadata is unavailable", () => {
  const send = renderer();
  send(buildMapSnapshot(view, { app, now: Date.now() }));
  expect(document.querySelectorAll('[data-node$=".db"]')).toHaveLength(0);
  const unknown = buildMapSnapshot(view, { now: Date.now() }); send(unknown);
  expect(unknown.database).toBe("unknown");
  expect(document.querySelectorAll('[data-node$=".db"]')).toHaveLength(3);
  const postgres = { ...app, name: "moimroom-mig", deploy: { ...app.deploy!, spec: { ...app.deploy!.spec, resources: [{ name: "db", type: "postgres" }] } } };
  send(buildMapSnapshot({ ...view, app: "moimroom-mig" }, { app: postgres, now: Date.now() }));
  expect(document.querySelectorAll('[data-node$=".db"], [data-edge$=".a2d"]')).toHaveLength(6);
});
