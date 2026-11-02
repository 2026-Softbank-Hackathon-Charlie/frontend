// React hooks over the platform API. Every hook aborts its requests and
// timers on unmount.
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  ApiError,
  getMatrix,
  getSecurity,
  getTraffic,
  listAgentSessions,
  listApps,
  listAudit,
  listEnvironments,
  listMigrations,
  networkError,
  type AgentSessionQuery,
  type SecurityQuery,
} from "./client";
import { watchAgentSession, watchRun } from "./sse";
import type {
  AgentEvent,
  AgentSession,
  App,
  AuditEntry,
  CanaryStepData,
  Environment,
  GateResultData,
  Matrix,
  MetricData,
  ObserveResult,
  ObserveRollbackData,
  ObserveStepData,
  Run,
  RunEvent,
  SecurityReport,
  StatusChangedData,
  TrafficState,
} from "./types";

const toApiError = (e: unknown) => (e instanceof ApiError ? e : networkError(e));

// --- polled resources ---

export interface Resource<T> {
  /** The last successful answer; kept while a later poll fails. */
  data: T | undefined;
  /** The last failure; cleared by the next success. */
  error: ApiError | undefined;
  /** Nothing has arrived yet. */
  loading: boolean;
  /** Load again now (and restart the poll timer). */
  reload(): void;
}

/** Loads at mount, then `pollMs` after each answer (0: once). `key` names everything `load` depends on. */
function usePolled<T>(key: string, pollMs: number, load: (signal: AbortSignal) => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiError }>({});
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const data = await load(ctrl.signal);
        if (!ctrl.signal.aborted) setState({ data });
      } catch (e) {
        if (!ctrl.signal.aborted) setState((s) => ({ data: s.data, error: toApiError(e) }));
      }
      if (!ctrl.signal.aborted && pollMs > 0) timer = setTimeout(tick, pollMs);
    };
    void tick();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
    // `load` is a function of `key`, so `key` stands in for it.
  }, [key, pollMs, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.data === undefined && state.error === undefined, reload };
}

export function useEnvironments(pollMs = 0): Resource<Environment[]> {
  return usePolled("envs", pollMs, async (signal) => (await listEnvironments({ signal })).environments);
}

/** `window` is the statistics window, 1s to 5m (server default 10s). */
export function useTraffic(pollMs = 0, window?: string): Resource<TrafficState> {
  return usePolled("traffic:" + (window ?? ""), pollMs, (signal) => getTraffic(window, { signal }));
}

/** All runs, newest first. */
export function useRuns(pollMs = 0): Resource<Run[]> {
  return usePolled("runs", pollMs, async (signal) => (await listMigrations({ signal })).runs);
}

export function useMatrix(): Resource<Matrix> {
  return usePolled("matrix", 0, (signal) => getMatrix({ signal }));
}

/** The newest `limit` audit entries (server default 100, max 500). */
export function useAudit(limit?: number): Resource<AuditEntry[]> {
  return usePolled("audit:" + (limit ?? ""), 0, async (signal) => (await listAudit({ limit }, { signal })).entries);
}

/** The apps a plan can be drafted for, in configuration order. */
export function useApps(): Resource<App[]> {
  return usePolled("apps", 0, async (signal) => (await listApps({ signal })).apps);
}

/** The security report, filtered by `q`. With `refresh` every load reads the sources again instead of the cache. */
export function useSecurity(pollMs = 0, q: SecurityQuery = {}): Resource<SecurityReport> {
  const key = "security:" + JSON.stringify([q.environment, q.severity, q.refresh]);
  return usePolled(key, pollMs, (signal) => getSecurity(q, { signal }));
}

/** Agent sessions, newest first, optionally only those of one plan or run. */
export function useAgentSessions(pollMs = 0, q: AgentSessionQuery = {}): Resource<AgentSession[]> {
  const key = "agent-sessions:" + JSON.stringify([q.planRef, q.runId, q.limit]);
  return usePolled(key, pollMs, async (signal) => (await listAgentSessions(q, { signal })).sessions);
}

// --- one run, live ---

/** Orders two RFC 3339 times to the nanosecond (Date.parse stops at milliseconds). NaN compares false. */
export function isAfter(a: string, b: string): boolean {
  const key = (t: string): [number, number] => {
    const frac = /\.(\d+)/.exec(t)?.[1] ?? "";
    return [Date.parse(t.replace(/\.\d+/, "")), Number((frac + "000000000").slice(0, 9))];
  };
  const [as, an] = key(a);
  const [bs, bn] = key(b);
  return as > bs || (as === bs && an > bn);
}

