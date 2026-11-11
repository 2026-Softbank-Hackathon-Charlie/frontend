// Migration simulation that speaks the platform contract (src/api/types.ts).
// The pages render PlanRecord, Run, RunEvent, AgentSession and AgentEvent the same way whether
// they come from here or from the real API, so this file is the only place that knows it is a demo.
//
// Clock: one tick is one simulated second, except the cutover (0.2s per tick, the banner says so).
import type {
  AgentEvent,
  AgentEventType,
  AgentSession,
  AgentSessionKind,
  CanaryStep,
  EnginePlan,
  MatrixRoute,
  PlanEndpoint,
  PlanRecord,
  Run,
  RunEvent,
  RunPhase,
  RunResult,
  RunStatus,
  StepRecord,
} from "../api/types";
import { ENV, SAMPLE, STATELESS_SAMPLE, sampleBucket, type EnvKey } from "./data";

/* ---------- engine timeline ---------- */

export interface EngineStep {
  id: string;
  label: string;
  detail: string;
  phase: RunPhase;
  /** seconds on the pre-switch clock (sync) or the post-switch clock (cutover, verify) */
  s: number;
  e: number;
  post: boolean;
}

/** The ten engine steps, in order (EngineState.steps keys). start-target only does work for a cold plan; a warm run skips it. */
export const ENGINE_STEPS: EngineStep[] = [
  { id: "precheck", label: "사전 확인", detail: "두 클러스터, DB, 버킷, 게이트웨이 연결", phase: "sync", s: 0, e: 3, post: false },
  { id: "prepare", label: "대상 준비", detail: "네임스페이스, 비밀값, CNPG 클러스터, Argo CD 동기화", phase: "sync", s: 3, e: 20, post: false },
  { id: "presync", label: "초기 복사", detail: "DB 초기 복사와 파일 rclone sync", phase: "sync", s: 20, e: 55, post: false },
  { id: "delta", label: "변경분 동기화", detail: "복제 지연이 기준 아래로 내려올 때까지", phase: "sync", s: 55, e: 65, post: false },
  { id: "fence", label: "쓰기 보류", detail: "게이트웨이가 쓰기를 붙잡고 원본 쓰기를 막음", phase: "cutover", s: 0, e: 1.2, post: true },
  { id: "switchover", label: "대상 승격", detail: "마지막 변경 반영, 대상 DB 승격", phase: "cutover", s: 1.2, e: 4.5, post: true },
  { id: "start-target", label: "대상 앱 시작", detail: "콜드 모드에서 대상 앱을 띄움, 웜 모드는 할 일 없이 통과", phase: "cutover", s: 4.5, e: 4.5, post: true },
  { id: "cutover", label: "트래픽 전환", detail: "쓰기 대상을 바꾸고 보류한 쓰기 전달", phase: "cutover", s: 4.5, e: 6.8, post: true },
  { id: "verify", label: "검증", detail: "행 수, 기본 키, k6 쓰기 기록, 파일 해시 대조", phase: "verify", s: 6.8, e: 10.4, post: true },
  { id: "finalize", label: "마무리", detail: "원본 축소, 원본은 읽기 전용으로 보존", phase: "verify", s: 10.4, e: 13.6, post: true },
];

const SYNC_END = 65;
const PREPARE_END = 20;
// Read share moves to the target in steps; each step is gated (platform ADR
// 0005). Small steps of a quiet app may be inconclusive; the last step decides.
export interface CanaryPresetSpec {
  weights: number[];
  /** seconds per step; the platform takes 5s to 5m */
  stepSec: number;
}
/**
 * quick (the default) fits a live demo: three steps, about 15 seconds. gradual is the cautious
 * rollout for a production app with enough traffic to judge 1%: seven steps, about 70 seconds.
 */
export const CANARY_PRESETS = {
  quick: { weights: [10, 50, 100], stepSec: 5 },
  gradual: { weights: [1, 10, 25, 50, 75, 90, 100], stepSec: 10 },
} satisfies Record<string, CanaryPresetSpec>;
export type CanaryPreset = keyof typeof CANARY_PRESETS;
export const CANARY_PRESET_ORDER: CanaryPreset[] = ["quick", "gradual"];
export const DEFAULT_CANARY: CanaryPreset = "quick";
/** The simulation runs the default canary. */
export const CANARY: CanaryPresetSpec = CANARY_PRESETS[DEFAULT_CANARY];
/** Pre-switch clock when the run waits for /switch. */
export const SWITCH_AT = SYNC_END + CANARY.weights.length * CANARY.stepSec;
export const POST_END = 13.6;
const HOLD_START = 0.4;
const HOLD_END = 6.8;
const PROMOTE_AT = 1.2;
/** k6 successful writes per simulated second */
export const RATE = 20;

