import { at, fakeAgentSession, fakeRun } from "../api/fakes";
import type { AgentEvent, PlanRecord, Run, RunEvent, TrafficState } from "../api/types";
import { buildMapSnapshot, currentOf } from "./mapSnapshot";
import type { MigrationView } from "./migration";

const noop = () => {};
const plan = (p: Partial<PlanRecord> = {}): PlanRecord =>
  ({
    ref: "pln_1",
    status: "pending_approval",
    revision: 2,
    summary: { planId: "shop", source: { env: "gke", namespace: "shop", cluster: "shop-db" }, target: { env: "eks", namespace: "shop", cluster: "shop-db" }, files: true, gatewayMode: "http", fenceGate: true, maxDowntime: "30s" },
    submittedBy: "operator",
    submittedAt: at(1),
    ...p,
  }) as PlanRecord;

function view(p: Partial<MigrationView> = {}, events: Record<string, AgentEvent[]> = {}): MigrationView {
  return {
    live: true,
    app: "shop",
    stage: "setup",
    src: "gke",
    tgt: "eks",
    srcLabel: "GCP GKE",
    tgtLabel: "AWS EKS",
    targets: [],
    setTarget: noop,
    ready: true,
    sessions: [],
    sessionEvents: (id) => events[id] ?? [],
    selectSession: noop,
    events: [],
    busy: false,
    notice: "",
    makePlan: noop,
    approve: noop,
    reject: noop,
    doSwitch: noop,
    abort: noop,
    resume: noop,
    rollback: noop,
    reset: noop,
    ...p,
  };
}
const run = (p: Partial<Run> = {}, engine: Partial<Run["engine"]> = {}) => fakeRun({ ...p, engine: { ...fakeRun().engine, ...engine } });
const canary = (weights: number[]): Run["canary"] => ({ options: { weights: [10, 50, 100] }, steps: weights.map((weight, i) => ({ weight, startedAt: at(i + 1) })) });
const snap = (v: MigrationView, traffic?: TrafficState) => buildMapSnapshot(v, { now: Date.parse(at(30)), traffic });
const keys = (v: MigrationView) => snap(v).phases.map((p) => p.key);

