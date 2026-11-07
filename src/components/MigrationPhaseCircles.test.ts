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

it("renders the major title, real internal step and status inside every connected circle", () => {
  const send = renderer(), snap = snapshot(); send(snap);
  const groups = [...new Set(snap.phases.map(phase => phase.group))];
  expect(document.querySelectorAll("#stepsSimple .phase-circle")).toHaveLength(groups.length);
  expect(document.querySelectorAll("#stepsSimple .phase-arrow")).toHaveLength(groups.length - 1);
  for (const item of document.querySelectorAll("#stepsSimple > li")) {
    const circle = item.querySelector(".phase-circle")!;
    expect(circle).toContainElement(item.querySelector(".phase-label"));
    expect(circle).toContainElement(item.querySelector(".cs"));
    expect(circle).toContainElement(item.querySelector(".phase-status"));
    expect(circle).not.toContainElement(item.querySelector(".phase-arrow"));
  }
  const current = document.querySelector('#stepsSimple [aria-current="step"]')!;
  expect(current.querySelector(".phase-label")).toHaveTextContent(snap.phases[snap.cur].group);
  expect(current.querySelector(".cs")).toHaveTextContent(snap.phases[snap.cur].label);
  expect(current.querySelector(".phase-circle")).toHaveTextContent(snap.phases[snap.cur].label);
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

it("names a real approval wait inside its major circle", () => {
  const send = renderer(), snap = snapshot("awaiting_switch"); send(snap);
  const current = document.querySelector('#stepsSimple [aria-current="step"]')!;
  expect(current).toHaveClass("wait", "is-live");
  expect(current.querySelector(".cs")).toHaveTextContent("전환 승인");
  expect(current.querySelector(".phase-status")).toHaveTextContent("대기");
});

it("preserves complete long Japanese labels and status in accessible circle text", () => {
  const send = renderer(), snap = snapshot();
  const label = "移行先のデータベースとストレージの準備状況を確認しています";
  const group = "データ移行と整合性の確認";
  const originalGroup = snap.phases[snap.cur].group;
  for (const phase of snap.phases) if (phase.group === originalGroup) phase.group = group;
  snap.phases[snap.cur].label = label;
  send(snap);
  const current = document.querySelector('#stepsSimple [aria-current="step"]')!;
  const circle = current.querySelector(".phase-circle")!;
  expect(circle).toHaveTextContent(label);
  expect(circle.querySelector(".phase-label")).toHaveTextContent(group);
  expect(current.getAttribute("aria-label")).toContain(label);
  expect(circle.getAttribute("title")).toContain(label);
  expect(html).toMatch(/\.steps\.simple \.phase-circle\{[^}]*width:144px;[^}]*height:144px/);
  expect(html).toMatch(/\.steps\.simple[^}]*-webkit-line-clamp:2/);
});

it("keeps the major circles visible with detailed checks and respects reduced motion", () => {
  const send = renderer(true); send(snapshot());
  (document.querySelector('[data-view="detail"]') as HTMLButtonElement).click();
  expect(document.getElementById("stepsSimple")).not.toHaveAttribute("hidden");
  expect(document.getElementById("validations")).not.toHaveAttribute("hidden");
  expect(document.documentElement).toHaveClass("motion-off");
  expect(html).toMatch(/:root\.motion-off[^}]*\.phase-circle[^}]*animation:none/);
});