/* ---------- AI timeline (plan → rehearsal → diagnose) ---------- */

export const AI_PLAN_END = 24;
export const AI_END = 70;
const DIAG_START = 52;
const DIAG_END = 57;

type Ev = { at: number; s: "plan" | "rehearsal" | "diagnose"; type: AgentEventType; tool?: string; input?: unknown; output?: unknown; status?: string; ms?: number; tok?: [number, number] };

function aiScript(src: EnvKey, tgt: EnvKey): Ev[] {
  const s = ENV[src];
  const t = ENV[tgt];
  const ns = "sandbox-" + SAMPLE.id + "-7f3a";
  return [
    { at: 1, s: "plan", type: "tool_call", tool: "k8s_get", input: { cluster: s.id, kinds: ["Deployment", "Service", "PersistentVolumeClaim", "Cluster.postgresql.cnpg.io"] } },
    { at: 2, s: "plan", type: "tool_result", tool: "k8s_get", status: "ok", ms: 900, output: { deployments: SAMPLE.services.length, cnpgClusters: 1, pvcs: 2 } },
    { at: 4, s: "plan", type: "tool_call", tool: "db_stats", input: { cluster: SAMPLE.db + "-" + s.id } },
    { at: 5, s: "plan", type: "tool_result", tool: "db_stats", status: "ok", ms: 700, output: { size: SAMPLE.dbSize, tables: SAMPLE.tables, tablesWithoutPk: 0 } },
    { at: 7, s: "plan", type: "tool_call", tool: "bucket_stats", input: { bucket: sampleBucket(src) } },
    { at: 8, s: "plan", type: "tool_result", tool: "bucket_stats", status: "ok", ms: 600, output: { objects: SAMPLE.files } },
    { at: 10, s: "plan", type: "tool_call", tool: "k8s_get", input: { cluster: t.id, kinds: ["StorageClass", "Node"] } },
    { at: 11, s: "plan", type: "tool_result", tool: "k8s_get", status: "ok", ms: 800, output: { storageClasses: [t.sc], freeCpu: 6, freeMemoryGiB: 18 } },
    { at: 15, s: "plan", type: "message", output: "Plan 초안 작성", ms: 4100, tok: [18400, 1900] },
    { at: 16, s: "plan", type: "error", status: "schema", output: "검사 실패: thresholds.switchoverTimeout 없음. 오류를 넣어 다시 요청" },
    { at: 21, s: "plan", type: "message", output: "Plan 다시 작성", ms: 3800, tok: [21000, 1700] },
    { at: 24, s: "plan", type: "decision", status: "ok", output: "검사 통과, Plan 제출" },

    { at: 25, s: "rehearsal", type: "tool_call", tool: "sandbox_apply", input: { namespace: ns, cluster: t.id } },
    { at: 28, s: "rehearsal", type: "tool_result", tool: "sandbox_apply", status: "ok", ms: 2600, output: "샌드박스 생성, ResourceQuota와 NetworkPolicy 적용, 토큰 1시간" },
    { at: 32, s: "rehearsal", type: "blocked", tool: "kubectl", input: { command: "kubectl get secrets -n " + SAMPLE.namespace }, output: "RBAC: 다른 네임스페이스에 접근할 권한 없음" },
    { at: 36, s: "rehearsal", type: "tool_call", tool: "sandbox_apply", input: { release: SAMPLE.id, values: "values-" + t.id + ".yaml", attempt: 1 } },
    { at: 52, s: "rehearsal", type: "tool_result", tool: "sandbox_apply", status: "failed", ms: 15800, output: "PVC " + SAMPLE.db + '-1 Pending: storageclass.storage.k8s.io "' + s.sc + '" not found' },
    { at: 54, s: "diagnose", type: "message", output: "values에 원본 클러스터의 StorageClass " + s.sc + "가 남아 있어 " + t.name + "에서 DB 볼륨이 Pending", ms: 2900, tok: [9600, 600] },
    { at: 56, s: "diagnose", type: "decision", status: "ok", output: { kind: "values-patch", file: "values-" + t.id + ".yaml", patch: [{ op: "replace", path: "/cnpg/storageClass", value: t.sc }] } },
    { at: 58, s: "rehearsal", type: "blocked", tool: "curl", input: { command: "curl http://169.254.169.254/latest/meta-data/" }, output: "NetworkPolicy: 메타데이터 주소로 나가는 통신 차단" },
    { at: 60, s: "rehearsal", type: "tool_call", tool: "sandbox_apply", input: { release: SAMPLE.id, values: "values-" + t.id + ".yaml", attempt: 2 } },
    { at: 66, s: "rehearsal", type: "tool_call", tool: "sandbox_smoke", input: { k6: "30s", rows: 10000 } },
    { at: 68, s: "rehearsal", type: "tool_result", tool: "sandbox_smoke", status: "ok", ms: 7600, output: { rows: "10000/10000", smoke: "12/12", isolation: "3/3 차단" } },
    { at: 70, s: "rehearsal", type: "decision", status: "ok", output: "리허설 통과, 샌드박스 삭제" },
  ];
}

