// One view of a migration for the page, from the simulation or the platform API.
// Both sides hand over contract types (PlanRecord, Run, AgentSession, ...), so the page has one code path.
import { useEffect, useMemo, useState } from "react";
import {
  abortMigration,
  ApiError,
  approvePlan,
  draftPlan,
  getAgentSession,
  listAgentEvents,
  listAudit,
  newIdempotencyKey,
  rejectPlan,
  resumeMigration,
  rollbackMigration,
  startAIRun,
  startMigration,
  submitPlan,
  switchMigration,
} from "../api/client";
import { isAfter, useAgentSession, useAgentSessions, useAIRuns, useApp, useApps, useEnvironments, useRun, useRuns, useTraffic } from "../api/hooks";
import type { AgentEvent, AgentSession, AIRun, App, AppDBReadiness, AppDBTopology, EnginePlan, Environment, PlanRecord, Run, RunEvent, StartMigrationRequest } from "../api/types";
import { ENV, ENV_ORDER, SAMPLE, envKeyOf, type EnvKey } from "../sim/data";
import { CANARY_PRESETS, DEFAULT_CANARY, enginePlan, fixDiff, iso, migCounters, type CanaryPreset } from "../sim/mig";
import { useSim } from "../sim/store";
import { errorText, usePlans } from "./live";
import { isDatabaselessApp, migrationEnvironments } from "./migrationMembership";
import { AUDIT_PAGE, latestPreflight, latestPreflightOfApp, preflightOf, searchAudit, type PastPreflight, type PreflightView } from "./preflight";

export interface EnvOption {
  value: string;
  label: string;
}

export interface MigrationTargetOption extends EnvOption {
  /** false is a discoverable platform environment that this app has not been added to. */
  registered?: boolean;
}

/**
 * What the operator chooses for a start. Observe keeps judging the target at the gateway after the
 * cutover; with autoRollback the platform starts the rollback itself (actor slo-guard) on a breach.
 * The gate thresholds stay at the platform's defaults.
 */
/** Within the platform's 10s to 30m, each at least one observe step long. */
export const OBSERVE_DURATIONS = ["1m", "2m", "5m", "10m"] as const;

/**
 * One observe gate window after cutover. Kept apart from the canary step: the gradual canary uses
 * short steps, while a rollback after cutover is a full migration back and should be judged on a
 * longer window.
 */
export const OBSERVE_STEP = "20s";
export type ObserveDuration = (typeof OBSERVE_DURATIONS)[number];

export interface StartOptions {
  /** read canary steps before the switch (CANARY_PRESETS) */
  canary: CanaryPreset;
  observe: boolean;
  /** total observation time */
  duration: ObserveDuration;
  autoRollback: boolean;
}

export const DEFAULT_START: StartOptions = { canary: DEFAULT_CANARY, observe: false, duration: "2m", autoRollback: false };

/**
 * The gate the platform applies when a start names none, which the console never does.
 * Copied from the platform's gateWithDefaults (internal/runs/observe.go) and the
 * GateThresholds defaults in api/openapi.yaml: change them together.
 */
export const PLATFORM_GATE = { maxErrorRate: 0.01, maxP95Millis: 800, minRequests: 20 } as const;

/**
 * The start request for a plan. Canary and observe both need the platform gateway (mode http), and
 * the platform refuses either otherwise, so a plan without it starts with neither.
 */
export function startRequest(planRef: string, gatewayMode: string | undefined, o: StartOptions): StartMigrationRequest {
  if (gatewayMode !== "http") return { planRef };
  const c = CANARY_PRESETS[o.canary];
  const req: StartMigrationRequest = { planRef, canary: { weights: [...c.weights], stepDuration: c.stepSec + "s" } };
  if (o.observe) req.observe = { duration: o.duration, stepDuration: OBSERVE_STEP, autoRollback: o.autoRollback };
  return req;
}