/**
 * Applies a platform or metric event to a run the way the server does, so the
 * run stays current between snapshots. Applying an event the run already
 * reflects changes nothing. Other kinds return the run unchanged.
 */
export function applyRunEvent(run: Run, ev: RunEvent): Run {
  const d = ev.data ?? {};
  switch (ev.kind) {
    case "status_changed": {
      const x = d as Partial<StatusChangedData>;
      if (!x.status || !x.phase) return run;
      return { ...run, status: x.status, phase: x.phase, statusReason: x.reason || undefined };
    }
    case "metric": {
      const ms = (d as MetricData).downtimeMillis;
      return typeof ms === "number" ? { ...run, result: { ...run.result, downtimeMillis: ms } } : run;
    }
    // The server sets a step's startedAt before it emits canary_step and its
    // endedAt before gate_result, so an event belongs to the step of its
    // weight whose time span holds the event's time.
    case "canary_step": {
      // A new read share on the target. Weight 0 moves reads back to the source; it is not a step.
      const w = (d as Partial<CanaryStepData>).weight;
      if (!run.canary || typeof w !== "number" || w <= 0) return run;
      const steps = run.canary.steps;
      const t = ev.time;
      if (steps.some((s) => s.weight === w && !isAfter(s.startedAt, t) && (!s.endedAt || !isAfter(t, s.endedAt)))) return run;
      return { ...run, canary: { ...run.canary, steps: [...steps, { weight: w, startedAt: t }] } };
    }
    case "gate_result": {
      const x = d as Partial<GateResultData>;
      if (!run.canary || typeof x.weight !== "number" || !x.gate) return run;
      const { weight, gate } = x;
      const steps = [...run.canary.steps];
      const t = ev.time;
      let i = steps.length - 1;
      while (i >= 0 && !(steps[i].weight === weight && !isAfter(steps[i].startedAt, t))) i--;
      if (i >= 0) steps[i] = { ...steps[i], endedAt: steps[i].endedAt ?? t, gate };
      else steps.push({ weight, startedAt: t, endedAt: t, gate });
      const passed = gate.passed ? run.canary.passed : false;
      return { ...run, canary: { ...run.canary, steps, passed } };
    }
    // After the cutover: the server emits observe_step when a step has ended,
    // so the event time is the step's endedAt.
    case "observe_step": {
      const x = d as Partial<ObserveStepData>;
      if (!x.verdict) return run;
      const obs: ObserveResult = run.observe ?? { options: {}, steps: [] };
      const t = ev.time;
      if (obs.steps.some((s) => s.endedAt === t)) return run;
      // The step started stepDuration before it ended. Times carry nanoseconds,
      // which Date.parse does not take everywhere, so parse them to milliseconds.
      const stepMs = parseDurationMs(obs.options.stepDuration);
      const endMs = Date.parse(t.replace(/(\.\d{3})\d*/, "$1"));
      const startedAt = stepMs !== undefined && !Number.isNaN(endMs) ? new Date(endMs - stepMs).toISOString() : t;
      const steps = [...obs.steps, { startedAt, endedAt: t, verdict: x.verdict, gate: x.gate }];
      const violated = x.verdict === "violated";
      return {
        ...run,
        observe: { ...obs, steps, ...(violated ? { passed: false, violation: x.gate?.reason ?? obs.violation } : {}) },
      };
    }
    case "observe_rollback": {
      const x = d as ObserveRollbackData;
      const obs: ObserveResult = run.observe ?? { options: {}, steps: [] };
      if (!x.rollbackRunId && !x.error) return run;
      return {
        ...run,
        observe: {
          ...obs,
          ...(x.rollbackRunId ? { rollbackRunId: x.rollbackRunId } : {}),
          ...(x.error ? { rollbackError: x.error } : {}),
        },
      };
    }
  }
  return run;
}

/** Milliseconds of a Go duration such as "20s", "1m30s" or "500ms"; undefined if it is not one. */
export function parseDurationMs(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const unit: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1, us: 0.001, "µs": 0.001, ns: 0.000001 };
  let total = 0;
  let rest = s;
  while (rest) {
    const m = /^(\d+(?:\.\d+)?)(h|ms|m|s|us|µs|ns)/.exec(rest);
    if (!m) return undefined;
    total += Number(m[1]) * unit[m[2]];
    rest = rest.slice(m[0].length);
  }
  return total;
}

