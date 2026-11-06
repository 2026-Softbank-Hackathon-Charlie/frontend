import { at, fakeRun } from "../api/fakes";
import type { Run, RunEvent } from "../api/types";
import { groupsOf } from "./Migrate";

const ev = (seq: number, kind: string, p: Partial<RunEvent> = {}): RunEvent => ({ seq, time: at(seq), runId: "run_1", kind, ...p });
const status = (seq: number, s: string, phase: string) => ev(seq, "status_changed", { data: { status: s, phase, reason: "" } });
const ended = (p: Partial<Run>, engine: Partial<Run["engine"]> = {}) => fakeRun({ phase: "done", endedAt: at(13), ...p, engine: { ...fakeRun().engine, ...engine } });

// Up to the switch: sync, the canary, the wait for /switch and its approval.
const synced = [
  status(1, "running", "sync"),
  ...["precheck", "prepare", "presync", "delta"].map((step, i) => ev(2 + i, "step_succeeded", { step })),
  status(6, "running", "canary"),
  status(7, "awaiting_switch", "awaiting_switch"),
  status(8, "running", "cutover"),
];

describe("migration progress groups", () => {
  it("puts the stop of a halted run where it halted, though the platform ends every run in phase done", () => {
    const events = [
      ...synced,
      ev(9, "step_succeeded", { step: "fence" }),
      ev(10, "step_started", { step: "switchover" }),
      ev(11, "step_failed", { step: "switchover" }),
      status(12, "halted", "cutover"),
      status(13, "halted", "done"),
    ];
    const g = groupsOf(ended({ status: "halted" }, { outcome: "halted", promoteRequested: true, failureStep: "switchover" }), events);
    expect(g.map((x) => x.st)).toEqual(["done", "done", "bad", "todo"]);
    expect(g[2].items.map((x) => x.st)).toEqual(["ok", "bad", "wait", "wait"]);
    // the stopped part ends when the run did instead of staying open
    expect(g[2].range).toBe("00:08 ~ 00:13");
  });

  it("takes the stop from the engine's failure step when there are no events", () => {
    const g = groupsOf(ended({ status: "failed" }, { outcome: "failed", failureStep: "presync" }), []);
    expect(g.map((x) => x.st)).toEqual(["bad", "todo", "todo", "todo"]);
  });

  it("does not show a succeeded run as all good when its observation broke the gate", () => {
    const events = [
      ...synced,
      ...["fence", "switchover", "cutover", "verify", "finalize"].map((step, i) => ev(9 + i, "step_succeeded", { step })),
      status(12, "running", "observe"),
      status(13, "succeeded", "done"),
    ];
    const observe = { options: { autoRollback: true }, steps: [], passed: false, violation: "error rate 3.10% > 1.00%" };
    const g = groupsOf(ended({ status: "succeeded", observe }, { outcome: "succeeded", promoteRequested: true, trafficOnTarget: true }), events);
    expect(g.map((x) => x.st)).toEqual(["done", "done", "done", "bad"]);
    expect(g[3].items.at(-1)).toMatchObject({ label: "전환 후 관찰 위반", st: "bad" });
  });

  it("gives an observation that ended without a verdict no check mark", () => {
    const events = [...synced, ...["fence", "switchover", "cutover", "verify", "finalize"].map((step, i) => ev(9 + i, "step_succeeded", { step })), status(12, "running", "observe")];
    const observe = { options: {}, steps: [], stoppedReason: "the platform is shutting down" };
    const g = groupsOf(ended({ status: "succeeded", observe }, { outcome: "succeeded" }), events);
    expect(g[3].items.at(-1)).toMatchObject({ label: "전환 후 관찰 (판정 없이 끝남)", st: "neu" });
  });

  it("shows start-target without a check mark on a run from before the step existed", () => {
    const steps = Object.fromEntries(["fence", "switchover", "cutover", "verify", "finalize"].map((k) => [k, { status: "succeeded" as const }]));
    const g = groupsOf(ended({ status: "succeeded" }, { outcome: "succeeded", steps }), []);
    expect(g[2].items.map((x) => x.st)).toEqual(["ok", "ok", "neu", "ok"]);
    expect(g.map((x) => x.st)).toEqual(["done", "done", "done", "done"]);
  });
});