const SESSION_SPAN: Record<Ev["s"], [number, number, AgentSessionKind, string]> = {
  plan: [0, AI_PLAN_END, "plan", "이전 계획"],
  rehearsal: [AI_PLAN_END, AI_END, "rehearsal", "샌드박스 리허설"],
  diagnose: [DIAG_START, DIAG_END, "diagnose", "리허설 실패 진단"],
};

/* ---------- state ---------- */

export interface MigSim {
  /** the app on the page: the sample app, or the one without a database (STATELESS_SAMPLE) */
  app: string;
  src: EnvKey;
  tgt: EnvKey;
  /** setup → ai (plan + rehearsal) → review (plan waits for approval) → run → (back to setup) */
  stage: "setup" | "ai" | "review" | "run";
  /** simulated wall clock in seconds, drives every timestamp */
  now: number;
  aiStart: number;
  aiT: number;
  plan: PlanRecord | null;
  sessions: AgentSession[];
  sessionEvents: Record<string, AgentEvent[]>;
  /** sessions of earlier migrations, newest first, for the AI activity page */
  pastSessions: AgentSession[];
  pastEvents: Record<string, AgentEvent[]>;
  run: Run | null;
  events: RunEvent[];
  /** pre-switch clock and post-switch clock of the current run */
  t: number;
  u: number;
  switched: boolean;
  /** wall clock when the run started */
  runStart: number;
  /** k6 counters */
  ok: number;
  held: number;
  heldDone: number;
  /** finished runs, newest first */
  history: Run[];
  seq: number;
  nextId: number;
}

const BASE = Date.parse("2026-11-06T01:00:00Z");
export const iso = (sec: number) => new Date(BASE + Math.round(sec * 1000)).toISOString();

export function freshMig(src: EnvKey, keep?: MigSim, app?: string): MigSim {
  return {
    app: app ?? keep?.app ?? SAMPLE.id,
    src,
    tgt: (["aws", "gcp", "onprem"] as EnvKey[]).find((k) => k !== src)!,
    stage: "setup",
    now: keep?.now ?? 0,
    aiStart: 0,
    aiT: 0,
    plan: null,
    sessions: [],
    sessionEvents: {},
    pastSessions: keep ? [...keep.sessions, ...keep.pastSessions] : [],
    pastEvents: keep ? { ...keep.pastEvents, ...keep.sessionEvents } : {},
    run: null,
    events: [],
    t: 0,
    u: 0,
    switched: false,
    runStart: 0,
    ok: 0,
    held: 0,
    heldDone: 0,
    history: keep?.history ?? [],
    seq: 0,
    nextId: keep?.nextId ?? 1,
  };
}

const id = (m: MigSim, p: string) => p + "_" + (0x7c2e90 + m.nextId++).toString(16);

/** The app without a database: no AI plan, rehearsal, database pair or files (platform ADR 0018). */
export const isStateless = (m: Pick<MigSim, "app">) => m.app === STATELESS_SAMPLE.id;

/** Engine steps a run of the app without a database skips: there is nothing to copy, replicate, fence or promote. */
export const STATELESS_SKIPS = new Set(["presync", "delta", "fence", "switchover"]);

export function endpoint(k: EnvKey, app: string = SAMPLE.id): PlanEndpoint {
  const e = ENV[k];
  // like the platform's plan without a database: no namespace or cluster, the app named in the summary and the run
  if (app === STATELESS_SAMPLE.id) return { kind: "none", env: e.id, context: e.id, namespace: "", cluster: "" };
  return { env: e.id, context: e.id, namespace: SAMPLE.namespace, cluster: SAMPLE.db + "-" + e.id, dbHost: SAMPLE.db + "-" + e.id + "-rw." + SAMPLE.namespace + "." + e.id + ".ts.net:5432" };
}

/**
 * The Plan without AI for the app without a database (POST /v1/plans/draft, then submit): straight to the approval.
 * The sample app has no such path in the demo; its plan comes from the AI scenario.
 */
