import { CANARY_PRESETS } from "../sim/mig";
import { approvalBlock, DEFAULT_START, OBSERVE_DURATIONS, OBSERVE_STEP, linkedPlanSessionId, planningSession, startRequest } from "./migration";
import { fakeAgentSession } from "../api/fakes";
import type { AgentEvent, PlanRecord } from "../api/types";

describe("start request", () => {
  it("sends the quick read canary and no observation by default", () => {
    expect(startRequest("pln_1", "http", DEFAULT_START)).toEqual({ planRef: "pln_1", canary: { weights: [10, 50, 100], stepDuration: "5s" } });
  });

  it("sends the gradual canary when the operator picks it", () => {
    expect(startRequest("pln_1", "http", { ...DEFAULT_START, canary: "gradual" }).canary).toEqual({ weights: [1, 10, 25, 50, 75, 90, 100], stepDuration: "10s" });
  });

  // the platform takes increasing weights within 1..100 and steps of 5s to 5m (runs: canaryOptions)
  it("offers only canaries the platform accepts", () => {
    for (const c of Object.values(CANARY_PRESETS)) {
      expect(c.stepSec).toBeGreaterThanOrEqual(5);
      expect(c.stepSec).toBeLessThanOrEqual(300);
      c.weights.forEach((w, i) => {
        expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(100);
        if (i > 0) expect(w).toBeGreaterThan(c.weights[i - 1]);
      });
      expect(c.weights[c.weights.length - 1]).toBe(100);
    }
  });

  it("adds the observation the operator picked", () => {
    expect(startRequest("pln_1", "http", { ...DEFAULT_START, observe: true, duration: "5m", autoRollback: true }).observe).toEqual({ duration: "5m", stepDuration: "20s", autoRollback: true });
    expect(startRequest("pln_1", "http", { ...DEFAULT_START, observe: true, duration: "1m", autoRollback: false }).observe).toEqual({ duration: "1m", stepDuration: "20s", autoRollback: false });
  });

  it("ignores auto rollback without observation", () => {
    expect(startRequest("pln_1", "http", { ...DEFAULT_START, observe: false, duration: "2m", autoRollback: true }).observe).toBeUndefined();
  });

  // the platform refuses canary and observe for a plan whose gateway is not http (runs: ErrInvalid)
  it("sends neither canary nor observe without the platform gateway", () => {
    for (const mode of ["none", "", undefined]) {
      expect(startRequest("pln_1", mode, { ...DEFAULT_START, observe: true, duration: "2m", autoRollback: true })).toEqual({ planRef: "pln_1" });
    }
  });

  // the platform takes 10s to 30m, and a step may not be longer than the whole observation
  it("offers only durations the platform accepts", () => {
    const sec = (d: string) => Number(d.slice(0, -1)) * (d.endsWith("m") ? 60 : 1);
    for (const d of OBSERVE_DURATIONS) {
      expect(sec(d)).toBeGreaterThanOrEqual(Math.max(10, sec(OBSERVE_STEP)));
      expect(sec(d)).toBeLessThanOrEqual(30 * 60);
    }
    expect(OBSERVE_DURATIONS).toContain(DEFAULT_START.duration);
  });
});

describe("AI runner sessions", () => {
  const plan = (p: Parameters<typeof fakeAgentSession>[0]) => fakeAgentSession({ kind: "plan", title: "moimroom 이전 계획 (gke → eks)", ...p });

  it("finds the plan hopai is writing for the app before a Plan exists", () => {
    const writing = plan({ id: "ags_3" });
    const sessions = [
      plan({ id: "ags_5", title: "todo-api 이전 계획 (gke → eks)" }), // another app
      fakeAgentSession({ id: "ags_4", kind: "rehearsal", title: "샌드박스 리허설 (moimroom-gke-to-eks)" }),
      writing,
      plan({ id: "ags_2", status: "succeeded" }), // done
      plan({ id: "ags_1", planRef: "pln_1" }), // already tied to a plan
    ];
    expect(planningSession(sessions, "moimroom")).toBe(writing);
    expect(planningSession(sessions, "moim")).toBeUndefined(); // the title starts with the whole app name
    expect(planningSession(sessions, "")).toBeUndefined();
    expect(planningSession(undefined, "moimroom")).toBeUndefined();
  });

  it("reads the plan session a rehearsal names", () => {
    const ev = (p: Partial<AgentEvent>): AgentEvent => ({ seq: 1, sessionId: "ags_4", time: "2026-11-04T00:00:00Z", type: "message", ...p });
    expect(linkedPlanSessionId([ev({ tool: "sandbox_apply", output: { planSession: "x" } }), ev({ tool: "plan", output: { planRef: "pln_1", planSession: "ags_3", planId: "p" } })])).toBe("ags_3");
    expect(linkedPlanSessionId([ev({ tool: "plan", output: "ags_3" }), ev({ tool: "plan", output: { planSession: "" } })])).toBeUndefined();
    expect(linkedPlanSessionId([])).toBeUndefined();
  });
});

describe("approval block (platform #24)", () => {
  const rec = (p: Partial<PlanRecord>): PlanRecord =>
    ({ ref: "pln_1", status: "pending_approval", revision: 3, summary: {} as PlanRecord["summary"], submittedBy: "hopai", submittedAt: "2026-11-05T00:00:00Z", ...p }) as PlanRecord;

  it("blocks an AI plan without a passing rehearsal, with the platform's reason", () => {
    expect(approvalBlock(rec({ rehearsal: { required: true, passed: false, reason: "no rehearsal report" } }))).toBe("no rehearsal report");
    expect(approvalBlock(rec({ rehearsal: { required: true, passed: false } }))).not.toBe("");
  });

  it("lets other plans through: passed, not required, no gate info (older platform), or not pending", () => {
    expect(approvalBlock(rec({ rehearsal: { required: true, passed: true } }))).toBe("");
    expect(approvalBlock(rec({ rehearsal: { required: false, passed: false } }))).toBe("");
    expect(approvalBlock(rec({}))).toBe("");
    expect(approvalBlock(rec({ status: "approved", rehearsal: { required: true, passed: false } }))).toBe("");
    expect(approvalBlock(undefined)).toBe("");
  });
});
