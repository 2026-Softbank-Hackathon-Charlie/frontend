import { at, fakeAgentSession, fakeRun } from "../api/fakes";
import type { AgentEvent, AIActivity, App, Environment, PlanRecord, Run, RunEvent, TrafficState } from "../api/types";
import { aiFacts, buildMapSnapshot, currentOf } from "./mapSnapshot";
import type { MigrationView } from "./migration";
import { preflightOf } from "./preflight";

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
  it("does not infer validation success from a completed migration", () => {
    const s = snap(view({ stage: "run", run: run({ status: "succeeded" }) }));
    expect(s.validations.map(x => x.status)).toEqual(["결과 미수신", "검사 기록 없음"]);
    expect(s.validations.every(x => x.tone === "idle")).toBe(true);
  });

  it.each(["pass", "fail", "unknown", "skip"] as const)("keeps residency %s separate with its evidence", status => {
    const s = snap(view({ preflight: {
      at: at(1), blocked: status === "fail",
      residency: { status, summary: "정책 검사 결과", digest: "abc123", items: [{ label: "대상 테이블", detail: "app.public.customers", status }] },
      capacity: { status: "pass", summary: "capacity passed", items: [] },
    } }));
    const residency = s.validations[1];
    expect(residency.status).toBe(({ pass: "허용", fail: "차단", unknown: "확인 불가", skip: "검사 안 함" })[status]);
    expect(residency.summary).toBe("정책 검사 결과");
    expect(residency.evidence).toContain("대상 테이블 · app.public.customers");
    expect(residency.evidence).toContain("정책 digest: abc123");
    expect(residency.evidence.some(x => x.startsWith("검사 시각:"))).toBe(true);
  });

  it.each([["pass", "통과", "ok"], ["fail", "불일치", "no"], ["unknown", "확인 불가", "wa"], ["skip", "검사 안 함", "idle"]] as const)("shows the recorded parity %s with its evidence", (status, label, tone) => {
    const s = snap(view({ preflight: {
      at: at(1), blocked: false,
      residency: { status: "pass", summary: "ok", items: [] },
      capacity: { status: "pass", summary: "ok", items: [] },
      parity: { status, summary: "동등성 기록", digest: "cfg123", items: [{ label: "인증, 권한", detail: "rbac_mismatch", status }] },
    } }));
    const parity = s.validations[0];
    expect(parity.status).toBe(label);
    expect(parity.tone).toBe(tone);
    expect(parity.summary).toBe("동등성 기록");
    if (status === "skip") {
      expect(parity.evidence).toEqual([]);
      return;
    }
    expect(parity.evidence).toContain("인증, 권한: rbac_mismatch");
    expect(parity.evidence).toContain("설정 digest: cfg123");
    expect(parity.evidence.some(x => x.startsWith("검사 시각:"))).toBe(true);
  });

  it("keeps parity as not received when the start record holds no parity record", () => {
    const s = snap(view({ preflight: {
      at: at(1), blocked: false,
      residency: { status: "pass", summary: "ok", items: [] },
      capacity: { status: "pass", summary: "ok", items: [] },
    } }));
    expect(s.validations[0]).toMatchObject({ status: "결과 미수신", tone: "idle" });
  });

  describe("the setup form shows the app's latest earlier start on the validation cards", () => {
    const runId = "moimroom-mig-gke-to-eks-20261107-090542";
    // the start record of 2026-11-07T09:05:42Z: no residency policy, parity recorded but not passed
    const past = () => ({
      runId,
      planRef: "pln_9b4ee0acb2ee",
      view: preflightOf({
        time: "2026-11-07T09:05:42.760231Z",
        detail: {
          capacity: { outcome: "not_configured" },
          residency: "not_configured",
          parity: {
            mode: "audit",
            outcome: "recorded",
            passed: false,
            baselineStatus: "not_configured",
            configDigest: "cfg-real",
            results: [
              "identity unknown identity_policy_incomplete: rbac-self-access-review=unknown(authorization_unavailable), cloud-policy=unknown(cloud_policy_not_configured)",
              "audit unknown probe_not_configured",
              "backup-restore unknown resource_checks_incomplete: backup-config=pass(barman_archiver_configured), restore=unknown(restore_not_verified)",
            ],
          },
        },
      })!,
    });

    it("shows parity as not verifiable with each item, and residency as not checked, marked as an earlier run's", () => {
      const [parity, residency] = snap(view({ stage: "setup", past: past() })).validations;
      expect(parity).toMatchObject({ status: "확인 불가", tone: "wa" });
      expect(parity.summary).toContain("확인하지 못한 항목이 있어");
      expect(parity.evidence[0]).toBe("지난 실행의 기록입니다 (실행 " + runId + ")");
      expect(parity.evidence[1]).toMatch(/^검사 시각: /);
      expect(parity.evidence).toContain("감사 로그: probe_not_configured");
      expect(parity.evidence.some((x) => x.startsWith("인증, 권한: identity_policy_incomplete (rbac-self-access-review=unknown(authorization_unavailable)"))).toBe(true);
      expect(parity.evidence.some((x) => x.startsWith("백업, 복구: resource_checks_incomplete (backup-config=pass("))).toBe(true);
      expect(parity.evidence).toContain("설정 digest: cfg-real");
      expect(residency).toMatchObject({ status: "검사 안 함", tone: "idle", summary: "플랫폼에 레지던시 정책이 설정되지 않아 검사하지 않았습니다" });
      expect(residency.evidence[0]).toBe("지난 실행의 기록입니다 (실행 " + runId + ")");
    });

    it("names the plan when the entry had no run, and keeps the note on a parity card that was skipped", () => {
      const refused = { planRef: "pln_1", view: preflightOf({ time: at(1), detail: { error: "residency_denied", residencyReasons: [] } })! };
      const [parity, residency] = snap(view({ past: refused })).validations;
      expect(parity).toMatchObject({ status: "검사 안 함", evidence: ["지난 실행의 기록입니다 (계획 pln_1)"] });
      expect(residency).toMatchObject({ status: "차단" });
      expect(snap(view({ past: { view: refused.view } })).validations[0].evidence).toEqual(["지난 실행의 기록입니다"]);
    });

    it("leaves the cards as they were without an earlier record, and with a plan's own checks (never mixed)", () => {
      expect(snap(view({ stage: "setup" })).validations.map((x) => x.status)).toEqual(["결과 미수신", "검사 기록 없음"]);
      const own = preflightOf({ time: at(2), detail: { residency: "allowed", parity: { outcome: "recorded", passed: true, results: ["identity pass ok"] } } })!;
      const [parity, residency] = snap(view({ stage: "review", plan: plan(), preflight: own, past: past() })).validations;
      expect(parity).toMatchObject({ status: "통과" });
      expect(residency).toMatchObject({ status: "허용" });
      expect([...parity.evidence, ...residency.evidence].some((x) => x.includes("지난 실행"))).toBe(false);
    });

    it("changes nothing but the cards: a blocked earlier start does not block the setup form", () => {
      const blocked = { runId, view: preflightOf({ time: at(1), detail: { error: "residency_denied", residencyReasons: [] } })! };
      const withPast = snap(view({ stage: "setup", past: blocked }));
      const without = snap(view({ stage: "setup" }));
      expect(withPast.validations[1].status).toBe("차단");
      const { validations: _a, ...rest } = withPast;
      const { validations: _b, ...base } = without;
      expect(rest).toEqual(base);
    });
  });

  describe("what the AI runner really did (GET /v1/ai-activity)", () => {
    const activity = (p: Partial<AIActivity["summary"]> = {}): AIActivity => ({
      since: at(0),
      events: [],
      summary: { modelCalls: 2, model: "claude-sonnet-5-5", tokensIn: 14949, tokensOut: 2578, tools: { get_app: 1, node_capacity: 1, "engine.verify": 1 }, blocked: 9, rehearsals: 1, lastEvent: at(5), ...p },
    });

    it("is null without the activity: demo mode, no log store or a 502 shows no numbers, not zeros", () => {
      expect(aiFacts(undefined)).toBeNull();
      expect(snap(view()).ai).toBeNull();
    });

    it("carries the model, the calls, the tokens, the distinct tools and the refused checks", () => {
      expect(aiFacts(activity(), 60)).toEqual({
        minutes: 60,
        model: "claude-sonnet-5-5",
        calls: 2,
        tokensIn: 14949,
        tokensOut: 2578,
        tools: 3,
        blocked: 9,
        rehearsals: 1,
        lastEvent: at(5),
      });
      expect(buildMapSnapshot(view(), { now: Date.parse(at(30)), ai: activity(), aiMinutes: 120 }).ai?.minutes).toBe(120);
    });

    it("keeps a quiet hour as zeros that were read, with no model and no last event", () => {
      const quiet = activity({ modelCalls: 0, model: undefined, tokensIn: 0, tokensOut: 0, tools: {}, blocked: 0, rehearsals: 0, lastEvent: undefined });
      expect(aiFacts(quiet)).toMatchObject({ calls: 0, model: "", tools: 0, lastEvent: "" });
    });

    it("does not change what the map draws for the run", () => {
      const v = view({ stage: "ai", sessions: [fakeAgentSession({ kind: "plan" })] });
      const a = buildMapSnapshot(v, { now: Date.parse(at(30)) });
      const b = buildMapSnapshot(v, { now: Date.parse(at(30)), ai: activity() });
      expect({ ...b, ai: null }).toEqual(a);
    });
  });

  it("before a plan, nothing is at work and the target is only a candidate", () => {
    const s = snap(view());
    expect(s.cur).toBe(-1);
    expect(s.nodes["aws.app"][0]).toBe("idle");
    expect(s.activity).toBe("none");
    expect(s.actions).toEqual([]);
  });

  describe("setup: what the target already holds", () => {
    // moimroom-mig runs in gke and eks; its database in gke is a replica; moving eks to gke
    const status = (env: string, st: "healthy" | "pending" | "degraded" | "failed", sync = "Synced", health = "Healthy") => ({ env, status: st, syncStatus: sync, healthStatus: health });
    const app = (...status: object[]) => ({ name: "moimroom-mig", namespace: "moimroom-mig", deploy: { instances: [{ name: "moimroom-mig", default: true, status }], status } }) as unknown as App;
    const env = (name: string, databases?: { namespace: string; name: string; instances: number; readyInstances: number; replica: boolean }[]) =>
      ({ name, provider: "gcp", displayName: name, kubeContext: name, gatewayBackend: name, live: false, status: { reachable: true, checkedAt: at(0), databases } }) as Environment;
    const db = { namespace: "moimroom-mig", name: "moimroom-mig-db", instances: 1, readyInstances: 1, replica: true };
    const setup = (ctx: { app?: App; envs?: Environment[] }) => buildMapSnapshot(view({ app: "moimroom-mig", src: "eks", tgt: "gke" }), { now: Date.parse(at(30)), ...ctx });

    it("shows the app and the database that are already there instead of 배포 전 and 생성 전", () => {
      const s = setup({ app: app(status("gke", "healthy"), status("eks", "healthy")), envs: [env("gke", [db, { ...db, namespace: "other", name: "other-db" }]), env("eks")] });
      expect(s.nodes["gcp.app"]).toEqual(["ready", "Synced · Healthy"]);
      expect(s.nodes["gcp.db"]).toEqual(["ready", "replica · 정상"]);
      expect(s.nodes["gcp.cluster"][1]).not.toBe("배포 전");
    });

    it("shows a deployment that is not healthy and a database that is not ready as they are", () => {
      const s = setup({ app: app(status("gke", "degraded", "Synced", "Degraded")), envs: [env("gke", [{ ...db, readyInstances: 0, replica: false }])] });
      expect(s.nodes["gcp.app"]).toEqual(["crit", "Synced · Degraded"]);
      expect(s.nodes["gcp.db"]).toEqual(["busy", "primary · 준비 중 0/1"]);
      expect(setup({ app: app({ env: "gke", status: "pending" }) }).nodes["gcp.app"]).toEqual(["busy", "배포 대기"]);
    });

    it("keeps 배포 전 and 생성 전 where the inputs do not say the target has the app or a database", () => {
      for (const ctx of [
        {},
        { app: app(status("eks", "healthy")), envs: [env("gke"), env("eks", [db])] }, // the app is not in gke, and gke has no database of it
        { app: app(status("eks", "healthy")), envs: [env("gke", [{ ...db, namespace: "other" }])] },
        { app: { name: "moimroom-mig", namespace: "moimroom-mig", environments: [] } as unknown as App }, // a file app: no deployment record
      ]) {
        const s = setup(ctx);
        expect(s.nodes["gcp.app"]).toEqual(["idle", "배포 전"]);
        expect(s.nodes["gcp.db"]).toEqual(["idle", "생성 전"]);
      }
    });

    it("leaves the source and the other stages alone", () => {
      const holds = { app: app(status("gke", "healthy")), envs: [env("gke", [db])] };
      expect(setup(holds).nodes["aws.app"]).toEqual(setup({}).nodes["aws.app"]);
      const planned = buildMapSnapshot(view({ app: "moimroom-mig", stage: "review", plan: plan() }), { now: Date.parse(at(30)), ...holds });
      expect(planned.nodes["aws.app"][0]).toBe("plan");
    });
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
      "ai-plan", "ai-rehearsal", "approve", "preflight", "precheck", "prepare", "presync", "delta", "canary-0", "canary-1", "canary-2", "switch", "fence", "switchover", "start-target", "cutover", "verify", "finalize",
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
    expect(s.actions.map((a) => a.key)).not.toContain("switch");
    expect(s.phases.at(-1)!.key).toBe("rb");
  });

  it("shows an inconclusive canary step (too few requests) as a warning, not a failure", () => {
    const gate = { passed: false, reason: "only 7 requests reached the target (need 20); continuing to the next step", requests: 7, errorRate: 0, p95Millis: 0 };
    const c: Run["canary"] = { options: { weights: [10, 50] }, steps: [{ weight: 10, startedAt: at(1), endedAt: at(2), verdict: "inconclusive", gate }, { weight: 50, startedAt: at(2) }] };
    const ev: RunEvent = { seq: 1, time: at(2), runId: "run_1", kind: "gate_result", data: { weight: 10, verdict: "inconclusive", gate } };
    const s = snap(view({ stage: "run", run: run({ status: "running", phase: "canary", canary: c }), events: [ev] }));
    const p = s.phases.find((x) => x.key === "canary-0")!;
    expect(p.st).toBe("warn");
    expect(p.lines.map(([, cls]) => cls)).toEqual(["w"]);
    expect(s.events.at(-1)!.cls).toBe("w");
    expect(s.phases[s.cur].key).toBe("canary-1");

    const complete: Run["canary"] = { ...c, passed: true, steps: [c.steps[0], { ...c.steps[1], verdict: "ok" }] };
    const waiting = snap(view({ stage: "run", run: run({ status: "awaiting_switch", phase: "awaiting_switch", canary: complete }) }));
    expect(waiting.detail.checks).toContainEqual(["카나리 게이트", "통과 1단계 · 판단 보류 1단계", "wa", "판단 보류"]);
    expect(waiting.actions.map((a) => a.key)).toContain("switch");
  });

  it("shows a recorded failure even when its canary metrics are missing", () => {
    const canary: Run["canary"] = { options: { weights: [10] }, steps: [{ weight: 10, startedAt: at(1), verdict: "failed" }] };
    const s = snap(view({ stage: "run", run: run({ status: "rolled_back", phase: "done", canary }) }));
    expect(s.detail.checks).toContainEqual(["게이트 판정", "실패", "no", "실패"]);
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
    expect(s.actions.map((a) => a.key)).toContain("resume");
  });

  it("shows start-target as done on a warm run and as skipped on a run from before the step existed", () => {
    const st = (steps: Run["engine"]["steps"]) => snap(view({ stage: "run", run: run({ status: "succeeded", phase: "done" }, { steps }) })).phases.find((p) => p.key === "start-target")!.st;
    expect(st({ "start-target": { status: "succeeded" }, cutover: { status: "succeeded" } })).toBe("done");
    expect(st({ cutover: { status: "succeeded" } })).toBe("skip");
    expect(st({})).toBe("todo");
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

describe("migration map: an AI plan that has not passed its rehearsal (platform #24)", () => {
  const blocked = plan({ submittedRole: "agent", rehearsal: { required: true, passed: false, reason: "the rehearsal did not pass: fix the plan and rehearse it again" } });

  it("offers no approve button and says why", () => {
    const s = snap(view({ stage: "review", plan: blocked }));
    expect(s.actions.map((a) => a.key)).toEqual([]);
    expect(s.banners[0].title).toContain("승인할 수 없음");
    expect(s.banners[0].text).toContain("did not pass");
    expect(s.kpi.pill).toEqual(["no", "승인 불가 · 리허설 미통과"]);
  });

  it("says the rehearsal is running while the AI runner has not uploaded its report yet", () => {
    const s = snap(view({ stage: "review", plan: blocked, aiRun: { available: true, running: true, start: noop } }));
    expect(s.actions.map((a) => a.key)).toEqual([]);
    expect(s.banners[0].title).toContain("리허설 중");
    expect(s.kpi.pill).toEqual(["info", "리허설 중"]);
  });

  it("offers approve once the rehearsal passed for this plan", () => {
    const ok = plan({ submittedRole: "agent", rehearsal: { required: true, passed: true } });
    expect(snap(view({ stage: "review", plan: ok })).actions.map((a) => a.key)).toEqual(["approve"]);
  });
});

describe("migration map snapshot: the verify step's evidence on the target", () => {
  const files = { differences: 0, matching: 634, missingOnTarget: 0, ok: true };
  const done = (report: unknown) => {
    const steps = Object.fromEntries(["precheck", "prepare", "presync", "delta", "fence", "switchover", "start-target", "cutover", "verify", "finalize"].map((k) => [k, { status: "succeeded" as const }]));
    if (report !== undefined) steps.verify = { status: "succeeded", evidence: { report } } as (typeof steps)["verify"];
    return snap(view({ stage: "run", plan: plan({ status: "started" }), run: run({ status: "succeeded", phase: "done", endedAt: at(20) }, { outcome: "succeeded", steps, trafficOnTarget: true, promoteRequested: true }) }));
  };

  it("puts the table check on the target DB and the file check on its bucket in place of the role", () => {
    const before = done(undefined);
    expect(before.nodes["aws.db"]).toEqual(["live", "shop-db · primary · 승격됨"]);
    const s = done({ ok: true, missingRows: 0, files, tables: [{ table: "app.spaces", checked: 48, missing: 0 }, { table: "app.reviews", checked: 864, missing: 0 }, { table: "app.audit", checked: 0, missing: 0, skipped: "no primary key" }] });
    expect(s.nodes["aws.db"]).toEqual(["live", "테이블 2개 · 누락 0"]);
    expect(s.nodes["aws.store"]).toEqual(["live", "파일 634개 일치"]);
    // the source keeps its lines
    expect(s.nodes["gcp.db"]).toEqual(before.nodes["gcp.db"]);
  });

  it("marks missing rows, a failed table and differing files", () => {
    expect(done({ tables: [{ table: "app.spaces", checked: 48, missing: 3 }] }).nodes["aws.db"]).toEqual(["crit", "테이블 1개 · 누락 3"]);
    expect(done({ tables: [{ table: "app.spaces", checked: 0, missing: 0, error: "permission denied" }] }).nodes["aws.db"]).toEqual(["crit", "테이블 검증 오류 1개"]);
    expect(done({ files: { differences: 1, matching: 633, missingOnTarget: 2, ok: false } }).nodes["aws.store"]).toEqual(["crit", "파일 차이 3개"]);
  });

  it("shows a missing total without tables, and nothing for a rolled back run", () => {
    expect(done({ ok: false, missingRows: 3, tables: [] }).nodes["aws.db"]).toEqual(["crit", "누락 행 3"]);
    const steps = { verify: { status: "succeeded" as const, evidence: { report: { ok: true, files, tables: [{ table: "app.spaces", checked: 48, missing: 0 }] } } } };
    const s = snap(view({ stage: "run", plan: plan({ status: "started" }), run: run({ status: "rolled_back", phase: "done", endedAt: at(20) }, { outcome: "rolled_back", steps }) }));
    expect(s.nodes["aws.db"][1]).not.toMatch(/테이블/);
    expect(s.nodes["aws.store"][1]).not.toMatch(/파일/);
  });

  it("keeps the DB line while the engine reports no tables", () => {
    const s = done({ ok: true, missingRows: 0, files, tables: [] });
    expect(s.nodes["aws.db"]).toEqual(["live", "shop-db · primary · 승격됨"]);
    expect(s.nodes["aws.store"]).toEqual(["live", "파일 634개 일치"]);
  });
});

