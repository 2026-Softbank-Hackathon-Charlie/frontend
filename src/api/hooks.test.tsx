import { renderHook, waitFor } from "@testing-library/react";
import { agentEventMsg, at, deploymentEventMsg, eventMsg, fakeAgentSession, fakeDeployment, fakeRun, hang, installFetch, json, sequence, snapshotMsg, sse } from "./fakes";
import {
  applyDeploymentEvent,
  applyRunEvent,
  deploymentRank,
  isAfter,
  parseDurationMs,
  useAgentSession,
  useAgentSessions,
  useApp,
  useApps,
  useAppSpecValidation,
  useAudit,
  useDeployment,
  useDeployments,
  useEnvironments,
  useGitHubRepos,
  useRun,
  useSecurity,
  useTraffic,
} from "./hooks";
import type { DeploymentEvent, Environment, GateResult, SecuritySeverity } from "./types";

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

  it("pass the security and agent session filters, and refetch only when they change", async () => {
    const calls = installFetch((c) => {
      if (c.url.startsWith("/v1/security")) return json(200, { generatedAt: at(0), summary: {}, sources: [], findings: [] });
      if (c.url.startsWith("/v1/apps")) return json(200, { apps: [] });
      return json(200, { sessions: [fakeAgentSession()] });
    });
    // Every render passes a new filter object with the same values.
    const security = renderHook(({ severity }: { severity: SecuritySeverity }) => useSecurity(0, { severity }), {
      initialProps: { severity: "high" as SecuritySeverity },
    });
    const sessions = renderHook(() => useAgentSessions(0, { runId: "run_1" }));
    const apps = renderHook(() => useApps());
    await waitFor(() => expect(sessions.result.current.data?.map((s) => s.id)).toEqual(["ags_1"]));
    await waitFor(() => expect(security.result.current.data?.findings).toEqual([]));
    await waitFor(() => expect(apps.result.current.data).toEqual([]));
    security.rerender({ severity: "high" });
    sessions.rerender();
    await sleep(20);
    expect(calls.map((c) => c.url).sort()).toEqual(["/v1/agent/sessions?runId=run_1", "/v1/apps", "/v1/security?severity=high"]);

    security.rerender({ severity: "critical" });
    await waitFor(() => expect(calls.map((c) => c.url)).toContain("/v1/security?severity=critical"));
    security.unmount();
    sessions.unmount();
    apps.unmount();
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

  it("follows the observe phase after the cutover", () => {
    const ok: GateResult = { passed: true, reason: "ok", requests: 230, errorRate: 0, p95Millis: 120 };
    const bad: GateResult = { passed: false, reason: "p95 1.2s over 800ms", requests: 240, errorRate: 0, p95Millis: 1200 };
    const base = fakeRun({ phase: "observe", observe: { options: { duration: "2m0s", stepDuration: "20s", autoRollback: true }, steps: [] } });
    const ev = (seq: number, kind: string, data: Record<string, unknown>) => ({ seq, time: at(seq, 500_000_000), runId: "run_1", kind, data });
    const evs = [
      ev(20, "observe_step", { verdict: "ok", gate: ok }),
      ev(40, "observe_step", { verdict: "violated", gate: bad }),
      ev(41, "observe_rollback", { rollbackRunId: "run_2" }),
    ];
    const once = evs.reduce(applyRunEvent, base);
    expect(evs.reduce(applyRunEvent, once)).toEqual(once); // replays change nothing
    expect(once.observe?.steps).toEqual([
      { startedAt: "2026-11-02T03:00:00.500Z", endedAt: at(20, 500_000_000), verdict: "ok", gate: ok },
      { startedAt: "2026-11-02T03:00:20.500Z", endedAt: at(40, 500_000_000), verdict: "violated", gate: bad },
    ]);
    expect([once.observe?.passed, once.observe?.violation, once.observe?.rollbackRunId]).toEqual([false, bad.reason, "run_2"]);

    // Events before any snapshot showed observe still build it.
    const bare = applyRunEvent(fakeRun(), ev(5, "observe_rollback", { error: "a rollback of this run already exists" }));
    expect(bare.observe).toEqual({ options: {}, steps: [], rollbackError: "a rollback of this run already exists" });
  });

  it("reads Go durations", () => {
    expect([parseDurationMs("20s"), parseDurationMs("1m30s"), parseDurationMs("500ms"), parseDurationMs("1h2m3.5s")]).toEqual([20_000, 90_000, 500, 3_723_500]);
    expect([parseDurationMs(""), parseDurationMs(undefined), parseDurationMs("soon")]).toEqual([undefined, undefined, undefined]);
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

  it("follows an ended run again when the epoch moves (resume revives the same run)", async () => {
    const calls = installFetch(
      sequence(sse([snapshotMsg(fakeRun({ status: "halted", phase: "done" }))]), sse([snapshotMsg(fakeRun({ status: "running", phase: "verify" }))], "hang")),
    );
    const { result, rerender, unmount } = renderHook(({ epoch }: { epoch: number }) => useRun("run_1", epoch), { initialProps: { epoch: 0 } });
    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(result.current.run?.status).toBe("halted");
    rerender({ epoch: 1 });
    await waitFor(() => expect(result.current.run?.status).toBe("running"));
    expect(calls).toHaveLength(2);
    unmount();
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

describe("useAgentSession", () => {
  it("accumulates events across a reconnect, each once", async () => {
    const calls = installFetch(
      sequence(
        sse([snapshotMsg(fakeAgentSession()), agentEventMsg(1, "tool_call"), agentEventMsg(2, "tool_result")], "drop"),
        sse(
          [
            snapshotMsg(fakeAgentSession({ totals: { events: 2, toolCalls: 1, inputTokens: 0, outputTokens: 0, durationMillis: 0 } })),
            agentEventMsg(2, "tool_result"),
            agentEventMsg(3, "message"),
          ],
          "hang",
        ),
      ),
    );
    const { result, unmount } = renderHook(() => useAgentSession("ags_1"));
    // The reconnect waits the default 500 ms backoff.
    await waitFor(
      () => expect(result.current.events.map((e) => [e.seq, e.type])).toEqual([[1, "tool_call"], [2, "tool_result"], [3, "message"]]),
      { timeout: 2000 },
    );

    const { session, connected, error } = result.current;
    expect(session?.totals.events).toBe(2);
    expect(connected).toBe(true);
    expect(error).toBeUndefined();
    expect(calls.map((c) => c.headers.get("Last-Event-ID"))).toEqual([null, "2"]);
    unmount();
    expect(calls[1].signal?.aborted).toBe(true);
  });

  it("ends at the final snapshot and watches nothing without an id", async () => {
    const calls = installFetch(
      sse([snapshotMsg(fakeAgentSession()), agentEventMsg(1), snapshotMsg(fakeAgentSession({ status: "succeeded", summary: "plan pln_1 submitted" }))]),
    );
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useAgentSession(id), {
      initialProps: { id: null as string | null },
    });
    await sleep(20);
    expect(calls).toHaveLength(0);

    rerender({ id: "ags_1" });
    await waitFor(() => expect(result.current.session?.status).toBe("succeeded"));
    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(result.current.events.map((e) => e.seq)).toEqual([1]);
    await sleep(30);
    expect(calls).toHaveLength(1);
  });
});

describe("deploy hooks", () => {
  const ev = (seq: number, type: DeploymentEvent["type"], p: Partial<DeploymentEvent> = {}): DeploymentEvent => ({ seq, deploymentId: "dep_1", time: at(seq), type, ...p });

  it("applyDeploymentEvent only moves forward and leaves a final deployment alone", () => {
    let d = fakeDeployment({ status: "committing" });
    d = applyDeploymentEvent(d, ev(1, "phase", { phase: "building" })); // replayed history
    expect(d.status).toBe("committing");
    d = applyDeploymentEvent(d, ev(2, "phase", { phase: "syncing" }));
    expect(d.status).toBe("syncing");
    d = applyDeploymentEvent(d, ev(3, "environment", { env: "gke", message: "Synced, Healthy" }));
    expect(d.environments.find((e) => e.env === "gke")?.message).toBe("Synced, Healthy");
    expect(d.environments.find((e) => e.env === "gke")?.status).toBe("pending"); // the event carries no status
    const failed = applyDeploymentEvent(d, ev(4, "done", { phase: "failed", message: "eks did not become healthy in 10m" }));
    expect(failed).toMatchObject({ status: "failed", error: "eks did not become healthy in 10m", finishedAt: at(4) });
    expect(applyDeploymentEvent(failed, ev(5, "done", { phase: "healthy" }))).toBe(failed);
    expect(applyDeploymentEvent(failed, ev(4, "done", { phase: "failed" }))).toBe(failed);
    expect(deploymentRank("queued")).toBeLessThan(deploymentRank("syncing"));
  });

  it("useDeployment follows the stream and reads environment statuses again", async () => {
    const synced = fakeDeployment({
      status: "syncing",
      environments: [
        { env: "eks", status: "healthy", syncStatus: "Synced", healthStatus: "Healthy" },
        { env: "gke", status: "syncing" },
      ],
    });
    const stream = sse(
      [
        snapshotMsg(fakeDeployment()),
        deploymentEventMsg(1, "phase", { phase: "queued" }),
        deploymentEventMsg(2, "phase", { phase: "building" }),
        deploymentEventMsg(3, "log", { phase: "building", message: "#1 load build definition" }),
        deploymentEventMsg(4, "phase", { phase: "syncing" }),
        deploymentEventMsg(5, "environment", { env: "eks", message: "Synced, Healthy" }),
        deploymentEventMsg(6, "environment", { env: "gke", message: "OutOfSync, Progressing" }),
      ],
      "hang",
    );
    const calls = installFetch((c) => (c.url === "/v1/deployments/dep_1" ? json(200, synced) : stream(c)));
    const { result, unmount } = renderHook(() => useDeployment("dep_1", 5));
    await waitFor(() => expect(result.current.events).toHaveLength(6));
    expect(result.current.deployment?.status).toBe("syncing");
    expect(result.current.connected).toBe(true);
    // Two environment events in a row read the deployment once.
    await waitFor(() => expect(result.current.deployment?.environments[0].status).toBe("healthy"));
    await sleep(20);
    expect(calls.filter((c) => c.url === "/v1/deployments/dep_1")).toHaveLength(1);
    unmount();
  });

  it("useDeployment ends at the final snapshot without reading the deployment again", async () => {
    const calls = installFetch(
      sse([
        snapshotMsg(fakeDeployment({ status: "healthy", finishedAt: at(9) })),
        deploymentEventMsg(1, "environment", { env: "eks", message: "Synced, Healthy" }),
        deploymentEventMsg(2, "done", { phase: "healthy" }),
        snapshotMsg(fakeDeployment({ status: "healthy", finishedAt: at(9) })),
      ]),
    );
    const { result } = renderHook(() => useDeployment("dep_1", 5));
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    await waitFor(() => expect(result.current.connected).toBe(false));
    await sleep(30);
    expect(result.current.deployment?.status).toBe("healthy");
    expect(calls).toHaveLength(1);
  });

  it("useApp, useDeployments and useGitHubRepos read their resources; a missing name reads nothing", async () => {
    const calls = installFetch((c) => {
      if (c.url === "/v1/github/repos") return json(200, { repos: [{ fullName: "org/moimroom", private: false, defaultBranch: "main", htmlUrl: "" }] });
      if (c.url.startsWith("/v1/apps/moimroom/deployments")) return json(200, { deployments: [fakeDeployment()] });
      return json(200, { name: "moimroom", namespace: "moimroom", database: { name: "app", user: "app", schemas: [] }, environments: [] });
    });
    const repos = renderHook(() => useGitHubRepos());
    const app = renderHook(({ name }: { name?: string }) => useApp(name), { initialProps: {} as { name?: string } });
    const deps = renderHook(() => useDeployments("moimroom", 0, 10));
    await waitFor(() => expect(repos.result.current.data?.[0].fullName).toBe("org/moimroom"));
    await waitFor(() => expect(deps.result.current.data?.[0].id).toBe("dep_1"));
    expect(app.result.current).toMatchObject({ data: undefined, loading: false });
    expect(calls.some((c) => c.url === "/v1/apps/moimroom")).toBe(false);
    app.rerender({ name: "moimroom" });
    await waitFor(() => expect(app.result.current.data?.name).toBe("moimroom"));
    expect(calls.map((c) => c.url)).toContain("/v1/apps/moimroom/deployments?limit=10");
  });

  it("useAppSpecValidation checks once after typing stops, and again on reload", async () => {
    const calls = installFetch((c) => json(200, { valid: JSON.parse(c.body!).branch === "main", errors: [] }));
    const { result, rerender } = renderHook(({ branch }: { branch: string }) => useAppSpecValidation("org/moimroom", branch, 20), {
      initialProps: { branch: "m" },
    });
    expect(result.current.loading).toBe(true);
    rerender({ branch: "ma" });
    rerender({ branch: "mai" });
    rerender({ branch: "main" });
    await waitFor(() => expect(result.current.data?.valid).toBe(true));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body!)).toEqual({ repo: "org/moimroom", branch: "main" });

    result.current.reload();
    await waitFor(() => expect(calls).toHaveLength(2));
    rerender({ branch: "dev" });
    await waitFor(() => expect(result.current.data?.valid).toBe(false));

    const none = renderHook(() => useAppSpecValidation("", "main", 1));
    await sleep(20);
    expect(none.result.current).toMatchObject({ data: undefined, loading: false });
    expect(calls).toHaveLength(3);
  });
});
