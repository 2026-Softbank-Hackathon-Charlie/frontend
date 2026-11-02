import { renderHook, waitFor } from "@testing-library/react";
import { at, eventMsg, fakeRun, hang, installFetch, json, sequence, snapshotMsg, sse } from "./fakes";
import { applyRunEvent, isAfter, useAudit, useEnvironments, useRun, useTraffic } from "./hooks";
import type { Environment, GateResult } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const env = (name: string): Environment => ({
  name,
  provider: "gcp",
  displayName: name,
  kubeContext: name,
  gatewayBackend: name,
  live: true,
  status: { reachable: true, checkedAt: at(0) },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("polled hooks", () => {
  it("load, poll, and stop polling on unmount", async () => {
    const calls = installFetch(() => json(200, { environments: [env("gke")] }));
    const { result, unmount } = renderHook(() => useEnvironments(20));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data?.map((e) => e.name)).toEqual(["gke"]));
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

    unmount();
    const n = calls.length;
    await sleep(60);
    expect(calls.length).toBe(n);
  });

  it("abort the request in flight on unmount", async () => {
    const calls = installFetch(hang);
    const { unmount } = renderHook(() => useEnvironments());
    await waitFor(() => expect(calls).toHaveLength(1));
    unmount();
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it("keep the last data when a poll fails", async () => {
    let n = 0;
    installFetch(() => (n++ === 0 ? json(200, { environments: [env("gke")] }) : json(500, { error: { code: "internal", message: "x" } })));
    const { result, unmount } = renderHook(() => useEnvironments(10));
    await waitFor(() => expect(result.current.error?.code).toBe("internal"));
    expect(result.current.data?.[0].name).toBe("gke");
    unmount();
  });

  it("pass their parameters and reload on demand", async () => {
    const calls = installFetch((c) => json(200, c.url.startsWith("/v1/audit") ? { entries: [] } : {}));
    const traffic = renderHook(() => useTraffic(0, "30s"));
    const audit = renderHook(() => useAudit(5));
    await waitFor(() => expect(audit.result.current.data).toEqual([]));
    traffic.result.current.reload();
    await waitFor(() => expect(calls.filter((c) => c.url === "/v1/traffic?window=30s")).toHaveLength(2));
    expect(calls.map((c) => c.url)).toContain("/v1/audit?limit=5");
    traffic.unmount();
    audit.unmount();
  });
});

describe("applyRunEvent and isAfter", () => {
  it("orders times to the nanosecond", () => {
    expect(isAfter(at(0, 200), at(0, 100))).toBe(true);
    expect(isAfter(at(0, 100), at(0, 100))).toBe(false);
    expect(isAfter("2026-11-02T03:00:01Z", at(0, 999_999_999))).toBe(true);
    expect(isAfter("2026-11-02T12:00:00+09:00", "2026-11-02T03:00:00.5Z")).toBe(false);
  });

  it("is idempotent for the platform kinds", () => {
    const gate: GateResult = { passed: true, reason: "ok", requests: 40, errorRate: 0, p95Millis: 120 };
    const base = fakeRun({ canary: { options: { weights: [10, 50, 10] }, steps: [] } });
    const ev = (seq: number, kind: string, data: Record<string, unknown>) => ({ seq, time: at(seq), runId: "run_1", kind, data });
    const evs = [
      ev(1, "status_changed", { status: "running", phase: "canary", reason: "" }),
      ev(2, "canary_step", { weight: 10, readWeights: { eks: 10, gke: 90 } }),
      ev(3, "gate_result", { weight: 10, gate }),
      ev(4, "canary_step", { weight: 50, readWeights: { eks: 50, gke: 50 } }),
      ev(5, "gate_result", { weight: 50, gate }),
      ev(6, "canary_step", { weight: 10, readWeights: { eks: 10, gke: 90 } }),
      ev(7, "metric", { downtimeMillis: 900 }),
    ];
    const once = evs.reduce(applyRunEvent, base);
    expect(evs.reduce(applyRunEvent, once)).toEqual(once);
    expect(once.canary?.steps).toEqual([
      { weight: 10, startedAt: at(2), endedAt: at(3), gate },
      { weight: 50, startedAt: at(4), endedAt: at(5), gate },
      { weight: 10, startedAt: at(6) }, // a repeated weight is a new step
    ]);
    expect([once.status, once.phase, once.result.downtimeMillis]).toEqual(["running", "canary", 900]);
  });
});

describe("useRun", () => {
  const gate = (passed: boolean): GateResult => ({ passed, reason: passed ? "ok" : "p95 900ms is above 800ms", requests: 40, errorRate: 0, p95Millis: passed ? 120 : 900 });
  const canary = { options: { weights: [10, 50] } };

  it("applies events newer than the snapshot", async () => {
    const calls = installFetch(
      sse(
        [
          snapshotMsg(fakeRun({ updatedAt: at(0, 100), canary: { ...canary, steps: [] } })),
          // Same millisecond as the snapshot but earlier: already in it.
          eventMsg(1, "status_changed", { status: "failed", phase: "done", reason: "stale" }, at(0, 50)),
          eventMsg(2, "status_changed", { status: "running", phase: "canary", reason: "" }, at(0, 200)),
          eventMsg(3, "canary_step", { weight: 10, readWeights: { eks: 10, gke: 90 } }),
          eventMsg(4, "gate_result", { weight: 10, gate: gate(false) }),
          eventMsg(5, "canary_step", { weight: 0, readWeights: { gke: 100 } }),
          eventMsg(6, "metric", { lagBytes: 1024 }),
          eventMsg(7, "log", undefined),
        ],
        "hang",
      ),
    );
    const { result, unmount } = renderHook(() => useRun("run_1"));
    await waitFor(() => expect(result.current.events).toHaveLength(7));

    const { run, connected, error } = result.current;
    expect(connected).toBe(true);
    expect(error).toBeUndefined();
    expect(run?.status).toBe("running");
    expect(run?.phase).toBe("canary");
    expect(run?.statusReason).toBeUndefined();
    expect(run?.canary?.steps).toEqual([{ weight: 10, startedAt: at(3), endedAt: at(4), gate: gate(false) }]);
    expect(run?.canary?.passed).toBe(false);
    expect(result.current.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    unmount();
    expect(calls[0].signal?.aborted).toBe(true);
  });

  const step = { weight: 10, startedAt: at(2), endedAt: at(22), gate: gate(true) };

  it("does not let replayed events older than a reconnect snapshot undo it", async () => {
    const calls = installFetch(
      sequence(
        sse([snapshotMsg(fakeRun({ updatedAt: at(0) }))], "drop"),
        sse(
          [
            snapshotMsg(
              fakeRun({ status: "awaiting_switch", phase: "awaiting_switch", updatedAt: at(30), canary: { ...canary, steps: [step] } }),
            ),
            // The history replay, seen part way through.
            eventMsg(1, "status_changed", { status: "running", phase: "canary", reason: "" }, at(1)),
            eventMsg(2, "canary_step", { weight: 10, readWeights: { eks: 10, gke: 90 } }, at(2)),
          ],
          "hang",
        ),
      ),
    );
    const { result, unmount } = renderHook(() => useRun("run_1"));
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    const run = result.current.run!;
    expect(calls.map((c) => c.headers.get("Last-Event-ID"))).toEqual([null, null]);
    expect([run.status, run.phase]).toEqual(["awaiting_switch", "awaiting_switch"]);
    expect(run.canary?.steps).toEqual([step]);
    unmount();
  });

  it("does not repeat what the snapshot already shows when updatedAt lags behind", async () => {
    installFetch(
      sse(
        [
          // The server took this snapshot after the gate ran but before it saved
          // the document again, so updatedAt is older than the gate_result event.
          snapshotMsg(fakeRun({ phase: "canary", updatedAt: at(3), canary: { ...canary, steps: [step] } })),
          eventMsg(3, "gate_result", { weight: 10, gate: gate(true) }, at(22)),
          eventMsg(4, "status_changed", { status: "awaiting_switch", phase: "awaiting_switch", reason: "" }, at(23)),
          eventMsg(5, "metric", { downtimeMillis: 900 }, at(40)),
        ],
        "hang",
      ),
    );
    const { result, unmount } = renderHook(() => useRun("run_1"));
    await waitFor(() => expect(result.current.events).toHaveLength(3));

    const run = result.current.run!;
    expect(run.canary?.steps).toEqual([step]);
    expect([run.status, run.phase]).toEqual(["awaiting_switch", "awaiting_switch"]);
    expect(run.result.downtimeMillis).toBe(900);
    unmount();
  });

  it("ends at the final snapshot", async () => {
    const calls = installFetch(sse([snapshotMsg(fakeRun()), eventMsg(1, "done"), snapshotMsg(fakeRun({ status: "succeeded", phase: "done" }))]));
    const { result } = renderHook(() => useRun("run_1"));
    await waitFor(() => expect(result.current.run?.status).toBe("succeeded"));
    await waitFor(() => expect(result.current.connected).toBe(false));
    await sleep(30);
    expect(calls).toHaveLength(1);
  });

  it("reports an error that stops the watch", async () => {
    installFetch(() => json(404, { error: { code: "run_not_found", message: "no run run_x" } }));
    const { result } = renderHook(() => useRun("run_x"));
    await waitFor(() => expect(result.current.error?.code).toBe("run_not_found"));
    expect(result.current.connected).toBe(false);
    expect(result.current.run).toBeUndefined();
  });

  it("watches nothing without a run id and starts over when it changes", async () => {
    const calls = installFetch((c) => sse([snapshotMsg(fakeRun({ runId: c.url.split("/")[3] }))], "hang")(c));
    const { result, rerender, unmount } = renderHook(({ id }: { id: string | null }) => useRun(id), {
      initialProps: { id: null as string | null },
    });
    await sleep(20);
    expect(calls).toHaveLength(0);

    rerender({ id: "run_a" });
    await waitFor(() => expect(result.current.run?.runId).toBe("run_a"));
    rerender({ id: "run_b" });
    await waitFor(() => expect(result.current.run?.runId).toBe("run_b"));
    expect(calls[0].signal?.aborted).toBe(true);
    unmount();
  });
});
