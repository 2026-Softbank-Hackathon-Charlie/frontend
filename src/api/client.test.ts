import {
  ApiError,
  approvePlan,
  draftPlan,
  getAgentSession,
  getHealth,
  getPlan,
  getSecurity,
  getTraffic,
  getWrittenRecords,
  hasToken,
  listAgentEvents,
  listAgentSessions,
  listAllAgentEvents,
  listApps,
  listAudit,
  newIdempotencyKey,
  putPlanAttachment,
  rejectPlan,
  rollbackMigration,
  setToken,
  startMigration,
  switchMigration,
} from "./client";
import { at, hang, installFetch, json, sequence } from "./fakes";
import type { AgentEvent } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setToken(null);
  sessionStorage.clear();
});

describe("client errors", () => {
  it("decodes the contract's error body", async () => {
    installFetch(() => json(409, { error: { code: "run_state_conflict", message: "run is succeeded" } }));
    const err = await switchMigration("run_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ name: "ApiError", status: 409, code: "run_state_conflict", message: "run is succeeded" });
  });

  it("falls back to the HTTP status when the body is not the contract's", async () => {
    installFetch(() => new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(getHealth()).rejects.toMatchObject({ status: 502, code: "http_502", message: "<html>Bad gateway</html>" });

    installFetch(() => json(500, { error: "flat string" }));
    await expect(getHealth()).rejects.toMatchObject({ status: 500, code: "http_500" });

    installFetch(() => new Response("", { status: 404, statusText: "Not Found" }));
    await expect(getHealth()).rejects.toMatchObject({ status: 404, code: "http_404", message: "Not Found" });
  });

  it("reports network failures with status 0", async () => {
    installFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(getHealth()).rejects.toMatchObject({ status: 0, code: "network_error", message: "network error: Failed to fetch" });
  });

  it("reports a 2xx that is not JSON", async () => {
    installFetch(() => new Response("ok", { status: 200 }));
    await expect(getHealth()).rejects.toMatchObject({ status: 200, code: "invalid_response" });
  });

  it("times out", async () => {
    const calls = installFetch(hang);
    await expect(getHealth({ timeoutMs: 10 })).rejects.toMatchObject({ status: 0, code: "timeout" });
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it("rejects with the AbortError, not an ApiError, when the caller aborts", async () => {
    installFetch(hang);
    const ctrl = new AbortController();
    const p = getHealth({ signal: ctrl.signal });
    ctrl.abort();
    const err = await p.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ name: "AbortError" });
  });
});

describe("client requests", () => {
  it("sends the token, a JSON body and the Idempotency-Key", async () => {
    setToken("secret-token");
    const calls = installFetch(() =>
      json(202, { runId: "run_1", planRef: "pln_1", links: { self: "/v1/migrations/run_1", events: "/v1/migrations/run_1/events" } }),
    );
    const key = newIdempotencyKey();
    const res = await startMigration({ planRef: "pln_1", canary: { weights: [10, 50] } }, key);

    expect(res.runId).toBe("run_1");
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url).toBe("/v1/migrations");
    expect(c.headers.get("Authorization")).toBe("Bearer secret-token");
    expect(c.headers.get("Content-Type")).toBe("application/json");
    expect(c.headers.get("Idempotency-Key")).toBe(key);
    expect(JSON.parse(c.body!)).toEqual({ planRef: "pln_1", canary: { weights: [10, 50] } });
  });

  it("builds paths and queries", async () => {
    const calls = installFetch(() => json(200, {}));
    await getPlan("a/b");
    await getTraffic("30s");
    await getTraffic();
    await listAudit({ limit: 5, before: 9 });
    await approvePlan("pln_1");
    await rejectPlan("pln_1");
    expect(calls.map((c) => c.url)).toEqual([
      "/v1/plans/a%2Fb",
      "/v1/traffic?window=30s",
      "/v1/traffic",
      "/v1/audit?limit=5&before=9",
      "/v1/plans/pln_1/approve",
      "/v1/plans/pln_1/reject",
    ]);
    // approve's body is optional; reject's is required.
    expect([calls[4].body, calls[4].headers.has("Content-Type")]).toEqual([undefined, false]);
    expect(calls[5].body).toBe("{}");
    expect(calls[0].headers.has("Authorization")).toBe(false);
  });

  it("uploads an attachment as raw bytes", async () => {
    setToken("secret-token");
    const calls = installFetch(() => json(200, { name: "target.yaml", size: 14, sha256: "ab" }));
    const bytes = new TextEncoder().encode("kind: Cluster\n");
    const res = await putPlanAttachment("pln_1", "target.yaml", bytes);
    await putPlanAttachment("pln_1", "a b", "text");

    expect(res).toEqual({ name: "target.yaml", size: 14, sha256: "ab" });
    const c = calls[0];
    expect(c.method).toBe("PUT");
    expect(c.url).toBe("/v1/plans/pln_1/attachments/target.yaml");
    expect(c.headers.get("Authorization")).toBe("Bearer secret-token");
    expect(c.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(c.raw).toBe(bytes);
    expect([calls[1].url, calls[1].raw, calls[1].headers.get("Content-Type")]).toEqual([
      "/v1/plans/pln_1/attachments/a%20b",
      "text",
      "application/octet-stream",
    ]);
  });

  it("builds the queries and bodies of the security, agent and plan tool calls", async () => {
    const calls = installFetch(() => json(200, {}));
    await getSecurity({ environment: "gke", severity: "high", refresh: true });
    await getSecurity();
    await listAgentSessions({ planRef: "pln_1", limit: 20 });
    await listAgentSessions();
    await getAgentSession("ags/1");
    await listAgentEvents("ags_1", { after: 5, limit: 100 });
    await listAgentEvents("ags_1");
    await listApps();
    await getWrittenRecords("k6-orders");
    await draftPlan({ app: "shop", source: "gke", target: "eks" });
    await rollbackMigration("run_1");
    await rollbackMigration("run_1", { reason: "p95 regressed", autoSwitch: false });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /v1/security?environment=gke&severity=high&refresh=true",
      "GET /v1/security",
      "GET /v1/agent/sessions?planRef=pln_1&limit=20",
      "GET /v1/agent/sessions",
      "GET /v1/agent/sessions/ags%2F1",
      "GET /v1/agent/sessions/ags_1/events?format=json&after=5&limit=100",
      "GET /v1/agent/sessions/ags_1/events?format=json",
      "GET /v1/apps",
      "GET /v1/written-records/k6-orders",
      "POST /v1/plans/draft",
      "POST /v1/migrations/run_1/rollback",
      "POST /v1/migrations/run_1/rollback",
    ]);
    // The JSON page is chosen by format=json; the Accept header stays the client's usual one.
    expect(calls[5].headers.get("Accept")).toBe("application/json");
    expect(JSON.parse(calls[9].body!)).toEqual({ app: "shop", source: "gke", target: "eks" });
    // A rollback's body is optional, and it takes no Idempotency-Key.
    expect([calls[10].body, calls[10].headers.has("Idempotency-Key")]).toEqual([undefined, false]);
    expect(JSON.parse(calls[11].body!)).toEqual({ reason: "p95 regressed", autoSwitch: false });
  });

  it("reads every agent event by following nextAfter", async () => {
    const ev = (seq: number): AgentEvent => ({ seq, sessionId: "ags_1", time: at(seq), type: "tool_call" });
    const calls = installFetch(
      sequence(
        () => json(200, { events: [ev(1), ev(2)], nextAfter: 2 }),
        () => json(200, { events: [ev(3), ev(4)], nextAfter: 4 }),
        () => json(200, { events: [ev(5)] }),
      ),
    );
    const events = await listAllAgentEvents("ags_1");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(calls.map((c) => c.url)).toEqual([
      "/v1/agent/sessions/ags_1/events?format=json",
      "/v1/agent/sessions/ags_1/events?format=json&after=2",
      "/v1/agent/sessions/ags_1/events?format=json&after=4",
    ]);

    installFetch(() => json(200, { events: [], nextAfter: 0 }));
    await expect(listAllAgentEvents("ags_1")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("keeps the token in sessionStorage only when asked, and never logs it", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    setToken("t1", { persist: true });
    expect(sessionStorage.getItem("hopcharlie.token")).toBe("t1");
    setToken("t2");
    expect(sessionStorage.getItem("hopcharlie.token")).toBeNull();
    expect(hasToken()).toBe(true);

    installFetch(() => json(401, { error: { code: "unauthorized", message: "missing or invalid token" } }));
    const err = await getHealth().catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain("t2");

    setToken(null);
    expect(hasToken()).toBe(false);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
});
