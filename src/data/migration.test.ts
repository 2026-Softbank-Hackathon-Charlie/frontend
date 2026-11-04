import { DEFAULT_START, OBSERVE_DURATIONS, OBSERVE_STEP, linkedPlanSessionId, planningSession, startRequest } from "./migration";
import { fakeAgentSession } from "../api/fakes";
import type { AgentEvent } from "../api/types";

describe("start request", () => {
  it("sends the read canary and no observation by default", () => {
    expect(startRequest("pln_1", "http", DEFAULT_START)).toEqual({ planRef: "pln_1", canary: { weights: [1, 10, 25, 50, 75, 90, 100], stepDuration: "10s" } });
  });

  it("adds the observation the operator picked", () => {
    expect(startRequest("pln_1", "http", { observe: true, duration: "5m", autoRollback: true }).observe).toEqual({ duration: "5m", stepDuration: "20s", autoRollback: true });
    expect(startRequest("pln_1", "http", { observe: true, duration: "1m", autoRollback: false }).observe).toEqual({ duration: "1m", stepDuration: "20s", autoRollback: false });
  });

  it("ignores auto rollback without observation", () => {
    expect(startRequest("pln_1", "http", { observe: false, duration: "2m", autoRollback: true }).observe).toBeUndefined();
  });

  // the platform refuses canary and observe for a plan whose gateway is not http (runs: ErrInvalid)
  it("sends neither canary nor observe without the platform gateway", () => {
    for (const mode of ["none", "", undefined]) {
      expect(startRequest("pln_1", mode, { observe: true, duration: "2m", autoRollback: true })).toEqual({ planRef: "pln_1" });
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
