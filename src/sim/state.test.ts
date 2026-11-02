import { AI_END, SWITCH_AT, allSessions, matrixRoutes } from "./mig";
import { apply, fresh, migActive, tick, type SimState } from "./state";

function run(S: SimState, n: number) {
  for (let i = 0; i < n; i++) tick(S);
}

/** shop imported on EKS, AI done, plan waiting for approval */
function reviewed(target: "gcp" | "onprem" = "onprem"): SimState {
  const S = fresh();
  apply(S, { type: "onb-skip" });
  apply(S, { type: "mig-target", env: target });
  apply(S, { type: "mig-plan" });
  run(S, AI_END);
  return S;
}

const POST_TICKS = 68; // 13.6s of cutover and verify at 0.2s per tick

describe("migration simulation (platform contract shapes)", () => {
  it("AI plans and rehearses, then the plan waits for the operator", () => {
    const S = reviewed();
    const m = S.mig;
    expect(m.stage).toBe("review");
    expect(m.plan?.status).toBe("pending_approval");
    // the diagnose fix was uploaded as an attachment, which raised the revision
    expect(m.plan?.revision).toBe(2);
    expect(m.plan?.attachments?.[0].name).toBe("values-k3s.yaml");
    expect(m.plan?.summary.source.env).toBe("eks");
    expect(m.plan?.summary.target.env).toBe("k3s");
    expect(m.sessions.map((s) => s.kind).sort()).toEqual(["diagnose", "plan", "rehearsal"]);
    expect(m.sessions.every((s) => s.status === "succeeded" && s.planRef === m.plan?.ref)).toBe(true);
    const blocked = Object.values(m.sessionEvents).flat().filter((e) => e.type === "blocked");
    expect(blocked).toHaveLength(2);
    run(S, 50);
    expect(m.run).toBeNull(); // nothing touched production before approval
  });

  it("refuses an approval of a revision the operator did not see", () => {
    const S = reviewed();
    apply(S, { type: "mig-approve", revision: 1 });
    expect(S.mig.plan?.status).toBe("pending_approval");
    expect(S.migNotice).toMatch(/revision 1/);
  });

  it("runs sync → canary → awaiting_switch → cutover → verify with zero loss, within 3 minutes", () => {
    const S = reviewed();
    apply(S, { type: "mig-approve", revision: 2 });
    const m = S.mig;
    expect(m.plan?.status).toBe("started");
    expect(m.run?.status).toBe("running");
    expect(m.run?.phase).toBe("sync");

    run(S, 70);
    expect(m.run?.phase).toBe("canary");
    expect(m.run?.canary?.steps[0].weight).toBe(10);

    run(S, SWITCH_AT - 70);
    expect(m.run?.status).toBe("awaiting_switch");
    expect(m.run?.canary?.steps.every((s) => s.gate?.passed)).toBe(true);
    expect(m.run?.engine.promoteRequested).toBe(false);
    run(S, 10); // waiting does not advance the engine
    expect(m.run?.status).toBe("awaiting_switch");

    apply(S, { type: "mig-switch" });
    run(S, 30); // 6.0s into the cutover: writes are held, the target was asked to promote
    expect(m.run?.engine.writesHeld).toBe(true);
    expect(m.run?.engine.promoteRequested).toBe(true);
    expect(m.held).toBeGreaterThan(0);
    apply(S, { type: "mig-abort" }); // past the point of no return: ignored
    expect(m.run?.status).toBe("running");

    run(S, POST_TICKS - 30);
    const r = m.run!;
    expect(r.status).toBe("succeeded");
    expect(r.engine.trafficOnTarget).toBe(true);
    expect(Object.values(r.engine.steps).every((s) => s.status === "succeeded")).toBe(true);
    expect(r.result).toMatchObject({ failedRequests: 0, missingRows: 0, missingWrites: 0, missingFiles: 0, verified: true });
    expect(r.result.durationMillis).toBeLessThanOrEqual(180_000);
    expect(r.result.downtimeMillis).toBe(6400);
    expect(m.heldDone).toBeGreaterThan(0);
    expect(S.apps.shop.loc).toBe("onprem");
    expect(S.apps.shop.prev).toBe("aws");
    expect(matrixRoutes(m)[0]).toMatchObject({ source: "eks", target: "k3s", status: "succeeded" });
    expect(migActive(S)).toBe(false);
    // the event stream is ordered and carries the platform kinds
    const kinds = new Set(m.events.map((e) => e.kind));
    for (const k of ["status_changed", "step_started", "step_succeeded", "canary_step", "gate_result", "metric", "done"]) expect(kinds.has(k)).toBe(true);
    expect(m.events.map((e) => e.seq)).toEqual(m.events.map((_, i) => i + 1));
  });

  it("abort before promotion stops the run, resume continues it", () => {
    const S = reviewed();
    apply(S, { type: "mig-approve", revision: 2 });
    run(S, 30);
    apply(S, { type: "mig-abort" });
    expect(S.mig.run?.status).toBe("aborted");
    run(S, 30);
    expect(S.mig.t).toBe(30);
    apply(S, { type: "mig-resume" });
    expect(S.mig.run?.status).toBe("running");
    run(S, 5);
    expect(S.mig.t).toBe(35);
  });

  it("1-click rollback runs back the way it came without waiting for /switch", () => {
    const S = reviewed("gcp");
    apply(S, { type: "mig-approve", revision: 2 });
    run(S, SWITCH_AT);
    apply(S, { type: "mig-switch" });
    run(S, POST_TICKS);
    const first = S.mig.run!;
    expect(S.apps.shop.loc).toBe("gcp");

    apply(S, { type: "mig-rollback" });
    const back = S.mig.run!;
    expect(back.rollbackOf).toBe(first.runId);
    expect(back.source.env).toBe("gke");
    expect(back.target.env).toBe("eks");
    expect(back.autoSwitch).toBe(true);
    run(S, SWITCH_AT + POST_TICKS);
    expect(S.mig.run?.status).toBe("succeeded");
    expect(S.apps.shop.loc).toBe("aws");
    expect(matrixRoutes(S.mig).map((r) => r.source + ">" + r.target)).toEqual(["gke>eks", "eks>gke"]);
    expect(allSessions(S.mig).sessions).toHaveLength(3); // the first migration's AI sessions are kept
  });

  it("reject returns to setup on the same route", () => {
    const S = reviewed();
    apply(S, { type: "mig-reject" });
    expect(S.mig.stage).toBe("setup");
    expect(S.mig.tgt).toBe("onprem");
    expect(S.mig.plan).toBeNull();
  });

  it("a second migration starts from where the app now lives", () => {
    const S = reviewed("gcp");
    apply(S, { type: "mig-approve", revision: 2 });
    run(S, SWITCH_AT);
    apply(S, { type: "mig-switch" });
    run(S, POST_TICKS);
    apply(S, { type: "mig-new" });
    expect(S.mig.src).toBe("gcp");
    expect(S.mig.history).toHaveLength(1);
    apply(S, { type: "mig-target", env: "gcp" }); // same as source: ignored
    expect(S.mig.tgt).not.toBe("gcp");
  });

  it("onboarding imports the app onto the chosen cluster", () => {
    const S = fresh();
    apply(S, { type: "mig-plan" }); // no app yet: ignored
    expect(S.mig.stage).toBe("setup");
    apply(S, { type: "onb-env", env: "gcp" });
    apply(S, { type: "onb-start" });
    run(S, 44);
    expect(S.onb.done[2]).toBe(true);
    apply(S, { type: "onb-sbx" });
    run(S, 98);
    apply(S, { type: "onb-pr" });
    apply(S, { type: "onb-approve" });
    run(S, 75);
    expect(S.apps.shop.loc).toBe("gcp");
    expect(S.mig.src).toBe("gcp");
  });

  it("deploy registers the app on the chosen environments", () => {
    const S = fresh();
    apply(S, { type: "dep-env", env: "aws", on: false });
    apply(S, { type: "dep-start" });
    run(S, 150);
    expect(S.dep.phase).toBe("done");
    expect(S.apps["notice-board"].envs).toEqual(["gcp", "onprem"]);
  });
});