export function draftStateless(m: MigSim): void {
  if (!isStateless(m) || m.stage !== "setup") return;
  m.sessions = [];
  m.sessionEvents = {};
  m.plan = {
    ref: id(m, "pln"),
    status: "pending_approval",
    revision: 1,
    summary: { app: m.app, planId: m.app + "-" + ENV[m.src].id + "-to-" + ENV[m.tgt].id, source: endpoint(m.src, m.app), target: endpoint(m.tgt, m.app), files: false, gatewayMode: "http", fenceGate: false, maxDowntime: "30s" },
    submittedBy: "operator",
    submittedRole: "operator",
    submittedAt: iso(m.now),
    attachments: [],
  };
  m.stage = "review";
}

/* ---------- AI ---------- */

export function startAi(m: MigSim): void {
  m.stage = "ai";
  m.aiStart = m.now;
  m.aiT = 0;
  m.sessions = [];
  m.sessionEvents = {};
  m.plan = null;
}

function session(m: MigSim, key: Ev["s"]): AgentSession {
  const [s, , kind, title] = SESSION_SPAN[key];
  let ses = m.sessions.find((x) => x.kind === kind);
  if (!ses) {
    ses = {
      id: id(m, "ags"),
      kind,
      title: SAMPLE.id + " " + title + " (" + ENV[m.src].short + " → " + ENV[m.tgt].short + ")",
      actor: "ai-agent",
      planRef: m.plan?.ref,
      model: "claude-opus-5-5",
      status: "running",
      createdAt: iso(m.aiStart + s),
      totals: { events: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMillis: 0 },
    };
    m.sessions.unshift(ses);
    m.sessionEvents[ses.id] = [];
  }
  return ses;
}

function aiTick(m: MigSim): void {
  const prev = m.aiT;
  m.aiT += 1;
  for (const ev of aiScript(m.src, m.tgt)) {
    if (ev.at <= prev || ev.at > m.aiT) continue;
    const ses = session(m, ev.s);
    const list = m.sessionEvents[ses.id];
    const e: AgentEvent = { seq: list.length + 1, sessionId: ses.id, time: iso(m.aiStart + ev.at), type: ev.type };
    if (ev.tool) e.tool = ev.tool;
    if (ev.input !== undefined) e.input = ev.input;
    if (ev.output !== undefined) e.output = ev.output;
    if (ev.status) e.status = ev.status;
    if (ev.ms) e.durationMillis = ev.ms;
    if (ev.tok) e.usage = { inputTokens: ev.tok[0], outputTokens: ev.tok[1] };
    list.push(e);
    const tt = ses.totals;
    tt.events++;
    if (ev.type === "tool_call") tt.toolCalls++;
    tt.inputTokens += ev.tok?.[0] ?? 0;
    tt.outputTokens += ev.tok?.[1] ?? 0;
    tt.durationMillis += ev.ms ?? 0;
  }
  // sessions end, the plan is submitted, the fix is attached
  for (const key of ["plan", "rehearsal", "diagnose"] as const) {
    const [, e, kind] = SESSION_SPAN[key];
    const ses = m.sessions.find((x) => x.kind === kind);
    if (ses && ses.status === "running" && m.aiT >= e) {
      ses.status = "succeeded";
      ses.endedAt = iso(m.aiStart + e);
      ses.summary = { plan: "Plan 제출, 검사 2회 중 2회차 통과", rehearsal: "2회차 통과, 막힌 명령 2건", diagnose: "StorageClass 수정안 1건", other: "", explain: "" }[kind];
    }
  }
  if (prev < AI_PLAN_END && m.aiT >= AI_PLAN_END) {
    m.plan = {
      ref: id(m, "pln"),
      status: "pending_approval",
      revision: 1,
      summary: {
        planId: SAMPLE.id + "-" + ENV[m.src].id + "-to-" + ENV[m.tgt].id,
        source: endpoint(m.src),
        target: endpoint(m.tgt),
        files: true,
        gatewayMode: "http",
        fenceGate: true,
        maxDowntime: "30s",
      },
      submittedBy: "ai-agent",
      submittedAt: iso(m.aiStart + AI_PLAN_END),
      attachments: [],
    };
    for (const s of m.sessions) s.planRef = m.plan.ref;
  }
  if (m.plan && prev < DIAG_END && m.aiT >= DIAG_END) {
    m.plan.revision++;
    m.plan.attachments = [{ name: "values-" + ENV[m.tgt].id + ".yaml", size: 412, sha256: "9b1f0c6a5d3e" + "0".repeat(52) }];
  }
  if (m.aiT >= AI_END) m.stage = "review";
}

