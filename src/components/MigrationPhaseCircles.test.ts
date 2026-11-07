import html from "../../public/migration-map-live.html?raw";
import { fakeRun } from "../api/fakes";
import { buildMapSnapshot, type MapSnapshot } from "../data/mapSnapshot";
import type { MigrationView } from "../data/migration";

const noop = () => {};
function snapshot(status: "running" | "awaiting_switch" | "halted" | "succeeded" = "running", stale = false) {
  const run = fakeRun({ status, phase: status === "running" ? "sync" : status === "awaiting_switch" ? "awaiting_switch" : "done" });
  run.engine.steps = { precheck: { status: "succeeded" }, prepare: { status: "succeeded" }, presync: { status: status === "running" ? "running" : status === "halted" ? "failed" : "succeeded" } };
  const view: MigrationView = { live: true, app: "shop", stage: "run", src: "gke", tgt: "eks", srcLabel: "GKE", tgtLabel: "EKS", targets: [], setTarget: noop, ready: true,
    sessions: [], sessionEvents: () => [], selectSession: noop, events: [], busy: false, notice: "", makePlan: noop, approve: noop, reject: noop, doSwitch: noop, abort: noop, resume: noop, rollback: noop, reset: noop,
    run, stream: { connected: !stale, error: stale ? "offline" : undefined } };
  return buildMapSnapshot(view, { now: Date.now() });
}
function renderer(reduced = false) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = doc.body.innerHTML;
  let receive: ((event: MessageEvent) => void) | undefined;
  vi.spyOn(window, "addEventListener").mockImplementation((type, callback) => { if (type === "message") receive = callback as typeof receive; });
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: noop }));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  localStorage.removeItem("hc.motion"); localStorage.removeItem("hc.stepView");
  window.eval(doc.querySelector("script")!.textContent!);
  return (snap: MapSnapshot) => receive!(new MessageEvent("message", { origin: location.origin, source: window.parent, data: { type: "hc-snapshot", snap } }));
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("renders each major group as a connected circle with its real internal step below", () => {
  const send = renderer(), snap = snapshot(); send(snap);
  const groups = [...new Set(snap.phases.map(phase => phase.group))];
  expect(document.querySelectorAll("#stepsSimple .phase-circle")).toHaveLength(groups.length);
  expect(document.querySelectorAll("#stepsSimple .phase-arrow")).toHaveLength(groups.length - 1);
  const current = document.querySelector('#stepsSimple [aria-current="step"]')!;
  expect(current.querySelector(".phase-label")).toHaveTextContent(snap.phases[snap.cur].group);
  expect(current.querySelector(".cs")).toHaveTextContent(snap.phases[snap.cur].label);
  expect(current).toHaveClass("is-live");
  expect(document.getElementById("kWeights")).toHaveTextContent(snap.kpi.weights);
  expect(document.getElementById("kSync")).toHaveTextContent(snap.kpi.sync[0]);
  expect(document.querySelector('[role="progressbar"][aria-valuenow]')).toBeNull();
});

it("does not pulse a halted, completed or disconnected last-known position", () => {
  const send = renderer();
  for (const snap of [snapshot("halted"), snapshot("succeeded"), snapshot("running", true)]) {
    send(snap);
    expect(document.querySelectorAll("#stepsSimple .is-live")).toHaveLength(0);
    expect(document.getElementById("progressSummary")).toHaveTextContent(snap.progress.label);
  }
});

it("names a real approval wait below its major circle", () => {
  const send = renderer(), snap = snapshot("awaiting_switch"); send(snap);
  const current = document.querySelector('#stepsSimple [aria-current="step"]')!;
  expect(current).toHaveClass("wait", "is-live");
  expect(current.querySelector(".cs")).toHaveTextContent("전환 승인");
  expect(current.querySelector(".phase-status")).toHaveTextContent("대기");
});

it("keeps the major circles visible with detailed checks and respects reduced motion", () => {
  const send = renderer(true); send(snapshot());
  (document.querySelector('[data-view="detail"]') as HTMLButtonElement).click();
  expect(document.getElementById("stepsSimple")).not.toHaveAttribute("hidden");
  expect(document.getElementById("validations")).not.toHaveAttribute("hidden");
  expect(document.documentElement).toHaveClass("motion-off");
  expect(html).toMatch(/:root\.motion-off[^}]*\.phase-circle[^}]*animation:none/);
});
