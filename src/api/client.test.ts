import {
  ApiError,
  approvePlan,
  getHealth,
  getPlan,
  getTraffic,
  hasToken,
  listAudit,
  newIdempotencyKey,
  rejectPlan,
  setToken,
  startMigration,
  switchMigration,
} from "./client";
import { hang, installFetch, json } from "./fakes";

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