export interface MigrationView {
  live: boolean;
  app: string;
  /** setup → ai (plan and rehearsal) → review (plan waits for approval) → run */
  stage: "setup" | "ai" | "review" | "run";
  src: string;
  tgt: string;
  srcLabel: string;
  /** live, before a plan: why the source is not the gateway's write backend (the gateway did not answer) */
  srcNote?: string;
  tgtLabel: string;
  targets: MigrationTargetOption[];
  /** The setup screen distinguishes a cluster existing from this app having a database there. */
  targetSetup?: { registered: boolean; addHref?: string; status?: Environment["status"] };
  targetsError?: string;
  /** Missing deployment/DB preparation blocks planning while keeping this app selectable. */
  preparation?: string;
  setTarget(v: string): void;
  /** live: registered apps and configured file apps, including ones still needing migration preparation */
  apps?: EnvOption[];
  gkeDemoApp?: string;
  setApp?(name: string): void;
  /** the app exists and can be migrated */
  ready: boolean;
  /** live, before a plan: what the app's database pair readiness says (deploy.dbTopology.readiness, ADR 0037) */
  pairCheck?: PairCheck;
  /** live: shows the app's run `id` (pairCheck.runId) instead of the setup form */
  openRun?(id: string): void;
  plan?: PlanRecord;
  /** the engine plan the record was made from, when known */
  engine?: EnginePlan;
  sessions: AgentSession[];
  /** events of one AI session; the live side follows the selected one and reads the others' stored events */
  sessionEvents(id: string): AgentEvent[];
  /** live: some sessions' stored events have not loaded (yet, or failed), so counts over all sessions are partial */
  sessionsPartial?: boolean;
  selectSession(id: string): void;
  /** the AI's values fix, shown as a diff (simulation; live plans carry it as an attachment) */
  fix?: { file: string; minus: string; plus: string };
  run?: Run;
  /** the app's newest run when it has ended, for the list while no run is on screen */
  lastRun?: Run;
  /** epoch ms that lastRun's times are read against: the simulation's clock in the demo, else the wall clock */
  now?: number;
  events: RunEvent[];
  /** Live run stream health; ended streams close normally. */
  stream?: { connected: boolean; error?: string };
  /** k6 counters, simulation only */
  counters?: { ok: number; held: number; heldDone: number };
  /** the platform's residency and capacity checks of the latest start or rollback of this plan */
  preflight?: PreflightView;
  /** live, no plan on screen: the checks of this app's latest earlier start or rollback (an earlier run, not this plan's) */
  past?: PastPreflight;
  /** start options of the plan on screen; the simulation does not model observe and leaves them out */
  start?: { options: StartOptions; set(o: StartOptions): void };
  busy: boolean;
  notice: string;
  /** the AI runner on the platform (POST /v1/ai-runs); absent in the simulation */
  aiRun?: AIRunView;
  makePlan(): void;
  approve(): void;
  reject(): void;
  doSwitch(): void;
  abort(): void;
  resume(): void;
  rollback(): void;
  reset(): void;
}

// The live hook fetches as soon as it mounts, so pages mount it only in live mode (see LiveOnly in pages).

/* ---------- simulation ---------- */

// The checks a simulated start passes, in the shape the platform writes to the audit log.
// Numbers are fictional like every simulated value (top banner).
function simPreflight(time: string): PreflightView | undefined {
  return preflightOf({
    time,
    detail: {
      residency: "allowed",
      capacity: {
        allowed: true,
        checks: ["connections pass ok: -", "catchup pass caught_up: -", "initial_copy info measured: -"],
        measurements: {
          sourceBytes: 2.1 * 1024 ** 3,
          walBytesPerSecond: 0.4 * 1024 ** 2,
          sourceSessions: 18,
          targetMaxConnections: 100,
          targetMaxConnectionsFrom: "target",
          lagBefore: 3.2 * 1024 ** 2,
          lagAfter: 0.9 * 1024 ** 2,
          window: 5e9,
        },
      },
    },
  });
}

export function useSimMigration(): MigrationView {
  const { S, dispatch } = useSim();
  const m = S.mig;
  const app = S.apps[SAMPLE.id];
  return {
    live: false,
    app: SAMPLE.id,
    stage: m.stage,
    src: m.src,
    tgt: m.tgt,
    srcLabel: ENV[m.src].name,
    tgtLabel: ENV[m.tgt].name,
    targets: ENV_ORDER.filter((k) => k !== m.src).map((k) => ({ value: k, label: ENV[k].name })),
    setTarget: (v) => dispatch({ type: "mig-target", env: v as EnvKey }),
    ready: !!app,
    plan: m.plan ?? undefined,
    engine: m.plan ? enginePlan(m.src, m.tgt) : undefined,
    sessions: m.sessions,
    sessionEvents: (id) => m.sessionEvents[id] ?? [],
    selectSession: () => {},
    fix: m.plan?.attachments?.length ? fixDiff(m.src, m.tgt) : undefined,
    run: m.run ?? undefined,
    lastRun: m.history[0],
    now: Date.parse(iso(m.now)),
    events: m.events,
    counters: migCounters(m),
    preflight: m.run ? simPreflight(m.run.startedAt) : undefined,
    busy: false,
    notice: S.migNotice,
    makePlan: () => dispatch({ type: "mig-plan" }),
    approve: () => m.plan && dispatch({ type: "mig-approve", revision: m.plan.revision }),
    reject: () => dispatch({ type: "mig-reject" }),
    doSwitch: () => dispatch({ type: "mig-switch" }),
    abort: () => dispatch({ type: "mig-abort" }),
    resume: () => dispatch({ type: "mig-resume" }),
    rollback: () => dispatch({ type: "mig-rollback" }),
    reset: () => dispatch({ type: "mig-new" }),
  };
}

/* ---------- platform API ---------- */

/**
 * The pre-start checks of the plan's latest start or rollback, from the audit log.
 * Read once per plan, run or start attempt (`attempt` changes with each Idempotency-Key)
 * and on reload(); the audit log is append-only, so nothing to poll in between.
 */
function usePreflight(planRef: string | null, runId: string | null, attempt: string): { data?: PreflightView; reload: () => void } {
  const [data, setData] = useState<PreflightView | undefined>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!planRef) {
      setData(undefined);
      return;
    }
    const ctrl = new AbortController();
    // the start sinks in the log under refused requests, so the search goes back a few pages
    searchAudit((before) => listAudit({ limit: AUDIT_PAGE, before }, { signal: ctrl.signal }), (entries) => latestPreflight(entries, planRef))
      .then((view) => !ctrl.signal.aborted && setData(view))
      .catch(() => {}); // a viewer without audit access just sees no checks
    return () => ctrl.abort();
  }, [planRef, runId, attempt, nonce]);
  return { data, reload: () => setNonce((n) => n + 1) };
}

