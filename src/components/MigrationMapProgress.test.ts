import html from "../../public/migration-map-live.html?raw";
import { buildMapSnapshot } from "../data/mapSnapshot";
import type { MigrationView } from "../data/migration";
import { fakeRun } from "../api/fakes";

it("renders actual snapshot transitions as named step states without assuming a percentage", () => {
  const page = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = page.body.innerHTML;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {} }));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  const noop = () => {};
  const v: MigrationView = { live: false, app: "shop", stage: "run", src: "gke", tgt: "eks", srcLabel: "GKE", tgtLabel: "EKS", targets: [], setTarget: noop, ready: true, sessions: [], sessionEvents: () => [], selectSession: noop, events: [], busy: false, notice: "", makePlan: noop, approve: noop, reject: noop, doSwitch: noop, abort: noop, resume: noop, rollback: noop, reset: noop };
  try {
    window.eval(page.querySelector("script")!.textContent!);
    for (const status of ["running", "halted", "rolled_back", "failed", "succeeded"] as const) {
      const r = fakeRun({ status, phase: status === "running" ? "sync" : "done" });
      r.engine.steps = { precheck: { status: "succeeded" }, presync: { status: status === "running" ? "running" : status === "succeeded" ? "succeeded" : "failed" } };
      const snap = buildMapSnapshot({ ...v, run: r }, { now: Date.now() });
      window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window.parent, data: { type: "hc-snapshot", snap } }));
      const summary = document.getElementById("progressSummary")!;
      expect(summary).toHaveAttribute("role", "status");
      expect(summary).toHaveTextContent(snap.progress.label);
      expect(summary).toHaveTextContent(`완료 ${snap.progress.completed}/${snap.progress.total}단계`);
      const steps = document.getElementById("steps")!;
      expect(steps.style.minWidth).toBe("");
      expect(steps.style.gridTemplateColumns).toBe("");
      expect(steps.children).toHaveLength(snap.phases.length);
      expect(steps.children[4].querySelector(".cs")).toHaveTextContent("완료");
      expect(steps.querySelectorAll('[aria-current="step"]')).toHaveLength(status === "succeeded" ? 0 : 1);
      expect(steps.querySelectorAll("li.cur")).toHaveLength(status === "running" ? 1 : 0);
      expect(document.querySelector('[role="progressbar"][aria-valuenow]')).toBeNull();
    }
  } finally {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  }
});
