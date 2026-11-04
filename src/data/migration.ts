// One view of a migration for the page, from the simulation or the platform API.
// Both sides hand over contract types (PlanRecord, Run, AgentSession, ...), so the page has one code path.
import { useEffect, useMemo, useState } from "react";
import {
  abortMigration,
  approvePlan,
  draftPlan,
  listAudit,
  newIdempotencyKey,
  rejectPlan,
  resumeMigration,
  rollbackMigration,
  startMigration,
  submitPlan,
  switchMigration,
} from "../api/client";
import { useAgentSession, useAgentSessions, useApps, useRun, useRuns } from "../api/hooks";
import type { AgentEvent, AgentSession, EnginePlan, PlanRecord, Run, RunEvent, StartMigrationRequest } from "../api/types";
import { ENV, ENV_ORDER, SAMPLE, envKeyOf, type EnvKey } from "../sim/data";
import { CANARY_PRESETS, DEFAULT_CANARY, enginePlan, fixDiff, migCounters, type CanaryPreset } from "../sim/mig";
import { useSim } from "../sim/store";
import { errorText, usePlans } from "./live";
import { latestPreflight, preflightOf, type PreflightView } from "./preflight";

export interface EnvOption {
  value: string;
  label: string;
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
  tgtLabel: string;
  targets: EnvOption[];
  setTarget(v: string): void;
  /** the app exists and can be migrated */
  ready: boolean;
  plan?: PlanRecord;
  /** the engine plan the record was made from, when known */
  engine?: EnginePlan;
  sessions: AgentSession[];
  /** events of one AI session; the live side follows the selected one */
  sessionEvents(id: string): AgentEvent[];
  selectSession(id: string): void;
  /** the AI's values fix, shown as a diff (simulation; live plans carry it as an attachment) */
  fix?: { file: string; minus: string; plus: string };
  run?: Run;
  events: RunEvent[];
  /** k6 counters, simulation only */
  counters?: { ok: number; held: number; heldDone: number };
  /** the platform's residency and capacity checks of the latest start or rollback of this plan */
  preflight?: PreflightView;
  /** start options of the plan on screen; the simulation does not model observe and leaves them out */
  start?: { options: StartOptions; set(o: StartOptions): void };
  busy: boolean;
  notice: string;
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
    listAudit({ limit: 100 }, { signal: ctrl.signal })
      .then((res) => !ctrl.signal.aborted && setData(latestPreflight(res.entries, planRef)))
      .catch(() => {}); // a viewer without audit access just sees no checks
    return () => ctrl.abort();
  }, [planRef, runId, attempt, nonce]);
  return { data, reload: () => setNonce((n) => n + 1) };
}

const ACTIVE = new Set(["running", "awaiting_switch"]);

function envLabel(name: string): string {
  const k = envKeyOf(name);
  return k ? ENV[k].name : name;
}

export function useLiveMigration(): MigrationView {
  const enabled = true;
  const apps = useApps();
  const plans = usePlans(enabled ? 3000 : 0, enabled);
  const runs = useRuns(enabled ? 5000 : 0);
  const [appName, setAppName] = useState<string>("");
  const [tgt, setTgt] = useState<string>("");
  const [planRef, setPlanRef] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [engine, setEngine] = useState<EnginePlan | undefined>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [startKey, setStartKey] = useState(newIdempotencyKey);
  // Start options belong to one plan: another plan (a new one, after a reject, a rollback) starts from the defaults.
  const [picked, setPicked] = useState<{ planRef: string | null; options: StartOptions }>({ planRef: null, options: DEFAULT_START });
  const [selected, setSelected] = useState<string | null>(null);

  const app = (apps.data ?? []).find((a) => a.name === appName) ?? apps.data?.[0];
  const envs = app?.environments.map((e) => e.env) ?? [];

  // Pick up work already in progress: an active run, else the newest plan waiting for approval.
  useEffect(() => {
    if (!enabled || runId || planRef) return;
    const active = runs.data?.find((r) => ACTIVE.has(r.status));
    if (active) {
      setRunId(active.runId);
      setPlanRef(active.planRef);
      return;
    }
    const pending = [...(plans.data ?? [])].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).find((p) => p.status === "pending_approval");
    if (pending) setPlanRef(pending.ref);
  }, [enabled, runs.data, plans.data, runId, planRef]);

  const plan = plans.data?.find((p) => p.ref === planRef);
  const startOptions = picked.planRef === planRef ? picked.options : DEFAULT_START;
  const preflight = usePreflight(planRef, runId, startKey);
  const watch = useRun(enabled ? runId : null);
  const run = watch.run;
  const sessions = useAgentSessions(enabled && planRef ? 3000 : 0, planRef ? { planRef } : {});
  const sessionList = useMemo(() => (enabled && planRef ? (sessions.data ?? []) : []), [enabled, planRef, sessions.data]);
  const follow = selected ?? sessionList[0]?.id ?? null;
  const ses = useAgentSession(enabled ? follow : null);

  const src = run?.source.env ?? plan?.summary.source.env ?? envs[0] ?? "";
  const target = run?.target.env ?? plan?.summary.target.env ?? (tgt && tgt !== src ? tgt : envs.find((e) => e !== src) ?? "");

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
  const stage: MigrationView["stage"] = run ? "run" : plan?.status === "pending_approval" || plan?.status === "approved" ? "review" : "setup";

  return {
    live: true,
    app: app?.name ?? "",
    stage,
    src,
    tgt: target,
    srcLabel: envLabel(src),
    tgtLabel: envLabel(target),
    targets: envs.filter((e) => e !== src).map((e) => ({ value: e, label: envLabel(e) })),
    setTarget: setTgt,
    ready: !!app,
    plan,
    engine,
    sessions: sessionList,
    sessionEvents: (id) => (id === follow ? ses.events : []),
    selectSession: setSelected,
    run,
    events: watch.events,
    preflight: preflight.data,
    start: { options: startOptions, set: (options) => setPicked({ planRef, options }) },
    busy,
    notice: notice || (apps.error ? errorText(apps.error) : ""),
    makePlan: () =>
      act(async () => {
        if (!app) return;
        setAppName(app.name);
        const draft = await draftPlan({ app: app.name, source: src, target });
        setEngine(draft);
        const rec = await submitPlan(draft);
        setPlanRef(rec.ref);
        setStartKey(newIdempotencyKey());
        plans.reload();
      }),
    approve: () =>
      act(async () => {
        if (!plan) return;
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
        setPlanRef(null);
        plans.reload();
      }),
    doSwitch: () => act(async () => void (run && (await switchMigration(run.runId)))),
    abort: () => act(async () => void (run && (await abortMigration(run.runId, { reason: "운영자가 중단" })))),
    resume: () => act(async () => void (run && (await resumeMigration(run.runId)))),
    rollback: () =>
      act(async () => {
        if (!run) return;
        const res = await rollbackMigration(run.runId, { reason: "운영자 롤백", autoSwitch: true });
        setPlanRef(res.planRef);
        setRunId(res.runId);
        preflight.reload();
      }),
    reset: () => {
      setRunId(null);
      setPlanRef(null);
      setEngine(undefined);
      setNotice("");
      setStartKey(newIdempotencyKey());
    },
  };
}