/**
 * While no plan is on screen (the setup form, also after a run succeeded, which the page does not stay on): the
 * checks of the app's latest earlier start or rollback. The app's runs and plans (by their ids, joined into `own`)
 * tell its audit entries from another app's. Past entries do not change, so it reads again only when the app gets
 * a run or plan of its own.
 */
function usePastPreflight(active: boolean, own: { runIds: string[]; planRefs: string[] }): PastPreflight | undefined {
  const [data, setData] = useState<PastPreflight | undefined>();
  const key = own.runIds.join(",") + "|" + own.planRefs.join(",");
  useEffect(() => {
    setData(undefined);
    if (!active || key === "|") return;
    const ctrl = new AbortController();
    searchAudit((before) => listAudit({ limit: AUDIT_PAGE, before }, { signal: ctrl.signal }), (entries) => latestPreflightOfApp(entries, own))
      .then((past) => !ctrl.signal.aborted && setData(past))
      .catch(() => {});
    return () => ctrl.abort();
    // `own` is a function of `key`
  }, [active, key]);
  return data;
}

const ACTIVE = new Set(["running", "awaiting_switch"]);
/**
 * Whether the platform counts a run as a migration in progress (migration_in_progress), by the rule POST
 * /v1/migrations uses to refuse another run: running or awaiting its switch, and not ended. A run that ended halted
 * (phase done, endedAt) or was interrupted holds no cluster, and a new migration may start.
 */
export function runInProgress(r: Run): boolean {
  return ACTIVE.has(r.status) && !r.endedAt && r.phase !== "done";
}

/*
 * The AI runner (ai-sandbox hopai) plans before any Plan exists, so its plan session has no planRef.
 * Two ways tie it to this page:
 * - while it runs: a running plan session of the app, titled "<app> 이전 계획 (<source> → <target>)" by hopai;
 * - after the Plan is submitted: the rehearsal session (which has the planRef) names it at its start,
 *   in a message event with tool "plan" and output {planRef, planSession, planId}.
 */

/** The plan session hopai has open for `app` before a Plan exists, newest first; undefined when none. */
export function planningSession(sessions: AgentSession[] | undefined, app: string): AgentSession | undefined {
  if (!app) return undefined;
  return sessions?.find((s) => s.kind === "plan" && s.status === "running" && !s.planRef && s.title.startsWith(app + " 이전 계획"));
}