/** The engine plan behind the simulated PlanRecord (EnginePlan). DSNs are `${VAR}` references the server expands. */
export function enginePlan(src: EnvKey, tgt: EnvKey, app: string = SAMPLE.id): EnginePlan {
  const s = ENV[src];
  const t = ENV[tgt];
  if (app === STATELESS_SAMPLE.id) {
    const none = (e: typeof s) => ({ kind: "none" as const, env: e.id, context: e.id, namespace: STATELESS_SAMPLE.namespace, cluster: "", dsn: "" });
    return { id: app + "-" + s.id + "-to-" + t.id, source: none(s), target: none(t), gateway: { mode: "http", sourceBackend: s.id, targetBackend: t.id } };
  }
  const ep = (e: typeof s) => ({ env: e.id, context: e.id, namespace: SAMPLE.namespace, cluster: SAMPLE.db + "-" + e.id, dsn: "${" + SAMPLE.id.toUpperCase() + "_DSN_" + e.id.toUpperCase() + "}" });
  return {
    id: SAMPLE.id + "-" + s.id + "-to-" + t.id,
    source: ep(s),
    target: { ...ep(t), manifest: "attachment:values-" + t.id + ".yaml" },
    files: { source: sampleBucket(src), target: sampleBucket(tgt) },
    gateway: { mode: "http", sourceBackend: s.id, targetBackend: t.id },
    verify: { schemas: [SAMPLE.schema], fenceGate: true, writtenRecords: "stream:" + SAMPLE.id + "-k6" },
    thresholds: { maxLagBytes: 1048576, catchupTimeout: "10m", switchoverTimeout: "2m", maxDowntime: "30s" },
  };
}

/** The AI's values fix, as a unified diff. */
export function fixDiff(src: EnvKey, tgt: EnvKey): { file: string; minus: string; plus: string } {
  return { file: "values-" + ENV[tgt].id + ".yaml", minus: "  storageClass: " + ENV[src].sc, plus: "  storageClass: " + ENV[tgt].sc };
}

/* ---------- review ---------- */

export type ReviewResult = "ok" | "stale" | "invalid";

/** Approve with the revision the operator saw (like POST /v1/plans/{ref}/approve). */
export function approve(m: MigSim, revision: number): ReviewResult {
  if (!m.plan || m.plan.status !== "pending_approval" || m.stage !== "review") return "invalid";
  if (revision !== m.plan.revision) return "stale";
  m.plan.status = "approved";
  m.plan.reviewedBy = "operator";
  m.plan.reviewedAt = iso(m.now);
  return "ok";
}

export function reject(m: MigSim, comment?: string): void {
  if (!m.plan || m.plan.status !== "pending_approval") return;
  m.plan.status = "rejected";
  m.plan.reviewedBy = "operator";
  m.plan.reviewedAt = iso(m.now);
  if (comment) m.plan.reviewComment = comment;
}

/* ---------- run ---------- */

function emit(m: MigSim, kind: string, message: string, extra: Partial<RunEvent> = {}): void {
  if (!m.run) return;
  m.events.push({ seq: ++m.seq, time: iso(m.now), runId: m.run.runId, kind, message, ...extra });
}

function setStatus(m: MigSim, status: RunStatus, phase: RunPhase, reason = ""): void {
  const r = m.run!;
  if (r.status === status && r.phase === phase) return;
  r.status = status;
  r.phase = phase;
  r.statusReason = reason || undefined;
  emit(m, "status_changed", statusText(status, phase), { data: { status, phase, reason } });
}

/** Start the approved plan (like POST /v1/migrations). */
export function start(m: MigSim, opts: { rollbackOf?: string; autoSwitch?: boolean } = {}): void {
  if (!opts.rollbackOf && m.plan?.status !== "approved") return;
  const runId = id(m, "run");
  if (m.plan) {
    m.plan.status = "started";
    m.plan.runId = runId;
  }
  const steps: Record<string, StepRecord> = {};
  for (const s of ENGINE_STEPS) steps[s.id] = { status: "pending" };
  m.stage = "run";
  m.t = 0;
  m.u = 0;
  m.switched = false;
  m.runStart = m.now;
  m.ok = 0;
  m.held = 0;
  m.heldDone = 0;
  m.events = [];
  m.seq = 0;
  m.run = {
    runId,
    planRef: m.plan?.ref ?? "",
    planId: m.plan?.summary.planId ?? "",
    ...(isStateless(m) ? { app: m.app } : {}),
    source: endpoint(m.src, m.app),
    target: endpoint(m.tgt, m.app),
    status: "running",
    phase: "sync",
    autoSwitch: !!opts.autoSwitch,
    canary: { options: { weights: CANARY.weights, stepDuration: CANARY.stepSec + "s" }, steps: [] },
    startedBy: "operator",
    startedAt: iso(m.now),
    updatedAt: iso(m.now),
    result: {},
    rollbackOf: opts.rollbackOf,
    engine: {
      runId,
      planId: m.plan?.summary.planId ?? "",
      createdAt: iso(m.now),
      updatedAt: iso(m.now),
      outcome: "running",
      steps,
      writesHeld: false,
      sourceDemoted: false,
      promoteRequested: false,
      trafficOnTarget: false,
    },
  };
  emit(m, "status_changed", statusText("running", "sync"), { data: { status: "running", phase: "sync", reason: "" } });
}

