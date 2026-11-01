import { apply, fresh, oldShare, rep, tick, filesCopied, filesTotal, type SimState } from "./state";

function run(S: SimState, n: number) {
  for (let i = 0; i < n; i++) tick(S);
}

describe("migration simulation", () => {
  it("goes prep → ready → switch → switched → cleanup → done with zero loss", () => {
    const S = fresh();
    apply(S, { type: "onb-skip" });
    expect(S.apps.shop.loc).toBe("legacy");

    apply(S, { type: "mig-start" });
    expect(S.mig.phase).toBe("prep");
    run(S, 151);
    expect(S.mig.phase).toBe("ready");
    expect(oldShare(S)).toBe(100);

    apply(S, { type: "mig-switch" });
    apply(S, { type: "mig-go" });
    run(S, 30); // 6.0s simulated: writes are being held
    expect(S.mig.held).toBeGreaterThan(0);
    expect(oldShare(S)).toBe(100);
    run(S, 40); // past 13.6s
    expect(S.mig.phase).toBe("switched");
    expect(oldShare(S)).toBe(0);
    expect(S.mig.held).toBe(0);
    expect(S.mig.heldDone).toBeGreaterThan(0);
    expect(S.apps.shop.loc).toBe("gcp");

    apply(S, { type: "mig-clean" });
    run(S, 67);
    expect(S.mig.phase).toBe("done");
    expect(rep(S)).toBe(S.mig.ok);
    expect(filesCopied(S)).toBe(filesTotal(S));
    expect(S.act[0][1]).toContain("누락 0건");
  });

  it("auto-switches after prep when requested", () => {
    const S = fresh();
    apply(S, { type: "onb-skip" });
    apply(S, { type: "mig-auto", on: true });
    apply(S, { type: "mig-start" });
    run(S, 151);
    expect(S.mig.phase).toBe("switch");
  });

  it("cancel from confirm returns to ready", () => {
    const S = fresh();
    apply(S, { type: "onb-skip" });
    apply(S, { type: "mig-start" });
    run(S, 151);
    apply(S, { type: "mig-switch" });
    expect(S.mig.phase).toBe("confirm");
    apply(S, { type: "mig-cancel" });
    expect(S.mig.phase).toBe("ready");
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