/** The plan session a rehearsal session's events name; undefined when they name none. */
export function linkedPlanSessionId(events: AgentEvent[]): string | undefined {
  for (const e of events) {
    const o = e.output;
    if (e.tool !== "plan" || !o || typeof o !== "object") continue;
    const id = (o as { planSession?: unknown }).planSession;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

/** The plan session behind the plan's rehearsal, read once per rehearsal session. */
function useLinkedPlanSession(sessions: AgentSession[]): AgentSession | undefined {
  // newest first: the last rehearsal is the first one, which names the plan session at its start
  const rid = sessions.filter((s) => s.kind === "rehearsal").at(-1)?.id;
  const [linked, setLinked] = useState<{ rid: string; session: AgentSession }>();
  useEffect(() => {
    if (!rid) return;
    const ctrl = new AbortController();
    (async () => {
      const id = linkedPlanSessionId((await listAgentEvents(rid, { limit: 20 }, { signal: ctrl.signal })).events);
      if (!id) return;
      const session = await getAgentSession(id, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setLinked({ rid, session });
    })().catch(() => {}); // without it the page shows the plan's own sessions, as before
    return () => ctrl.abort();
  }, [rid]);
  return linked && linked.rid === rid ? linked.session : undefined;
}

/**
 * The stored events of every session but the one followed live (that one streams). A session is read again,
 * from its last seq on, when the polled list shows it gained events or ended; nothing is read twice.
 * `missing` is true while a session has never loaded, or its last read failed.
 */
export function useStoredSessionEvents(sessions: AgentSession[], follow: string | null): { events: Record<string, AgentEvent[]>; missing: boolean } {
  const [store, setStore] = useState<Record<string, { ver: string; events: AgentEvent[]; failed?: boolean }>>({});
  const want = sessions.filter((s) => s.id !== follow).map((s) => ({ id: s.id, ver: s.status + ":" + s.totals.events }));
  const key = want.map((w) => w.id + "@" + w.ver).join(" ");
  const [busy] = useState(() => new Map<string, AbortController>());
  useEffect(() => {
    for (const w of want) {
      const have = store[w.id];
      // loaded at this version, or failed at it: wait until the session changes (no retry loop)
      if ((have && have.ver === w.ver) || busy.has(w.id)) continue;
      const ctrl = new AbortController();
      busy.set(w.id, ctrl);
      (async () => {
        const out = [...(have?.events ?? [])];
        let after = out.at(-1)?.seq ?? 0;
        for (;;) {
          const page = await listAgentEvents(w.id, { after: after || undefined, limit: 2000 }, { signal: ctrl.signal });
          for (const e of page.events) if (e.seq > (out.at(-1)?.seq ?? 0)) out.push(e);
          if (page.nextAfter === undefined) break;
          // a cursor that does not move would ask for the same page forever
          if (page.nextAfter <= after) throw new Error("nextAfter did not advance");
          after = page.nextAfter;
        }
        if (!ctrl.signal.aborted) setStore((s) => ({ ...s, [w.id]: { ver: w.ver, events: out } }));
      })()
        .catch(() => {
          if (!ctrl.signal.aborted) setStore((s) => ({ ...s, [w.id]: { ver: w.ver, events: have?.events ?? [], failed: true } }));
        })
        .finally(() => busy.delete(w.id));
    }
  }, [key, store]); // `key` names every session and its version
  useEffect(() => () => busy.forEach((c) => c.abort()), [busy]);
  const events: Record<string, AgentEvent[]> = {};
  for (const [id, x] of Object.entries(store)) events[id] = x.events;
  return { events, missing: want.some((w) => !store[w.id] || store[w.id].failed) };
}

function envLabel(name: string): string {
  const k = envKeyOf(name);
  return k ? ENV[k].name : name;
}

/** Registered app members stay visible even when platform discovery is temporarily unavailable. */
export function migrationTargets(members: string[], environments: Environment[] | undefined, source: string): MigrationTargetOption[] {
  const options = new Map<string, MigrationTargetOption>(members.map((value) => [value, { value, label: envLabel(value), registered: true }]));
  for (const environment of environments ?? []) {
    options.set(environment.name, { value: environment.name, label: environment.displayName || environment.name, registered: members.includes(environment.name) });
  }
  return [...options.values()].filter((option) => option.value !== source);
}

/** Registered apps stay selectable even when they still need an environment or database setup. */
export function migratableApps(list: App[]): App[] {
  return list.filter((a) => a.environments.length > 0 || !!a.deploy);
}

/** Whether a run or plan moves the database in `ns`, as source or target (the namespace may differ per environment). */
export function touches(ns: string, x: { source: { namespace: string }; target: { namespace: string } }): boolean {
  return x.source.namespace === ns || x.target.namespace === ns;
}

/**
 * The environment whose database is primary now. The gateway sends the app's writes there (its backends are named
 * after the environments), and a migration moves both. Without the gateway's answer, the environment the database
 * was born primary in (dbTopology, which a migration does not update); without that either, undefined.
 */
export function currentPrimary(envs: string[], topology: AppDBTopology | undefined, writeBackend: string | undefined): string | undefined {
  if (writeBackend && envs.includes(writeBackend)) return writeBackend;
  return topology && envs.includes(topology.primary) ? topology.primary : undefined;
}

export interface DBRole {
  role: "primary" | "replica" | "unknown";
  observed?: true;
  /** whether the gateway sends the app's writes here; undefined when the gateway did not say */
  traffic?: "active" | "standby";
}

/** Registered membership supplies every database, including an onprem third member. */
export function dbRoles(topology: AppDBTopology, writeBackend: string | undefined, environments?: string[]): Record<string, DBRole> {
  const envs = environments ?? [topology.primary, topology.replica];
  const known = !!writeBackend && envs.includes(writeBackend);
  const primary = known ? writeBackend : topology.primary;
  const out: Record<string, DBRole> = {};
  for (const e of envs) {
    const observed = topology.readiness?.environments.find((r) => r.env === e && r.inApp);
    out[e] = {
      role: envs.length > 2 ? (observed?.role ?? "unknown") : (e === primary ? "primary" : "replica"),
      traffic: known ? (e === writeBackend ? "active" : "standby") : undefined,
      ...(envs.length > 2 && observed && observed.role !== "unknown" ? { observed: true as const } : {}),
    };
  }
  return out;
}

/** Korean texts for deploy.dbTopology.readiness.reason (ADR 0037). The server's English message is shown only for a reason not listed. */
const READINESS_REASONS: Record<string, string> = {
  replica_missing: "DB 짝의 상대 환경이 아직 앱에 없습니다. 앱 상세에서 환경 추가로 더하면 이전할 수 있습니다",
  deploy_pending: "DB 짝의 환경 중 아직 정상 배포가 끝나지 않은 곳이 있습니다. 배포가 끝나면 이전할 수 있습니다",
  app_degraded:
    "새 환경에서 앱이 Degraded로 실패했습니다. 앱이 시작할 때 DB에 쓰는 것 같습니다(replica DB는 쓰기를 거절합니다). 이런 앱은 엔진의 cold 모드로 옮겨야 합니다",
  deploy_failed: "DB 짝 환경의 배포가 실패했습니다. 배포 이력에서 원인을 확인하고 다시 배포하세요",
  migration_in_progress: "이 앱의 이전이 진행 중이거나 게이트웨이가 쓰기를 잡고 있습니다. 그 이전이 끝난 뒤 다음 이전을 할 수 있습니다",
  gateway_unreachable: "트래픽 게이트웨이를 읽지 못해 이전할 수 있는지 확인하지 못했습니다. 잠시 뒤 다시 확인합니다",
  gateway_backend_missing: "트래픽 게이트웨이에 두 환경의 백엔드가 모두 있어야 합니다. 배포가 끝나면 등록됩니다",
  cluster_unreadable: "DB 클러스터(CNPG)를 읽지 못했습니다. 잠시 뒤 다시 확인합니다",
  cluster_not_healthy: "두 DB 클러스터(CNPG) 중 정상이 아니거나 준비된 인스턴스가 모자란 곳이 있습니다",
  topology_mismatch: "두 DB의 복제 설정이 맞지 않습니다. 한쪽이 primary이고 다른 쪽이 그것을 따라야 합니다",
  write_backend_mismatch: "게이트웨이가 쓰기를 보내는 환경과 지금 DB가 primary인 환경이 다릅니다. 원본을 잘못 고를 수 있으니 트래픽 화면에서 쓰기 대상을 확인하세요",
};

/** Why the database pair cannot be migrated now, in Korean; undefined when it is ready or the server sent no readiness (an older one). */
export function readinessBlock(r: AppDBReadiness | undefined): string | undefined {
  if (!r || r.ready) return undefined;
  return Object.hasOwn(READINESS_REASONS, r.reason) ? READINESS_REASONS[r.reason] : "아직 이전할 수 없습니다: " + r.message;
}

/**
 * The migration page's view of the pair's readiness. `stop` all keeps both plan buttons off, manual only the Plan
 * without AI (the AI can pick the engine's cold mode), none only warns: the server checks again at the start.
 * `runId` is the app's migration in progress, to open instead of planning another.
 */
export interface PairCheck {
  text: string;
  stop: "all" | "manual" | "none";
  runId?: string;
}

/**
 * Whether the plan buttons wait for the pair. Only what is sure to fail stops them: the peer is not the app's, its
 * deployment is unfinished, the target's deployment failed, or a migration of the app is in progress (`activeRun`).
 * What may pass by the start or was not read (gateway, clusters, a reason this console does not know) only warns, as
 * a readiness that could not be read does.
 */
export function pairCheck(r: AppDBReadiness | undefined, target: string, activeRun: string | undefined): PairCheck | undefined {
  if (!r || r.ready) return undefined;
  const text = readinessBlock(r)!;
  switch (r.reason) {
    case "replica_missing":
    case "deploy_pending":
      return { text, stop: "all" };
    case "deploy_failed":
      return { text, stop: r.environments.find((e) => e.env === target)?.deployed === true ? "none" : "all" };
    case "app_degraded":
      return { text: text + ". AI 계획은 cold 모드를 고를 수 있어 실행할 수 있습니다", stop: "manual" };
    case "migration_in_progress":
      if (activeRun) return { text, stop: "all", runId: activeRun };
  }
  return { text, stop: "none" };
}

/** The app named in the page's hash, #migrate-app?app=<name>. */
function appOfHash(): string {
  const q = window.location.hash.split("?")[1];
  return q ? (new URLSearchParams(q).get("app") ?? "") : "";
}

/** The AI runner the platform starts as a Job: whether the server has one, its latest run for the app, and start. */
export interface AIRunView {
  available: boolean;
  latest?: AIRun;
  /** A start response accepted on this page, before its Plan arrives. Not a fabricated agent session. */
  current?: AIRun;
  running: boolean;
  start(): void;
}

function planFromAIRun(plan: PlanRecord, job: AIRun, namespace?: string): boolean {
  return !!namespace && touches(namespace, plan.summary) && isAfter(plan.submittedAt, job.createdAt)
    && plan.summary.source.env === job.source && plan.summary.target.env === job.target;
}

export function useLiveMigration(): MigrationView {
  const enabled = true;
  const apps = useApps();
  const environments = useEnvironments(10000);
  const plans = usePlans(enabled ? 3000 : 0, enabled);
  const runs = useRuns(enabled ? 5000 : 0);
  const [appName, setAppName] = useState<string>(appOfHash);
  const [tgt, setTgt] = useState<string>("");
  const [planRef, setPlanRef] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [engine, setEngine] = useState<EnginePlan | undefined>();
  const [acceptedAI, setAcceptedAI] = useState<AIRun>();
  const [acceptedPlan, setAcceptedPlan] = useState<PlanRecord>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [startKey, setStartKey] = useState(newIdempotencyKey);
  // Start options belong to one plan: another plan (a new one, after a reject, a rollback) starts from the defaults.
  const [picked, setPicked] = useState<{ planRef: string | null; options: StartOptions }>({ planRef: null, options: DEFAULT_START });
  const [selected, setSelected] = useState<string | null>(null);
  // The run follows its stream again after a resume (the stream closed when the run ended); the resume's answer
  // shows until the new stream's snapshot arrives. A halted run the operator left with reset is not picked up again.
  const [revived, setRevived] = useState<{ epoch: number; run?: Run }>({ epoch: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);

  // The app on screen: the one picked (or named in the hash), else the first with work in progress, else the
  // first that can be migrated. Once chosen it stays, so a run that ends does not move the page to another app.
  const list = migratableApps(apps.data ?? []);
  const newestPending = (ns?: string) =>
    [...(plans.data ?? [])].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).find((p) => p.status === "pending_approval" && (ns === undefined || touches(ns, p.summary)));
  const busyRun = runs.data?.find((r) => ACTIVE.has(r.status));
  const busyPlan = newestPending();
  const app =
    list.find((a) => a.name === appName) ??
    list.find((a) => (busyRun && touches(a.namespace, busyRun)) || (busyPlan && touches(a.namespace, busyPlan.summary))) ??
    list[0];
  useEffect(() => {
    if (app && app.name !== appName) setAppName(app.name);
  }, [app, appName]);
  const ns = app?.namespace;

  // Pick up work already in progress on this app: an active run, else its newest run when it halted (it waits for an
  // operator to resume it), else its newest plan waiting for approval. Another app's work stays off this page.
  // A Plan on screen that was started elsewhere (another browser, the CLI) is followed into its run.
  useEffect(() => {
    if (!enabled || runId || !ns) return;
    if (planRef) {
      const started = runs.data?.find((r) => r.planRef === planRef);
      if (started) setRunId(started.runId);
      return;
    }
    const mine = runs.data?.filter((r) => touches(ns, r));
    const newest = mine?.[0];
    const active = mine?.find((r) => ACTIVE.has(r.status)) ?? (newest?.status === "halted" && newest.runId !== dismissed ? newest : undefined);
    if (active) {
      setRunId(active.runId);
      setPlanRef(active.planRef);
      return;
    }
    const pending = newestPending(ns);
    if (pending) setPlanRef(pending.ref);
  }, [enabled, runs.data, plans.data, runId, planRef, dismissed, ns]);

  const plan = plans.data?.find((p) => p.ref === planRef) ?? (acceptedPlan?.ref === planRef ? acceptedPlan : undefined);
  const startOptions = picked.planRef === planRef ? picked.options : DEFAULT_START;
  const preflight = usePreflight(planRef, runId, startKey);
  const mineRuns = ns ? (runs.data ?? []).filter((r) => touches(ns, r)) : [];
  const past = usePastPreflight(!planRef && !runId, {
    runIds: mineRuns.map((r) => r.runId),
    planRefs: [...mineRuns.map((r) => r.planRef), ...(ns ? (plans.data ?? []).filter((p) => touches(ns, p.summary)).map((p) => p.ref) : [])],
  });
  const watch = useRun(enabled ? runId : null, revived.epoch);
  const run = watch.run ?? (revived.run?.runId === runId ? revived.run : undefined);
  const aiRuns = useAIRuns(app?.name, 5000);
  const accepted = acceptedAI?.app === app?.name ? (aiRuns.data?.find((r) => r.name === acceptedAI.name) ?? acceptedAI) : undefined;
  const currentAI = accepted && (!plan || !planFromAIRun(plan, accepted, ns)) ? accepted : undefined;
  const envs = app ? migrationEnvironments(app) : [];
  const databaseEnvs = app?.environments.map((e) => e.env) ?? [];
  const databaseless = !!app && isDatabaselessApp(app);
  const gkeDemoApp =
    app?.name === "moimroom" && !envs.includes("gke")
      ? list.find(
          (candidate) =>
            candidate.name === "moimroom-mig" &&
            ["eks", "gke"].every((env) => candidate.environments.some((instance) => instance.env === env)),
        )?.name
      : undefined;
  const sessions = useAgentSessions(enabled && planRef ? 3000 : 0, planRef ? { planRef } : {});
  // Without a run: the newest sessions, to show a plan hopai is writing for this app as it happens.
  const recent = useAgentSessions(enabled && !runId ? 3000 : 0, { limit: 20 });
  const running = !runId ? planningSession(recent.data, app?.name ?? "") : undefined;
  // A plan session started after the Plan on screen was submitted is newer work than that Plan (which
  // may be one hopai left for the operator to reject): follow it instead.
  const fresh = running && (!plan || isAfter(running.createdAt, plan.submittedAt)) ? running : undefined;
  // The plan session being followed stays on screen after it ends, until the Plan it submits arrives:
  // a failed plan shows why instead of the page falling back to the setup form.
  const [tracked, setTracked] = useState<AgentSession>();
  useEffect(() => {
    if (fresh) setTracked(fresh);
  }, [fresh]);
  // its latest state while it is still among the newest sessions, else the last one seen
  const planning = tracked ? (recent.data?.find((s) => s.id === tracked.id) ?? tracked) : undefined;
  useEffect(() => {
    if (!currentAI || !ns) return;
    const submitted = [...(plans.data ?? [])]
      .filter((p) => p.status === "pending_approval" && planFromAIRun(p, currentAI, ns))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    if (submitted) {
      setTracked(undefined);
      setSelected(null);
      setPlanRef(submitted.ref);
    }
  }, [currentAI, plans.data, ns]);
  useEffect(() => {
    if (!planning || !ns) return;
    // only this app's Plan: another app's Plan submitted meanwhile (another operator's migration) is not this session's
    const submitted = [...(plans.data ?? [])]
      .filter((p) => p.status === "pending_approval" && touches(ns, p.summary) && isAfter(p.submittedAt, planning.createdAt))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    if (!submitted) return;
    setTracked(undefined);
    setSelected(null);
    setPlanRef(submitted.ref);
  }, [planning, plans.data, ns]);
  const ofPlan = useMemo(() => (enabled && planRef && !planning && !currentAI ? (sessions.data ?? []) : []), [enabled, planRef, planning, currentAI, sessions.data]);
  const linked = useLinkedPlanSession(ofPlan);
  const sessionList = useMemo(() => {
    if (planning) return [planning];
    // the plan session is the oldest, so it goes last; a planRef it may get later must not list it twice
    return linked && !ofPlan.some((s) => s.id === linked.id) ? [...ofPlan, linked] : ofPlan;
  }, [planning, ofPlan, linked]);
  const follow = selected ?? sessionList[0]?.id ?? null;
  const ses = useAgentSession(enabled ? follow : null);
  // the other sessions' stored events, so the map and the checks count every session, not only the one followed
  const stored = useStoredSessionEvents(enabled ? sessionList : [], follow);

  // Before a plan: the source is where the gateway sends the app's writes now, so a second migration starts where the
  // first one left the database. A DB app may fall back to its configured database role with a visible note.
  // A database-free app has no DB role to fall back to: it requires an observed gateway backend.
  const choosing = !run && !plan && !currentAI;
  const traffic = useTraffic(5000, undefined, app?.name, enabled && choosing && !!app);
  const trafficFailed = !!traffic.error;
  const srcLoading = choosing && !!app && traffic.loading;
  const topology = app?.deploy?.dbTopology;
  // GET /v1/apps has no readiness: only the app's own read looks at both clusters (ADR 0037)
  const detail = useApp(enabled && choosing && topology ? app?.name : null, 10000);
  // A database-free migration is a traffic move: only an observed member backend establishes its source.
  const observedSource = trafficFailed ? undefined : traffic.data?.writeBackend;
  const chosenSource = databaseless ? (observedSource && envs.includes(observedSource) ? observedSource : "") : (currentPrimary(databaseEnvs, topology, observedSource) ?? databaseEnvs[0] ?? "");
  const src = run?.source.env ?? currentAI?.source ?? plan?.summary.source.env ?? (srcLoading ? "" : chosenSource);
  const srcNote =
    choosing && databaseless && !srcLoading && !chosenSource
      ? "DB가 없는 앱의 현재 쓰기 대상을 게이트웨이에서 확인하지 못했습니다. 원본을 추정하지 않으며 확인 전에는 계획을 만들 수 없습니다."
      : choosing && !databaseless && !srcLoading && trafficFailed && databaseEnvs.length > 0
      ? "게이트웨이에서 지금 쓰기를 받는 곳을 읽지 못해 " + (topology ? "DB를 처음 primary로 만든 환경" : "첫 환경") + "을 원본으로 잡았습니다."
      : undefined;
  const targets = migrationTargets(envs, environments.data, src);
  const target = run?.target.env ?? currentAI?.target ?? plan?.summary.target.env ?? (targets.some((e) => e.value === tgt) ? tgt : targets.find((e) => e.registered)?.value ?? targets[0]?.value ?? "");
  const preparation = choosing && app
    ? envs.length < 2
      ? "이 앱은 이전할 환경이 두 곳 이상 필요합니다. 앱 상세에서 다른 환경을 추가하고 배포 상태를 확인하세요."
      : !databaseless && (databaseEnvs.length < 2 || (envs.includes(target) && !databaseEnvs.includes(target)))
        ? "DB 이전 환경 정보가 준비되지 않았습니다. 앱의 환경 추가와 DB 복제 준비 상태를 확인하세요. 배포 환경만으로 DB가 준비됐다고 판단하지 않습니다."
        : databaseless && !app.deploy?.spec.services.some((service) => service.public)
          ? "DB가 없는 앱의 이전에는 공개 HTTP 서비스와 앱별 게이트웨이가 필요합니다. 앱 설정을 확인하세요."
          : undefined
    : undefined;
  const myRun = ns ? runs.data?.find((r) => touches(ns, r) && runInProgress(r)) : undefined;
  // while it loads or when it fails the buttons stay on: the platform checks the pair again at the start
  const pair: PairCheck | undefined =
    choosing && topology
      ? detail.data
        ? pairCheck(detail.data.deploy?.dbTopology?.readiness, target, myRun?.runId)
        : detail.error
          ? { text: "DB 짝이 이전할 준비가 되었는지 읽지 못했습니다. 계획은 만들 수 있고, 플랫폼이 시작할 때 다시 확인합니다", stop: "none" }
          : { text: "DB 짝이 이전할 준비가 되었는지 확인하는 중입니다", stop: "none" }
      : undefined;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // An approved plan without a run was refused at start (or not started yet): stay on it so the
  // operator sees why and can start again, instead of falling back to the setup form.
  // A plan session hopai is writing for this app shows as the AI step until its Plan arrives, ahead of
  // an older Plan the page may have picked up.
  const stage: MigrationView["stage"] = run ? "run" : planning || currentAI ? "ai" : plan?.status === "pending_approval" || plan?.status === "approved" ? "review" : "setup";

  return {
    live: true,
    app: app?.name ?? "",
    stage,
    src,
    tgt: target,
    srcLabel: srcLoading ? "확인 중" : src ? envLabel(src) : "미확인",
    srcNote,
    tgtLabel: targets.find((e) => e.value === target)?.label ?? envLabel(target),
    targets,
    targetSetup: choosing && target ? { registered: envs.includes(target), addHref: app?.deploy ? "#app-" + encodeURIComponent(app.name) : undefined, status: environments.data?.find((e) => e.name === target)?.status } : undefined,
    targetsError: environments.error ? "전체 환경 목록을 읽지 못했습니다. 이미 앱에 등록된 환경만 표시할 수 있습니다. " + errorText(environments.error) : undefined,
    preparation,
    setTarget: setTgt,
    apps: list.map((a) => ({ value: a.name, label: a.name })),
    gkeDemoApp,
    setApp: (name) => {
      if (name === app?.name) return;
      setAppName(name);
      window.history.replaceState(null, "", "#migrate-app?app=" + encodeURIComponent(name));
      clear();
      setTgt("");
    },
    ready: !!app,
    pairCheck: pair,
    openRun: (id) => {
      const r = runs.data?.find((x) => x.runId === id);
      if (!r) return;
      setDismissed(null);
      setRunId(r.runId);
      setPlanRef(r.planRef);
    },
    // while a plan session is on screen, an older Plan the page picked up is not the one being written
    plan: planning || currentAI ? undefined : plan,
    engine,
    sessions: sessionList,
    sessionEvents: (id) => (id === follow ? ses.events : (stored.events[id] ?? [])),
    sessionsPartial: stored.missing,
    selectSession: setSelected,
    run,
    lastRun: mineRuns[0] && !runInProgress(mineRuns[0]) ? mineRuns[0] : undefined,
    events: watch.events,
    stream: { connected: watch.connected, error: watch.error ? errorText(watch.error) : undefined },
    preflight: preflight.data,
    past,
    start: { options: startOptions, set: (options) => setPicked({ planRef, options }) },
    busy,
    notice: notice || (apps.error ? errorText(apps.error) : ""),
    aiRun: {
      // only once the server answered the list: without the runner it answers 503, an older platform 404
      available: aiRuns.data !== undefined,
      latest: currentAI ?? aiRuns.data?.[0],
      current: currentAI,
      running: (currentAI ?? aiRuns.data?.[0])?.status === "running",
      start: () =>
        act(async () => {
          if (!app) return;
          if (!src || src === target || !envs.includes(target) || preparation) throw new ApiError(409, "app_environment_required", preparation ?? "이전 대상 환경을 앱에 먼저 추가하고 원본 상태를 확인하세요.");
          setAppName(app.name);
          const accepted = await startAIRun({ app: app.name, source: src, target });
          setAcceptedAI(accepted);
          aiRuns.reload();
        }),
    },
    makePlan: () =>
      act(async () => {
        if (!app) return;
        if (!src || src === target || !envs.includes(target) || preparation) throw new ApiError(409, "app_environment_required", preparation ?? "이전 대상 환경을 앱에 먼저 추가하고 원본 상태를 확인하세요.");
        setAppName(app.name);
        const draft = await draftPlan({ app: app.name, source: src, target });
        setEngine(draft);
        const rec = await submitPlan(draft);
        setAcceptedPlan(rec);
        setPlanRef(rec.ref);
        setStartKey(newIdempotencyKey());
        plans.reload();
      }),
    approve: () =>
      act(async () => {
        if (!plan) return;
        const blocked = approvalBlock(plan);
        if (blocked) throw new Error("리허설을 통과하지 않은 AI 계획이라 승인할 수 없습니다: " + blocked);
        try {
          // approve exactly the revision on screen; a newer attachment makes the server answer 409.
          // Approving an approved plan again is a no-op, so this also retries a refused start.
          await approvePlan(plan.ref, { revision: plan.revision });
          const res = await startMigration(startRequest(plan.ref, plan.summary.gatewayMode, startOptions), startKey);
          setRunId(res.runId);
        } finally {
          plans.reload();
          preflight.reload(); // refused or not, the start's audit entry now holds the checks
        }
      }),
    reject: () =>
      act(async () => {
        if (!plan) return;
        await rejectPlan(plan.ref, { comment: "운영자 반려" });
        setAcceptedAI(undefined);
        setAcceptedPlan(undefined);
        setPlanRef(null);
        plans.reload();
      }),
    doSwitch: () => act(async () => void (run && (await switchMigration(run.runId)))),
    abort: () => act(async () => void (run && (await abortMigration(run.runId, { reason: "운영자가 중단" })))),
    resume: () =>
      act(async () => {
        if (!run) return;
        const res = await resumeMigration(run.runId);
        setRevived((x) => ({ epoch: x.epoch + 1, run: res }));
      }),
    rollback: () =>
      act(async () => {
        if (!run) return;
        const res = await rollbackMigration(run.runId, { reason: "운영자 롤백", autoSwitch: true });
        setPlanRef(res.planRef);
        setRunId(res.runId);
        preflight.reload();
      }),
    reset: () => {
      if (runId) setDismissed(runId);
      clear();
    },
  };

  /** Leaves the run or plan on screen for the setup form. */
  function clear() {
    setAcceptedAI(undefined);
    setAcceptedPlan(undefined);
    setTracked(undefined);
    setSelected(null);
    setRunId(null);
    setPlanRef(null);
    setEngine(undefined);
    setNotice("");
    setStartKey(newIdempotencyKey());
  }
}

// approvalBlock is why the platform refuses to approve this plan, or "" when it can be approved: an AI plan
// (submitted by the agent) needs a passing rehearsal report for the plan as it is now (platform #24).
// The platform makes the decision; the console only hides the approve buttons and shows the reason.
/** The AI runner is still rehearsing the plan it submitted: its missing report is a wait, not a failure. */
export function rehearsing(v: Pick<MigrationView, "plan" | "aiRun">): boolean {
  return !!approvalBlock(v.plan) && !!v.aiRun?.running;
}

export function approvalBlock(plan: PlanRecord | undefined | null): string {
  const g = plan?.status === "pending_approval" ? plan.rehearsal : undefined;
  if (!g?.required || g.passed) return "";
  return g.reason ?? "rehearsal evidence required";
}