export function canSwitch(m: MigSim): boolean {
  return m.run?.status === "awaiting_switch";
}
export function canAbort(m: MigSim): boolean {
  const r = m.run;
  return !!r && (r.status === "running" || r.status === "awaiting_switch") && !r.engine.promoteRequested;
}

export function doSwitch(m: MigSim): void {
  if (!canSwitch(m)) return;
  const r = m.run!;
  r.switchApprovedBy = "operator";
  r.switchApprovedAt = iso(m.now);
  m.switched = true;
  setStatus(m, "running", "cutover");
}

export function abort(m: MigSim, reason = "운영자가 중단"): void {
  if (!canAbort(m)) return;
  const r = m.run!;
  r.abortedBy = "operator";
  r.abortReason = reason;
  setStatus(m, "aborted", r.phase, reason);
}

export function resume(m: MigSim): void {
  const r = m.run;
  if (!r || (r.status !== "aborted" && r.status !== "failed" && r.status !== "interrupted")) return;
  setStatus(m, m.t >= SWITCH_AT && !m.switched && !r.autoSwitch ? "awaiting_switch" : "running", r.phase);
}

/** 1-click rollback of a succeeded run: a new run from the old target back to the old source. */
export function rollback(m: MigSim): void {
  const r = m.run;
  if (!r || r.status !== "succeeded") return;
  const back = freshMig(m.tgt, m);
  back.tgt = m.src;
  back.plan = {
    ref: id(back, "pln"),
    status: "approved",
    revision: 1,
    rollbackOf: r.runId,
    summary: { ...(m.plan?.summary ?? { ...(r.app ? { app: r.app } : {}), planId: r.planId, files: !isStateless(m), gatewayMode: "http", fenceGate: !isStateless(m), maxDowntime: "30s" }), source: endpoint(m.tgt, m.app), target: endpoint(m.src, m.app), planId: r.planId + "-rollback" },
    submittedBy: "operator",
    submittedAt: iso(m.now),
  };
  Object.assign(m, back);
  start(m, { rollbackOf: r.runId, autoSwitch: true });
}

function stepAt(m: MigSim, s: EngineStep): "pending" | "running" | "succeeded" {
  const clock = s.post ? (m.switched ? m.u : -1) : m.t;
  return clock >= s.e - 1e-9 ? "succeeded" : clock >= s.s - 1e-9 ? "running" : "pending";
}

