import { AI_END, SWITCH_AT, allSessions, matrixRoutes } from "./mig";
import * as dep from "./deploy";
import { apply, appsIn, fresh, migActive, tick, type SimState } from "./state";

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

});

describe("deploy simulation (platform contract shapes)", () => {
  const req = { repo: "team-charlie/notice-board", branch: "main", environments: ["k3s", "gke"], autoDeploy: true };

  it("registers a repository and deploys it through every phase to healthy within 5 minutes", () => {
    const S = fresh();
    expect(dep.checkCreate(S.deploy, req)).toBeNull();
    apply(S, { type: "app-create", req });
    const d = S.deploy.deployments[0];
    const app = S.deploy.apps.find((a) => a.name === "notice-board")!;
    expect(app.deploy).toMatchObject({ repo: req.repo, branch: "main", environments: ["gke", "k3s"], autoDeploy: true, url: "https://notice-board.hopcharlie.dev" });
    expect(app.deploy?.lastDeployment).toBe(d);
    expect(d).toMatchObject({ app: "notice-board", trigger: "register", status: "queued", ref: "main" });
    expect(d.environments.map((e) => e.status)).toEqual(["pending", "pending"]);

    const seen = new Set<string>();
    for (let i = 0; i < 300 && !dep.isFinal(d.status); i++) {
      tick(S);
      seen.add(d.status);
    }
    expect([...seen]).toEqual(["queued", "building", "committing", "syncing", "healthy"]);
    expect(d.environments.every((e) => e.status === "healthy" && e.syncStatus === "Synced" && e.healthStatus === "Healthy")).toBe(true);
    expect(d.images.map((i) => i.service)).toEqual(["web"]);
    expect(d.images[0].image).toMatch(/hopcharlie\/apps\/notice-board\/web@sha256:[0-9a-f]{64}$/);
    expect((Date.parse(d.finishedAt!) - Date.parse(d.createdAt)) / 1000).toBeLessThanOrEqual(300);
    expect(app.deploy?.status.map((s) => [s.env, s.status, s.commit])).toEqual([
      ["gke", "healthy", d.commit],
      ["k3s", "healthy", d.commit],
    ]);
    // events: seq increases, every phase once, done last
    const evs = S.deploy.events[d.id];
    expect(evs.map((e) => e.seq)).toEqual([...evs.map((e) => e.seq)].sort((a, b) => a - b));
    expect(evs.filter((e) => e.type === "phase").map((e) => e.phase)).toEqual(["queued", "building", "committing", "syncing"]);
    expect(evs.at(-1)).toMatchObject({ type: "done", phase: "healthy" });
    expect(S.act[0][1]).toMatch(/^notice-board 배포 완료 \(2개 환경/);
    const now = S.deploy.now;
    run(S, 10); // the clock stops once nothing is running
    expect(S.deploy.now).toBe(now);
  });

  it("refuses an invalid platform.yaml, a registered name and no environment, like the API", () => {
    const S = fresh();
    const bad = dep.checkCreate(S.deploy, { ...req, repo: "team-charlie/photo-album" });
    expect(bad && "validation" in bad && bad.validation.errors.map((e) => e.path)).toEqual(["services[1].port", "services[1].env.WORKERS"]);
    expect(dep.validate("team-charlie/photo-album", "fix-worker").valid).toBe(true);
    expect(dep.validate("team-charlie/analytics-worker", "main")).toMatchObject({ valid: false, errors: [{ path: "" }] });
    expect(dep.validate("team-charlie/notice-board", "nope").errors[0].message).toMatch(/branch/);
    expect(dep.checkCreate(S.deploy, { ...req, repo: "team-charlie/todo-api" })).toEqual({ error: expect.stringMatching(/이미 등록된 앱/) });
    expect(dep.checkCreate(S.deploy, { ...req, environments: [] })).toEqual({ error: expect.any(String) });
    apply(S, { type: "app-create", req: { ...req, repo: "team-charlie/photo-album" } });
    expect(S.deploy.apps.map((a) => a.name)).toEqual(["todo-api"]);
  });

  it("a new deployment supersedes the unfinished one, and delete forgets the app", () => {
    const S = fresh();
    apply(S, { type: "app-create", req });
    const first = S.deploy.deployments[0];
    run(S, 20);
    apply(S, { type: "app-redeploy", name: "notice-board" });
    const second = S.deploy.deployments[0];
    expect(second.trigger).toBe("manual");
    expect(first.status).toBe("superseded");
    expect(S.deploy.events[first.id].at(-1)).toMatchObject({ type: "done", phase: "superseded" });
    run(S, 200);
    expect(second.status).toBe("healthy");
    expect(first.status).toBe("superseded");

    apply(S, { type: "app-delete", name: "notice-board" });
    expect(S.deploy.apps.map((a) => a.name)).toEqual(["todo-api"]);
    expect(S.deploy.deployments.some((x) => x.app === "notice-board")).toBe(false);
    expect(S.deploy.events[second.id]).toBeUndefined();
  });

  it("starts with todo-api registered on all three environments and two finished deployments", () => {
    const S = fresh();
    const [todo] = S.deploy.apps;
    expect(todo.deploy?.status.map((s) => s.status)).toEqual(["healthy", "healthy", "healthy"]);
    expect(S.deploy.deployments.map((x) => [x.trigger, x.status])).toEqual([
      ["push", "healthy"],
      ["register", "healthy"],
    ]);
    expect(appsIn(S, "aws")).toBe(1);
  });
});

describe("branch instances simulation (ADR 0015)", () => {
  const req = { repo: "team-charlie/notice-board", branch: "main", environments: ["eks", "gke"], autoDeploy: true };
  const add = (branch: string, autoDeploy = true) => ({ type: "instance-create" as const, name: "notice-board", branch, autoDeploy });
  const board = (S: SimState) => S.deploy.apps.find((a) => a.name === "notice-board")!.deploy!;

  /** notice-board registered from main and healthy on EKS and GKE */
  function registered(): SimState {
    const S = fresh();
    apply(S, { type: "app-create", req });
    run(S, 300);
    return S;
  }

  it("names instances like appspec.InstanceName", () => {
    expect(dep.branchSlug("Feature/Login_Page")).toBe("feature-login-page");
    expect(dep.branchSlug("--a//b--")).toBe("a-b");
    expect(dep.instanceName("notice-board", "dev")).toBe("notice-board--dev");
    expect(dep.instanceName("notice-board", "///")).toBeNull();
    // past 53 characters: the slug is cut and a hash of the branch follows
    const long = dep.instanceName("notice-board", "feature/" + "x".repeat(60))!;
    expect(long).toHaveLength(53);
    expect(long).toMatch(/^notice-board--feature-x{24}-[0-9a-f]{6}$/);
    expect(dep.instanceName("notice-board", "feature/" + "x".repeat(61))).not.toBe(long);
    // a cut that ends in "-" drops it
    expect(dep.instanceName("notice-board", "x".repeat(31) + "/" + "y".repeat(30))).toMatch(/^notice-board--x{31}-[0-9a-f]{6}$/);
  });

  it("deploys an added branch as its own instance; its failed build leaves main healthy", () => {
    const S = registered();
    expect(dep.checkAddInstance(S.deploy, "notice-board", "dev")).toBeNull();
    apply(S, add("dev", false));
    const [main, dev] = board(S).instances;
    expect(main).toMatchObject({ name: "notice-board", branch: "main", default: true, url: "https://notice-board.hopcharlie.dev" });
    expect(dev).toMatchObject({ name: "notice-board--dev", branch: "dev", default: false, autoDeploy: false, url: "https://notice-board--dev.hopcharlie.dev" });
    const d = S.deploy.deployments[0];
    expect(d).toMatchObject({ app: "notice-board", branch: "dev", instance: "notice-board--dev", trigger: "register", ref: "dev", status: "queued" });
    expect(dev.lastDeployment).toBe(d);
    // the top-level fields stay the default instance's
    expect(board(S).lastDeployment?.instance).toBe("notice-board");
    expect(S.act[0][1]).toBe("notice-board에 dev 브랜치 추가 (인스턴스 notice-board--dev)");

    run(S, 60);
    expect(d.status).toBe("failed");
    expect(S.act[0][1]).toMatch(/^notice-board--dev 배포 실패/);
    expect(dev.status.map((s) => s.status)).toEqual(["pending", "pending"]);
    expect(board(S).status.map((s) => s.status)).toEqual(["healthy", "healthy"]);
    expect(main.lastDeployment?.status).toBe("healthy");
  });

  it("supersedes per instance and commits apps/<instance>/", () => {
    const S = registered();
    apply(S, add("feature/search"));
    const search = S.deploy.deployments[0];
    expect(search.instance).toBe("notice-board--feature-search");
    run(S, 10);
    apply(S, { type: "app-redeploy", name: "notice-board" });
    const main = S.deploy.deployments[0];
    expect(main).toMatchObject({ branch: "main", instance: "notice-board", trigger: "manual" });
    expect(search.status).toBe("building"); // another instance's deployment is not superseded
    apply(S, { type: "app-redeploy", name: "notice-board", branch: "feature/search" });
    const again = S.deploy.deployments[0];
    expect(again).toMatchObject({ branch: "feature/search", instance: "notice-board--feature-search" });
    expect(search.status).toBe("superseded");
    expect(main.status).not.toBe("superseded");

    run(S, 300);
    expect([main.status, again.status]).toEqual(["healthy", "healthy"]);
    expect(S.deploy.events[again.id].map((e) => e.message)).toContain("gitops에 apps/notice-board--feature-search/<env>.yaml 커밋");
    expect(again.images[0].image).toMatch(/hopcharlie\/apps\/notice-board\/web@sha256:/); // images are the app's
    const inst = board(S).instances.find((i) => i.branch === "feature/search")!;
    expect(inst.status.map((s) => [s.status, s.commit])).toEqual([
      ["healthy", again.commit],
      ["healthy", again.commit],
    ]);
    expect(board(S).lastDeployment).toBe(main);
  });

  it("refuses like the server and in its order: branch name, own branch, empty slug, platform.yaml, added branch, taken name, limit", () => {
    const S = registered();
    const check = (branch: string, name = "notice-board") => dep.checkAddInstance(S.deploy, name, branch);
    expect(dep.validBranch("feature/x-1.2_b")).toBe(true);
    for (const bad of ["", "-x", "/x", ".x", "x/", "x.", "x.lock", "a..b", "a//b", "a/.b", "a b", "기능"]) expect(dep.validBranch(bad)).toBe(false);
    expect(check("a b")).toMatchObject({ status: 400, code: "invalid_request" });
    expect(check("main")).toMatchObject({ status: 409, code: "branch_exists", message: expect.stringMatching(/own branch/) });
    expect(check("_")).toMatchObject({ status: 400, code: "invalid_request", message: expect.stringMatching(/no letter or digit/) });
    expect(check("nope")).toMatchObject({ validation: { valid: false, errors: [{ path: "" }] } });
    // only the repository's own branches: no prototype keys
    expect(check("constructor")).toMatchObject({ validation: { valid: false, errors: [{ message: "branch constructor not found" }] } });
    expect(check("toString")).toMatchObject({ validation: { valid: false } });

    apply(S, add("dev"));
    expect(check("dev")).toMatchObject({ status: 409, code: "branch_exists", message: expect.stringMatching(/already deploys/) });
    // Another branch with the same instance name, as feature-search would be next to feature/search.
    const others = board(S).instances;
    board(S).instances = [...others, { ...others[1], branch: "feature-search", name: "notice-board--feature-search" }];
    expect(check("feature/search")).toMatchObject({ status: 409, code: "instance_exists" });
    // A third instance under another name: the limit, checked last.
    board(S).instances = [...others, { ...others[1], branch: "other", name: "notice-board--other" }];
    expect(check("feature/search")).toMatchObject({ status: 409, code: "instance_limit" });
    expect(check("nope")).toMatchObject({ validation: { valid: false } });
    board(S).instances = others;

    apply(S, add("feature/search"));
    expect(board(S).instances.map((i) => i.name)).toEqual(["notice-board", "notice-board--dev", "notice-board--feature-search"]);
    apply(S, add("main"));
    expect(board(S).instances).toHaveLength(3);

    apply(S, { type: "app-create", req: { ...req, repo: "team-charlie/photo-album", branch: "fix-worker" } });
    const bad = check("main", "photo-album");
    expect(bad && "validation" in bad && bad.validation.errors.map((e) => e.path)).toEqual(["services[1].port", "services[1].env.WORKERS"]);
  });

  it("removes an added instance with its deployments but never the default one; deleting the app removes them all", () => {
    const S = registered();
    apply(S, add("dev"));
    const devDep = S.deploy.deployments[0];
    apply(S, { type: "instance-delete", name: "notice-board", instance: "notice-board" });
    expect(board(S).instances).toHaveLength(2);
    apply(S, { type: "instance-delete", name: "notice-board", instance: "notice-board--dev" });
    expect(board(S).instances.map((i) => i.name)).toEqual(["notice-board"]);
    expect(S.deploy.deployments.some((x) => x.instance === "notice-board--dev")).toBe(false);
    expect(S.deploy.events[devDep.id]).toBeUndefined();
    expect(S.deploy.active[devDep.id]).toBeUndefined();
    expect(S.act[0][1]).toBe("notice-board--dev 삭제 (gitops에서 apps/notice-board--dev/ 제거)");

    apply(S, add("dev"));
    apply(S, { type: "app-delete", name: "notice-board" });
    expect(S.act[0][1]).toBe("notice-board 삭제 (gitops에서 apps/notice-board/, apps/notice-board--dev/ 제거)");
    expect(S.deploy.deployments.some((x) => x.app === "notice-board")).toBe(false);
  });
});
