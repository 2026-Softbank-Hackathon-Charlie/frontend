import { DEFAULT_START, OBSERVE_DURATIONS, OBSERVE_STEP, startRequest } from "./migration";

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
