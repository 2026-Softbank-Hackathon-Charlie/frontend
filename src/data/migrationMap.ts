// What the migration map draws, derived only from the run snapshot, its events and the gateway's
// traffic state. No timers, no simulated progress: a value the record does not hold is left undefined.
import { isAfter } from "../api/hooks";
import type { Run, RunEvent, StepStatus, TrafficState } from "../api/types";
import { ENGINE_STEPS } from "../sim/mig";

export type MapStepState = StepStatus | "skipped";

export function lastOf<T>(xs: readonly T[], ok: (x: T) => boolean): T | undefined {
  for (let i = xs.length - 1; i >= 0; i--) if (ok(xs[i])) return xs[i];
  return undefined;
}

/** Only this run's events, once per seq, in server order: a reconnect replay never doubles a line. */
export function mapEvents(r: Run, events: RunEvent[]): RunEvent[] {
  const bySeq = new Map<number, RunEvent>();
  for (const e of events) if (e.runId === r.runId) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Engine step states: the snapshot, brought forward by step events newer than the snapshot's record. */
export function mapSteps(r: Run, events: RunEvent[]): Record<string, MapStepState> {
  const steps: Record<string, MapStepState> = {};
  for (const { id } of ENGINE_STEPS) steps[id] = r.engine.steps[id]?.status ?? (id === "start-target" && r.engine.steps.cutover ? "skipped" : "pending");
  for (const e of events) {
    if (!e.step || !(e.step in steps)) continue;
    const rec = r.engine.steps[e.step];
    const at = rec?.endedAt ?? rec?.startedAt;
    if (at && isAfter(at, e.time)) continue;
    if (e.kind === "step_started") steps[e.step] = "running";
    else if (e.kind === "step_succeeded") steps[e.step] = "succeeded";
    else if (e.kind === "step_skipped") steps[e.step] = "skipped";
    else if (e.kind === "step_failed") steps[e.step] = "failed";
  }
  return steps;
}

export interface MapFacts {
  steps: Record<string, MapStepState>;
  active: boolean;
  /** halted or interrupted: the record alone cannot say where traffic and the database roles stand */
  uncertain: boolean;
  /** share of reads on the target, 0 to 100; undefined when unknown */
  readShare?: number;
  write: "source" | "target" | "held" | "unknown";
  cutover: boolean;
  promoted: boolean;
  /** the data pipe between the two lanes */
  sync: "copy" | "cdc" | "none";
  lag?: number;
  lagAt?: string;
  /** the target's error rate (0 to 1) and p95: the gateway's window, else the last gate */
  slo?: { errorRate: number; p95Millis: number; requests: number; at?: string; from: "gateway" | "gate" };
  /** requests per second at the gateway, all backends */
  rps?: number;
  /** the traffic numbers come from the gateway right now (not from the run record) */
  fromGateway: boolean;
  latest: string;
}

/** `backends` names the source and target at the gateway (Environment.gatewayBackend, default the env name). */
export function mapFacts(r: Run, input: RunEvent[], traffic?: TrafficState, backends?: { src: string; tgt: string }): MapFacts {
  const events = mapEvents(r, input);
  const steps = mapSteps(r, events);
  const active = r.status === "running" || r.status === "awaiting_switch";
  const uncertain = r.status === "halted" || r.status === "interrupted";
  const cutover = r.engine.trafficOnTarget || steps.cutover === "succeeded";
  const promoted = steps.switchover === "succeeded";

  let readShare: number | undefined = cutover ? 100 : (r.canary?.steps.at(-1)?.weight ?? 0);
  // canary_step weight 0 moves reads back to the source; the run's canary steps leave it out.
  const lastCanary = lastOf(events, (e) => e.kind === "canary_step" && typeof e.data?.weight === "number");
  if (!cutover && lastCanary?.data?.weight === 0) readShare = 0;
  if (r.status === "rolled_back") readShare = 0;
  if (uncertain || readShare < 0 || readShare > 100) readShare = undefined;
  let write: MapFacts["write"] = uncertain ? "unknown" : r.engine.writesHeld ? "held" : cutover && r.status !== "rolled_back" ? "target" : "source";

  // The gateway is the source of truth for where requests go right now.
  let slo: MapFacts["slo"];
  let rps: number | undefined;
  const known = traffic && backends && (backends.tgt in traffic.readWeights || backends.src in traffic.readWeights || [backends.src, backends.tgt].includes(traffic.writeBackend));
  if (traffic && backends && known) {
    readShare = traffic.readWeights[backends.tgt] ?? 0;
    write = traffic.writesHeld ? "held" : traffic.writeBackend === backends.tgt ? "target" : traffic.writeBackend === backends.src ? "source" : "unknown";
    const s = traffic.stats[backends.tgt];
    if (s && s.requests > 0) slo = { errorRate: s.errorRate, p95Millis: s.p95Millis, requests: s.requests, at: traffic.updatedAt, from: "gateway" };
    rps = Object.values(traffic.stats).reduce((t, x) => t + x.rps, 0);
  }
  if (!slo) {
    const observed = lastOf(r.observe?.steps ?? [], (s) => !!s.gate);
    const measured = lastOf(r.canary?.steps ?? [], (s) => !!s.gate);
    const g = observed?.gate ?? measured?.gate;
    if (g) slo = { errorRate: g.errorRate, p95Millis: g.p95Millis, requests: g.requests, at: observed?.endedAt ?? measured?.endedAt, from: "gate" };
  }

  const sync: MapFacts["sync"] = !active
    ? "none"
    : steps.presync === "running"
      ? "copy"
      : steps.delta === "running" || (steps.delta === "succeeded" && !promoted && !cutover)
        ? "cdc"
        : "none";
  const lagEvent = lastOf(events, (e) => e.kind === "metric" && typeof e.data?.lagBytes === "number" && (e.data.lagBytes as number) >= 0);
  const latest = events.reduce((at, e) => (isAfter(e.time, at) ? e.time : at), r.updatedAt);
  return {
    steps,
    active,
    uncertain,
    readShare,
    write,
    cutover,
    promoted,
    sync,
    lag: lagEvent?.data?.lagBytes as number | undefined,
    lagAt: lagEvent?.time,
    slo,
    rps,
    fromGateway: !!known,
    latest,
  };
}