/** Advance the run by one tick. Returns true when it just ended. */
function runTick(m: MigSim): boolean {
  const r = m.run;
  if (!r || (r.status !== "running" && r.status !== "awaiting_switch")) return false;
  if (r.status === "awaiting_switch") {
    m.ok += RATE; // load keeps flowing while we wait
    r.result = { ...r.result, ...liveResult(m) };
    r.updatedAt = iso(m.now);
    return false;
  }
  const dt = m.switched ? 0.2 : 1;
  const prevT = m.t;
  const prevU = m.u;
  const stateless = isStateless(m);
  if (m.switched) m.u = Math.round((m.u + dt) * 10) / 10;
  else m.t += dt;
  // without a database there is nothing to copy: the canary follows the target's preparation
  if (stateless && m.t > PREPARE_END && m.t < SYNC_END) m.t = SYNC_END;

  // k6 writes: held at the gateway during the fence, otherwise served; an app without a database is not fenced
  const holding = !stateless && m.switched && m.u > HOLD_START && m.u <= HOLD_END;
  if (holding) m.held += RATE * dt;
  else m.ok += RATE * dt;

  // engine steps
  for (const s of ENGINE_STEPS) {
    const rec = r.engine.steps[s.id];
    const st = stepAt(m, s);
    if (stateless && STATELESS_SKIPS.has(s.id)) {
      if (st !== "pending" && rec.status === "pending") {
        // the record has no skipped state: the step passes, and its step_skipped event says it did nothing
        rec.status = "succeeded";
        rec.startedAt = rec.endedAt = iso(m.now);
        emit(m, "step_skipped", s.label + " 건너뜀 (DB 없음)", { step: s.id });
      }
      continue;
    }
    if (st !== "pending" && rec.status === "pending") {
      rec.status = "running";
      rec.startedAt = iso(m.now);
      emit(m, "step_started", s.label + " 시작", { step: s.id });
    }
    if (st === "succeeded" && rec.status === "running") {
      rec.status = "succeeded";
      rec.endedAt = iso(m.now);
      if (s.id === "verify") rec.evidence = { report: verifyReport(m) };
      emit(m, "step_succeeded", s.label + " 완료", { step: s.id, data: { durationMillis: Math.round((s.e - s.s) * 1000) } });
    }
  }

  if (!m.switched) {
    if (!stateless && m.t > 55 && m.t <= SYNC_END && (m.t % 2 === 0 || m.t === SYNC_END)) {
      const lag = Math.max(0, Math.round((48000 * (SYNC_END - m.t)) / 10));
      emit(m, "metric", "복제 지연 " + lag.toLocaleString("ko-KR") + " B", { step: "delta", data: { lagBytes: lag } });
    }
    // canary: read share on the target, one step per weight, gate at the end of each step
    CANARY.weights.forEach((w, i) => {
      const s = SYNC_END + i * CANARY.stepSec;
      const e = s + CANARY.stepSec;
      if (prevT < s && m.t >= s) {
        if (i === 0) setStatus(m, "running", "canary");
        const step: CanaryStep = { weight: w, startedAt: iso(m.now) };
        r.canary!.steps.push(step);
        emit(m, "canary_step", "읽기 " + w + "%를 대상으로", { data: { weight: w, readWeights: { [ENV[m.src].id]: 100 - w, [ENV[m.tgt].id]: w } } });
      }
      if (prevT < e && m.t >= e) {
        const step = r.canary!.steps[i];
        step.endedAt = iso(m.now);
        // About 30 reads/s: the 1% step sees too few requests to judge, like a real quiet app.
        const requests = Math.round(CANARY.stepSec * 30 * (w / 100));
        const judged = requests >= 20 || i === CANARY.weights.length - 1;
        step.verdict = judged ? "ok" : "inconclusive";
        step.gate = judged
          ? { passed: true, reason: requests + " requests, error rate 0.00%, p95 " + (118 + i * 9) + "ms", requests, errorRate: 0, p95Millis: 118 + i * 9 }
          : { passed: false, reason: "only " + requests + " requests reached the target (need 20); continuing to the next step", requests, errorRate: 0, p95Millis: 0 };
        emit(m, "gate_result", (judged ? "게이트 통과" : "판단 보류") + " (읽기 " + w + "%)", { data: { weight: w, verdict: step.verdict, gate: step.gate } });
      }
    });
    if (prevT < SWITCH_AT && m.t >= SWITCH_AT) {
      r.canary!.passed = true;
      if (r.autoSwitch) {
        m.switched = true;
        setStatus(m, "running", "cutover");
      } else setStatus(m, "awaiting_switch", "awaiting_switch");
    }
  } else {
    const e = r.engine;
    if (stateless) {
      // no fence and no promotion: the gateway moves the writes at the cutover
      if (prevU < HOLD_END && m.u >= HOLD_END) e.trafficOnTarget = true;
    } else if (prevU <= HOLD_START && m.u > HOLD_START) {
      e.writesHeld = true;
      e.writesHeldAt = iso(m.now);
    }
    if (!stateless && prevU < PROMOTE_AT && m.u >= PROMOTE_AT) {
      e.sourceDemoted = true;
      e.promoteRequested = true;
      e.fenceLsn = "0/3A2F1C8";
    }
    if (!stateless && prevU < HOLD_END && m.u >= HOLD_END) {
      e.writesHeld = false;
      e.trafficOnTarget = true;
      e.downtimeMillis = Math.round((HOLD_END - HOLD_START) * 1000);
      m.ok += m.held;
      m.heldDone = m.held;
      m.held = 0;
      emit(m, "metric", "쓰기 보류 " + (e.downtimeMillis / 1000).toFixed(1) + "초, 보류한 쓰기 " + Math.round(m.heldDone).toLocaleString("ko-KR") + "건 전달", { data: { downtimeMillis: e.downtimeMillis } });
      r.result.downtimeMillis = e.downtimeMillis;
    }
    const verifyAt = ENGINE_STEPS.find((s) => s.id === "verify")!.s;
    if (prevU < verifyAt && m.u >= verifyAt) setStatus(m, "running", "verify");
  }

  r.result = { ...r.result, ...liveResult(m) };
  r.updatedAt = r.engine.updatedAt = iso(m.now);

  if (m.switched && m.u >= POST_END - 1e-9) {
    r.endedAt = iso(m.now);
    r.engine.outcome = "succeeded";
    // an app without a database or files has no rows, writes or files to compare
    r.result = { ...r.result, failedRequests: 0, ...(stateless ? {} : { missingRows: 0, missingWrites: 0, missingFiles: 0 }), verified: true };
    emit(m, "done", "이전 완료", { data: { downtimeMillis: r.result.downtimeMillis } });
    setStatus(m, "succeeded", "done", "트래픽과 데이터가 대상에 있고 검증됨");
    return true;
  }
  return false;
}