describe("migration map snapshot: one map from the setup to the end of the run", () => {
  it("before a plan, nothing is at work and the target is only a candidate", () => {
    const s = snap(view());
    expect(s.cur).toBe(-1);
    expect(s.nodes["aws.app"][0]).toBe("idle");
    expect(s.activity).toBe("none");
    expect(s.actions).toEqual([]);
  });

  it("does not invent live traffic before the run: without the gateway the share is unknown, not 0", () => {
    const s = snap(view());
    expect(s.share).toBeUndefined();
    expect(s.kpi.weights).toBe("? / ?");
  });

  it("the demo's source serves all reads before the run", () => {
    expect(snap(view({ live: false })).share).toBe(0);
  });

  it("an AI plan at work probes both lanes read-only and is the current phase", () => {
    const s = snap(view({ stage: "ai", sessions: [fakeAgentSession({ kind: "plan" })] }));
    expect(s.activity).toBe("probe");
    expect(s.phases[s.cur].key).toBe("ai-plan");
    expect(s.nodes["aws.app"][0]).toBe("plan");
  });

  it("the sandbox rehearsal moves inside the target only, and a failed attempt under diagnosis shows as critical", () => {
    const reh = fakeAgentSession({ id: "ags_2", kind: "rehearsal", createdAt: at(2) });
    const diag = fakeAgentSession({ id: "ags_3", kind: "diagnose", createdAt: at(3) });
    const plain = snap(view({ stage: "ai", plan: plan(), sessions: [reh] }));
    expect([plain.activity, plain.sync.mode, plain.phases[plain.cur].key]).toEqual(["sandbox", "none", "ai-rehearsal"]);
    const fixing = snap(view({ stage: "ai", plan: plan(), sessions: [diag, reh] }));
    expect(fixing.nodes["aws.app"][0]).toBe("crit");
    expect(fixing.lanes.aws.tagTone).toBe("crit");
  });

  it("shows the rehearsal's events in its phase and the engine events panel", () => {
    const reh = fakeAgentSession({ id: "ags_2", kind: "rehearsal", status: "succeeded" });
    const evs: AgentEvent[] = [{ seq: 1, sessionId: "ags_2", time: at(4), type: "tool_call", tool: "kubectl" }];
    const s = snap(view({ stage: "review", plan: plan(), sessions: [reh] }, { ags_2: evs }));
    expect(s.phases.find((p) => p.key === "ai-rehearsal")!.lines).toHaveLength(1);
    expect(s.events.map((e) => e.id)).toEqual(["aags_2:1"]);
  });

  it("waits at the approval and offers it as the map's command", () => {
    const s = snap(view({ stage: "review", plan: plan(), sessions: [fakeAgentSession({ kind: "rehearsal", status: "succeeded" })] }));
    expect(s.phases[s.cur]).toMatchObject({ key: "approve", st: "wait" });
    expect(s.actions.map((a) => a.key)).toEqual(["approve"]);
    expect(s.lanes.aws.tag).toBe("리허설 통과");
  });

  it("lists the AI phases, the approval, the engine steps, one phase per canary weight and the switch, in order", () => {
    expect(keys(view({ stage: "run", plan: plan({ status: "started" as PlanRecord["status"] }), run: run({ canary: canary([]) }) }))).toEqual([
      "ai-plan", "ai-rehearsal", "approve", "preflight", "precheck", "prepare", "presync", "delta", "canary-0", "canary-1", "canary-2", "switch", "fence", "switchover", "cutover", "verify", "finalize",
    ]);
  });

  it("marks the step at work as current, a waiting switch as waiting, and offers the switch", () => {
    const working = snap(view({ stage: "run", run: run({}, { steps: { precheck: { status: "succeeded" }, prepare: { status: "running" } } }) }));
    expect(working.phases[working.cur].key).toBe("prepare");
    const waiting = snap(view({ stage: "run", run: run({ status: "awaiting_switch", phase: "awaiting_switch" }) }));
    expect(waiting.phases[waiting.cur]).toMatchObject({ key: "switch", st: "wait" });
    expect(waiting.actions.map((a) => a.key)).toContain("switch");
  });

  it("judges a canary step from its gate against the platform thresholds", () => {
    const c: Run["canary"] = { options: { weights: [10] }, steps: [{ weight: 10, startedAt: at(1), endedAt: at(2), verdict: "failed", gate: { passed: false, reason: "p95 too high", requests: 40, errorRate: 0, p95Millis: 900 } }] };
    const s = snap(view({ stage: "run", run: run({ status: "rolled_back", phase: "done", canary: c }) }));
    expect(s.phases.find((x) => x.key === "canary-0")!.st).toBe("fail");
    expect(s.phases.at(-1)!.key).toBe("rb");
  });

  it("does not leave a step running on an ended run, and moves no data", () => {
    const s = snap(view({ stage: "run", run: run({ status: "failed", phase: "done" }, { failureStep: "presync", steps: { presync: { status: "running" } } }) }));
    expect(s.phases.find((x) => x.key === "presync")!.st).toBe("fail");
    expect(s.sync.mode).toBe("none");
    expect(s.actions.map((a) => a.key)).toEqual(["resume", "reset"]);
  });

  it("copies during presync and replicates until the promotion", () => {
    const copy = snap(view({ stage: "run", run: run({}, { steps: { presync: { status: "running", startedAt: at(1) } } }) }));
    expect(copy.sync).toMatchObject({ mode: "copy", files: true });
    const cdc = snap(view({ stage: "run", run: run({}, { steps: { delta: { status: "succeeded", endedAt: at(2) } } }) }));
    expect(cdc.sync.mode).toBe("cdc");
  });

  it("keeps a halted run apart from a rollback: roles unknown, no rollback phase", () => {
    const s = snap(view({ stage: "run", run: run({ status: "halted", phase: "done" }, { promoteRequested: true }) }));
    expect(s.share).toBeUndefined();
    expect(s.nodes["aws.db"][0]).toBe("crit");
    expect(s.phases.some((p) => p.key === "rb")).toBe(false);
    expect(s.kpi.phase).toBe("멈춤");
  });

  it("offers no abort once the promotion is requested", () => {
    const s = snap(view({ stage: "run", run: run({ phase: "cutover" }, { promoteRequested: true }) }));
    expect(s.actions.map((a) => a.key)).not.toContain("abort");
  });

  it("marks the state stale when the live stream dropped during a run, and stops calling it current", () => {
    const s = snap(view({ stage: "run", run: run(), stream: { connected: false, error: "network" } }));
    expect(s.stale).toBe(true);
    expect(s.kpi.pill[1]).toMatch(/연결 끊김/);
    expect(s.banners[0].cls).toBe("wab");
  });

  it("keeps run event ids apart between runs, and scopes the snapshot by plan or run", () => {
    const ev = (runId: string): RunEvent => ({ seq: 1, time: at(5), runId, kind: "log", message: "x" });
    const a = snap(view({ stage: "run", run: run(), events: [ev("run_1")] }));
    const b = snap(view({ stage: "run", run: run({ runId: "run_2" }), events: [ev("run_2")] }));
    expect(a.events[0].id).not.toBe(b.events[0].id);
    expect(a.scope).not.toBe(b.scope);
  });

  it("swaps the lanes when the run goes the other way", () => {
    const s = snap(view({ stage: "run", run: run({ source: { env: "eks", namespace: "shop", cluster: "c" }, target: { env: "gke", namespace: "shop", cluster: "c" } }) }));
    expect([s.src, s.tgt]).toEqual(["aws", "gcp"]);
  });
});

describe("currentOf", () => {
  const ph = (...st: string[]) => st.map((s) => ({ st: s })) as { st: "done" | "cur" | "wait" | "fail" | "todo" | "skip" }[];
  it("takes the phase at work, else the failure, else the next to do, else none", () => {
    expect(currentOf(ph("done", "cur", "todo"))).toBe(1);
    expect(currentOf(ph("done", "fail", "todo"))).toBe(1);
    expect(currentOf(ph("done", "todo"))).toBe(1);
    expect(currentOf(ph("done", "skip"))).toBe(-1);
  });
});
