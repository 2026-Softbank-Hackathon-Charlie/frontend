// One view of a migration for the page, from the simulation or the platform API.
// Both sides hand over contract types (PlanRecord, Run, AgentSession, ...), so the page has one code path.
import { useEffect, useMemo, useState } from "react";
import {
  abortMigration,
  approvePlan,
  draftPlan,
  newIdempotencyKey,
  rejectPlan,
  resumeMigration,
  rollbackMigration,
  startMigration,
  submitPlan,
  switchMigration,
} from "../api/client";
import { useAgentSession, useAgentSessions, useApps, useRun, useRuns } from "../api/hooks";
import type { AgentEvent, AgentSession, EnginePlan, PlanRecord, Run, RunEvent } from "../api/types";
import { ENV, ENV_ORDER, SAMPLE, envKeyOf, type EnvKey } from "../sim/data";
import { CANARY, enginePlan, fixDiff, migCounters } from "../sim/mig";
import { useSim } from "../sim/store";
import { errorText, usePlans } from "./live";

export interface EnvOption {
  value: string;
  label: string;
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

export function useSimMigration(): MigrationView {
  const { S, dispatch } = useSim();
  const m = S.mig;
  const shop = S.apps[SAMPLE.id];
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
    ready: !!shop,
    plan: m.plan ?? undefined,
    engine: m.plan ? enginePlan(m.src, m.tgt) : undefined,
    sessions: m.sessions,
    sessionEvents: (id) => m.sessionEvents[id] ?? [],
    selectSession: () => {},
    fix: m.plan?.attachments?.length ? fixDiff(m.src, m.tgt) : undefined,
    run: m.run ?? undefined,
    events: m.events,
    counters: migCounters(m),
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

  const stage: MigrationView["stage"] = run ? "run" : plan?.status === "pending_approval" ? "review" : "setup";

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
        // approve exactly the revision on screen; a newer attachment makes the server answer 409
        await approvePlan(plan.ref, { revision: plan.revision });
        const res = await startMigration({ planRef: plan.ref, canary: { weights: CANARY.weights, stepDuration: CANARY.stepSec + "s" } }, startKey);
        setRunId(res.runId);
        plans.reload();
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
