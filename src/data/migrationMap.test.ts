import { at, fakeRun } from "../api/fakes";
import type { Run, RunEvent, TrafficState } from "../api/types";
import { mapEvents, mapFacts } from "./migrationMap";

const ev = (seq: number, kind: string, p: Partial<RunEvent> = {}): RunEvent => ({ seq, time: at(seq), runId: "run_1", kind, ...p });
const run = (p: Partial<Run> = {}, engine: Partial<Run["engine"]> = {}) => fakeRun({ ...p, engine: { ...fakeRun().engine, ...engine } });
const canary = (weights: number[]): Run["canary"] => ({
  options: { weights: [10, 50, 100] },
  steps: weights.map((weight, i) => ({ weight, startedAt: at(i + 1) })),
});
const stats = (requests: number, errorRate: number, p95Millis: number, rps = 5) => ({ windowSeconds: 30, requests, errors: Math.round(requests * errorRate), errorRate, rps, p50Millis: 10, p95Millis, p99Millis: p95Millis });
const traffic = (p: Partial<TrafficState>): TrafficState => ({
  writeBackend: "gke",
  readWeights: { gke: 100 },
  writesHeld: false,
  heldWrites: 0,
  maxHold: "30s",
  inFlight: {} as TrafficState["inFlight"],
  backends: [],
  stats: {},
  totals: {},
  updatedAt: at(9),
  ...p,
});
const bk = { src: "gke", tgt: "eks" };

describe("migration map facts", () => {
  it("keeps each event once and drops other runs' events, so a reconnect replay adds no log lines", () => {
    const events = [ev(2, "log"), ev(1, "log"), ev(2, "log"), ev(3, "log", { runId: "run_2" })];
    expect(mapEvents(run(), events).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("reads the target share from the run's canary steps while writes stay on the source", () => {
    const f = mapFacts(run({ phase: "canary", canary: canary([10, 50]) }), []);
    expect([f.readShare, f.write, f.fromGateway]).toEqual([50, "source", false]);
  });

  it("puts reads back on the source after a canary_step with weight 0", () => {
    expect(mapFacts(run({ phase: "canary", canary: canary([10, 50]) }), [ev(5, "canary_step", { data: { weight: 0 } })]).readShare).toBe(0);
  });

  it("takes where requests go, the target's error rate and rps from the gateway when it knows both backends", () => {
    const t = traffic({ readWeights: { gke: 70, eks: 30 }, stats: { gke: stats(400, 0, 50, 12), eks: stats(120, 0.02, 140, 3) } });
    const f = mapFacts(run({ phase: "canary", canary: canary([10]) }), [], t, bk);
    expect([f.readShare, f.write, f.fromGateway, f.rps]).toEqual([30, "source", true, 15]);
    expect(f.slo).toMatchObject({ errorRate: 0.02, p95Millis: 140, from: "gateway" });
  });

  it("ignores a gateway that serves other backends", () => {
    const f = mapFacts(run({ canary: canary([10]) }), [], traffic({ writeBackend: "other", readWeights: { other: 100 } }), bk);
    expect([f.readShare, f.fromGateway]).toEqual([10, false]);
  });

  it("does not show a halted run as rolled back: the record cannot say where traffic stands", () => {
    const f = mapFacts(run({ status: "halted", phase: "done" }, { promoteRequested: true, trafficOnTarget: true }), []);
    expect([f.uncertain, f.readShare, f.write]).toEqual([true, undefined, "unknown"]);
  });

  it("a halted run still shows the gateway's real state when it is known", () => {
    const f = mapFacts(run({ status: "halted", phase: "done" }), [], traffic({ writeBackend: "eks", readWeights: { eks: 100 } }), bk);
    expect([f.uncertain, f.readShare, f.write]).toEqual([true, 100, "target"]);
  });

  it("moves data only while the run is active: copy during presync, replication until promotion", () => {
    const copy = mapFacts(run({}, { steps: { presync: { status: "running", startedAt: at(1) } } }), []);
    const cdc = mapFacts(run({ status: "awaiting_switch", phase: "awaiting_switch" }, { steps: { delta: { status: "succeeded", endedAt: at(2) } } }), []);
    const stopped = mapFacts(run({ status: "failed", phase: "done" }, { steps: { presync: { status: "running" } } }), []);
    expect([copy.sync, cdc.sync, stopped.sync]).toEqual(["copy", "cdc", "none"]);
  });

  it("leaves lag unmeasured until a metric arrives, and takes the newest one", () => {
    expect(mapFacts(run(), []).lag).toBeUndefined();
    const f = mapFacts(run(), [ev(1, "metric", { data: { lagBytes: 4096 } }), ev(2, "metric", { data: { downtimeMillis: 10 } }), ev(3, "metric", { data: { lagBytes: 512 } })]);
    expect([f.lag, f.lagAt]).toEqual([512, at(3)]);
  });
});