// MOCK: 테이블은 moimroom의 app 스키마(internal/store/schema.sql) 다섯 개이고 행 수는 시뮬레이션 수치다.
const SAMPLE_ROWS: [table: string, rows: number][] = [
  ["spaces", 48],
  ["space_photos", 212],
  ["reservations", 3120],
  ["reservation_slots", 9360],
  ["reviews", 864],
];

/** The verify step's report, shaped like the engine's (pkg/verify): the reservations k6 wrote during the run are on the target too. */
function verifyReport(m: MigSim): Record<string, unknown> {
  const tables = SAMPLE_ROWS.map(([t, rows]) => ({ table: SAMPLE.schema + "." + t, checked: t === "reservations" ? rows + Math.round(m.ok) : rows, missing: 0 }));
  return {
    ok: true,
    missingRows: 0,
    tables,
    files: { matching: SAMPLE.files, differences: 0, missingOnTarget: 0, ok: true },
  };
}

function liveResult(m: MigSim): RunResult {
  return {
    durationMillis: Math.round((m.now - m.runStart) * 1000),
    requests: Math.round(m.ok * 4),
    failedRequests: 0,
  };
}

/** One simulation tick. Returns the run that just ended, if any. */
export function migTick(m: MigSim): Run | null {
  if (m.stage === "ai") {
    m.now += 1;
    aiTick(m);
    return null;
  }
  if (m.stage === "run" && m.run && (m.run.status === "running" || m.run.status === "awaiting_switch")) {
    m.now += m.switched ? 0.2 : 1;
    if (runTick(m)) {
      m.history.unshift(structuredClone(m.run));
      return m.run;
    }
    return null;
  }
  m.now += 1;
  return null;
}

/* ---------- derived ---------- */

export function statusText(s: RunStatus, p?: RunPhase): string {
  switch (s) {
    case "running":
      return p ? PHASE_LABEL[p] + " 중" : "진행 중";
    case "awaiting_switch":
      return "전환 승인 대기";
    case "succeeded":
      return "성공";
    case "rolled_back":
      return "원복됨";
    case "halted":
      return "정지 (운영자 판단 필요)";
    case "failed":
      return "실패 (이어서 실행 가능)";
    case "aborted":
      return "중단됨 (이어서 실행 가능)";
    case "interrupted":
      return "서버 재시작으로 멈춤 (이어서 실행 가능)";
  }
}

export const PHASE_LABEL: Record<RunPhase, string> = {
  sync: "동기화",
  canary: "카나리",
  awaiting_switch: "전환 승인 대기",
  cutover: "전환",
  verify: "검증",
  observe: "전환 후 관찰",
  done: "완료",
};

/** Read share on the target (%), from the canary steps and the cutover. */
export function targetReadShare(r: Run): number {
  if (r.engine.trafficOnTarget) return 100;
  const steps = r.canary?.steps ?? [];
  const last = steps[steps.length - 1];
  return last ? last.weight : 0;
}

/** The finished runs of the app on screen: the app without a database names itself in `app`, the sample app's runs do not. */
export function appHistory(m: Pick<MigSim, "history" | "app">): Run[] {
  return m.history.filter((r) => (r.app ?? SAMPLE.id) === m.app);
}

export function matrixRoutes(m: MigSim): MatrixRoute[] {
  return appHistory(m).map((r) => ({ source: r.source.env, target: r.target.env, runId: r.runId, status: r.status, finishedAt: r.endedAt, result: r.result }));
}

/** Every AI session so far, newest first. */
export function allSessions(m: MigSim): { sessions: AgentSession[]; events: Record<string, AgentEvent[]> } {
  return { sessions: [...m.sessions, ...m.pastSessions], events: { ...m.pastEvents, ...m.sessionEvents } };
}

export function migCounters(m: MigSim): { ok: number; held: number; heldDone: number } {
  return { ok: m.ok, held: m.held, heldDone: m.heldDone };
}