export interface RunWatch {
  /** The latest snapshot with later events applied. */
  run: Run | undefined;
  /** Every event of the run so far, each once, in seq order. */
  events: RunEvent[];
  /** The last connection problem (cleared when a stream opens), or the error that stopped the watch. */
  error: ApiError | undefined;
  /** A stream is open right now. */
  connected: boolean;
}

interface RunState extends RunWatch {
  /** updatedAt of the latest snapshot: events up to this time are already in it. */
  since: string;
}

type RunAction =
  | { type: "reset" }
  | { type: "snapshot"; run: Run }
  | { type: "event"; event: RunEvent }
  | { type: "connected"; value: boolean }
  | { type: "error"; error: ApiError };

const idle: RunState = { run: undefined, events: [], error: undefined, connected: false, since: "" };

function runReducer(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case "reset":
      return idle;
    case "snapshot":
      return { ...s, run: a.run, since: a.run.updatedAt };
    case "event": {
      const run = s.run && isAfter(a.event.time, s.since) ? applyRunEvent(s.run, a.event) : s.run;
      return { ...s, run, events: [...s.events, a.event] };
    }
    case "connected":
      return { ...s, connected: a.value, error: a.value ? undefined : s.error };
    case "error":
      return { ...s, error: a.error };
  }
}

/** Follows one run live over SSE until it ends. A falsy `runId` watches nothing. */
export function useRun(runId: string | null | undefined): RunWatch {
  const [s, dispatch] = useReducer(runReducer, idle);
  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return;
    const ctrl = new AbortController();
    watchRun(
      runId,
      {
        onSnapshot: (run) => dispatch({ type: "snapshot", run }),
        onEvent: (event) => dispatch({ type: "event", event }),
        onConnection: (value) => dispatch({ type: "connected", value }),
        onRetry: (error) => dispatch({ type: "error", error }),
      },
      { signal: ctrl.signal },
    ).catch((e: unknown) => {
      if (!ctrl.signal.aborted) dispatch({ type: "error", error: toApiError(e) });
    });
    return () => ctrl.abort();
  }, [runId]);
  return { run: s.run, events: s.events, error: s.error, connected: s.connected };
}

// --- one agent session, live ---

export interface AgentSessionWatch {
  /**
   * The latest snapshot. Events do not update it, so while the session runs
   * its totals are as of the last connect; `events` is always complete.
   */
  session: AgentSession | undefined;
  /** Every event of the session so far, each once, in seq order. */
  events: AgentEvent[];
  /** The last connection problem (cleared when a stream opens), or the error that stopped the watch. */
  error: ApiError | undefined;
  /** A stream is open right now. */
  connected: boolean;
}

type SessionAction =
  | { type: "reset" }
  | { type: "snapshot"; session: AgentSession }
  | { type: "event"; event: AgentEvent }
  | { type: "connected"; value: boolean }
  | { type: "error"; error: ApiError };

const noSession: AgentSessionWatch = { session: undefined, events: [], error: undefined, connected: false };

function sessionReducer(s: AgentSessionWatch, a: SessionAction): AgentSessionWatch {
  switch (a.type) {
    case "reset":
      return noSession;
    case "snapshot":
      return { ...s, session: a.session };
    case "event":
      return { ...s, events: [...s.events, a.event] };
    case "connected":
      return { ...s, connected: a.value, error: a.value ? undefined : s.error };
    case "error":
      return { ...s, error: a.error };
  }
}

/** Follows one agent session live over SSE until it finishes. A falsy `id` watches nothing. */
export function useAgentSession(id: string | null | undefined): AgentSessionWatch {
  const [s, dispatch] = useReducer(sessionReducer, noSession);
  useEffect(() => {
    dispatch({ type: "reset" });
    if (!id) return;
    const ctrl = new AbortController();
    watchAgentSession(
      id,
      {
        onSnapshot: (session) => dispatch({ type: "snapshot", session }),
        onEvent: (event) => dispatch({ type: "event", event }),
        onConnection: (value) => dispatch({ type: "connected", value }),
        onRetry: (error) => dispatch({ type: "error", error }),
      },
      { signal: ctrl.signal },
    ).catch((e: unknown) => {
      if (!ctrl.signal.aborted) dispatch({ type: "error", error: toApiError(e) });
    });
    return () => ctrl.abort();
  }, [id]);
  return s;
}
