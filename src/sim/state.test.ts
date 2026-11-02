import { routeKey } from "./data";
import { apply, execT, fresh, oldShare, pastPointOfNoReturn, rep, tick, filesCopied, filesTotal, type SimState } from "./state";

function run(S: SimState, n: number) {
  for (let i = 0; i < n; i++) tick(S);
}

describe("migration simulation", () => {
  it("goes plan → rehearse → approve, and waits for the operator", () => {
    const S = fresh();
    expect(S.apps.shop).toBeUndefined();
    apply(S, { type: "onb-skip" });
    expect(S.apps.shop.loc).toBe("aws");
    apply(S, { type: "mig-target", env: "gcp" });
    apply(S, { type: "mig-plan" });
    expect(S.mig.phase).toBe("plan");
    run(S, 24);
    expect(S.mig.phase).toBe("rehearse");
    run(S, 70);
    expect(S.mig.phase).toBe("approve");
    run(S, 50);
    expect(S.mig.phase).toBe("approve");
    expect(S.mig.ok).toBe(0); // nothing touched production before approval
  });

  it("runs the engine after approval with zero loss, within 3 minutes", () => {
    const S = fresh();
    apply(S, { type: "onb-skip" });
    apply(S, { type: "mig-target", env: "onprem" });
    apply(S, { type: "mig-plan" });
    run(S, 94);
    apply(S, { type: "mig-approve" });
    expect(S.mig.phase).toBe("prep");
    run(S, 100);
    expect(S.mig.phase).toBe("switch");
    expect(pastPointOfNoReturn(S)).toBe(false);
    run(S, 30); // 6.0s simulated: writes are being held
    expect(S.mig.held).toBeGreaterThan(0);
    expect(oldShare(S)).toBe(100);
    run(S, 38); // past 13.6s
    expect(S.mig.phase).toBe("cleanup");
    expect(pastPointOfNoReturn(S)).toBe(true);
    expect(oldShare(S)).toBe(0);
    expect(S.mig.heldDone).toBeGreaterThan(0);
    run(S, 40);
    expect(S.mig.phase).toBe("done");
    expect(execT(S)).toBeLessThanOrEqual(180);
    expect(rep(S)).toBe(S.mig.ok);
    expect(filesCopied(S)).toBe(filesTotal(S));
    expect(S.apps.shop.loc).toBe("onprem");
    expect(S.apps.shop.prev).toBe("aws");
    expect(S.results[routeKey("aws", "onprem")].lostRows).toBe(0);
  });

  it("reject returns to setup on the same route", () => {
    const S = fresh();
    apply(S, { type: "onb-skip" });
    apply(S, { type: "mig-target", env: "onprem" });
    apply(S, { type: "mig-plan" });
    run(S, 94);
    apply(S, { type: "mig-reject" });
    expect(S.mig.phase).toBe("idle");
    expect(S.mig.tgt).toBe("onprem");
  });

  it("a second migration starts from where the app now lives", () => {
    const S = fresh();
    apply(S, { type: "onb-skip" });
    apply(S, { type: "mig-plan" });
    run(S, 94);
    apply(S, { type: "mig-approve" });
    run(S, 100 + 68 + 40);
    apply(S, { type: "mig-new" });
    expect(S.mig.src).toBe("gcp");
    apply(S, { type: "mig-target", env: "gcp" }); // same as source: ignored
    expect(S.mig.tgt).not.toBe("gcp");
  });

  it("onboarding imports the app onto the chosen cluster", () => {
    const S = fresh();
    apply(S, { type: "mig-plan" }); // no app yet: ignored
    expect(S.mig.phase).toBe("idle");
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
