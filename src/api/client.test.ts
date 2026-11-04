import {
  ApiError,
  approveDeviceLogin,
  approvePlan,
  createApp,
  createAppInstance,
  createDeployment,
  deleteApp,
  deleteAppInstance,
  denyDeviceLogin,
  draftPlan,
  getAgentSession,
  getApp,
  getDeployment,
  getDeviceLogin,
  getHealth,
  getPlan,
  getSecurity,
  getTraffic,
  getWrittenRecords,
  listAgentEvents,
  listAgentSessions,
  listAllAgentEvents,
  listApps,
  listAudit,
  listDeployments,
  listGitHubRepos,
  login,
  logout,
  newIdempotencyKey,
  onUnauthorized,
  putPlanAttachment,
  rejectPlan,
  rollbackMigration,
  setToken,
  specInvalid,
  startMigration,
  switchMigration,
  validateAppSpec,
} from "./client";
import { at, hang, installFetch, json, sequence } from "./fakes";
import type { AgentEvent } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setToken(null);
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

  it("keeps the token in memory only, and never logs it", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    setToken(" t2 ");
    const calls = installFetch(() => json(401, { error: { code: "unauthorized", message: "missing or invalid token" } }));
    const err = await getHealth().catch((e: unknown) => e);
    expect(calls[0].headers.get("Authorization")).toBe("Bearer t2");
    expect(String((err as Error).message)).not.toContain("t2");
    expect([sessionStorage.length, localStorage.length]).toEqual([0, 0]);

    setToken(null);
    await getHealth().catch(() => {});
    expect(calls[1].headers.has("Authorization")).toBe(false);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
});

describe("auth", () => {
  const device = { userCode: "BCDF-GHJK", client: "charlie v0.5.0 on rin-sbx-12", status: "pending", createdAt: at(0), expiresAt: at(10) };

  it("logs in without a token and logs out with one", async () => {
    const session = { token: "s1", expiresAt: "2026-11-02T15:00:00Z", principal: { name: "admin", role: "operator" } };
    const calls = installFetch((c) => (c.url === "/v1/auth/login" ? json(200, session) : new Response(null, { status: 204 })));
    expect(await login({ username: "admin", password: "pw" })).toEqual(session);
    setToken("s1");
    await expect(logout()).resolves.toBeUndefined();
    expect(calls.map((c) => c.method + " " + c.url)).toEqual(["POST /v1/auth/login", "POST /v1/auth/logout"]);
    expect(JSON.parse(calls[0].body!)).toEqual({ username: "admin", password: "pw" });
    expect(calls[0].headers.has("Authorization")).toBe(false);
    expect(calls[1].body).toBeUndefined();
    expect(calls[1].headers.get("Authorization")).toBe("Bearer s1");
    expect([calls[0].keepalive, calls[1].keepalive]).toEqual([undefined, true]);
  });

  it("looks up, approves and denies a device login by its code", async () => {
    setToken("s1");
    const calls = installFetch((c) => json(200, { ...device, status: c.url.endsWith("/approve") ? "approved" : c.url.endsWith("/deny") ? "denied" : "pending" }));
    expect((await getDeviceLogin("BCDF-GHJK")).client).toBe("charlie v0.5.0 on rin-sbx-12");
    expect((await approveDeviceLogin("BCDF-GHJK")).status).toBe("approved");
    expect((await denyDeviceLogin("bcdf ghjk")).status).toBe("denied");
    expect(calls.map((c) => c.method + " " + c.url)).toEqual([
      "GET /v1/auth/device/BCDF-GHJK",
      "POST /v1/auth/device/BCDF-GHJK/approve",
      "POST /v1/auth/device/bcdf%20ghjk/deny",
    ]);
    expect(calls.every((c) => c.headers.get("Authorization") === "Bearer s1")).toBe(true);

    installFetch(() => json(409, { error: { code: "device_login_state_conflict", message: "device login is approved" } }));
    await expect(approveDeviceLogin("BCDF-GHJK")).rejects.toMatchObject({ status: 409, code: "device_login_state_conflict" });
  });

  it("reads Retry-After in seconds", async () => {
    const tooMany = (headers: Record<string, string>, body = JSON.stringify({ error: { code: "too_many_attempts", message: "try later" } })) =>
      installFetch(() => new Response(body, { status: 429, headers: { "Content-Type": "application/json", ...headers } }));

    tooMany({ "Retry-After": "120" });
    await expect(login({ username: "a", password: "b" })).rejects.toMatchObject({ status: 429, code: "too_many_attempts", retryAfter: 120 });
    tooMany({ "Retry-After": " 7 " }, "<html>slow down</html>");
    await expect(login({ username: "a", password: "b" })).rejects.toMatchObject({ code: "http_429", retryAfter: 7 });
    for (const headers of [{}, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }, { "Retry-After": "-1" }] as Record<string, string>[]) {
      tooMany(headers);
      const e = (await login({ username: "a", password: "b" }).catch((x: unknown) => x)) as ApiError;
      expect(e.retryAfter).toBeUndefined();
    }
  });

  it("tells listeners about a 401 to a request that carried the current token", async () => {
    const lost = vi.fn();
    const off = onUnauthorized(lost);
    const unauthorized = () => json(401, { error: { code: "unauthorized", message: "missing or invalid token" } });

    // no token: a public call's 401 is its own answer (invalid_credentials), not a lost session
    installFetch(() => json(401, { error: { code: "invalid_credentials", message: "no" } }));
    await login({ username: "a", password: "b" }).catch(() => {});
    expect(lost).not.toHaveBeenCalled();

    setToken("s1");
    installFetch(() => json(403, { error: { code: "forbidden", message: "no" } }));
    await getHealth().catch(() => {});
    expect(lost).not.toHaveBeenCalled();

    installFetch(unauthorized);
    await expect(getHealth()).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);

    // the answer to a request of an earlier session does not end the new one
    let answer!: (r: Response) => void;
    const held = new Promise<Response>((r) => (answer = r));
    installFetch(() => held);
    const late = getHealth().catch(() => {});
    setToken("s2");
    answer(unauthorized());
    await late;
    expect(lost).toHaveBeenCalledTimes(1);

    off();
    installFetch(unauthorized);
    await getHealth().catch(() => {});
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("apps from GitHub", () => {
  const validation = { valid: false, spec: { name: "moimroom", services: [] }, commit: "9fceb02", errors: [{ path: "services[0].port", message: "must be between 1 and 65535" }] };

  it("reads a 422 invalid_app_spec as a check result, not only an error", async () => {
    installFetch(() => json(422, { error: { code: "invalid_app_spec", message: "platform.yaml breaks 1 rule" }, validation }));
    const e = await createApp({ repo: "org/moimroom", environments: ["eks"] }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 422, code: "invalid_app_spec", message: "platform.yaml breaks 1 rule" });
    expect(specInvalid(e)).toEqual(validation);

    // Any other failure has no check result.
    installFetch(() => json(409, { error: { code: "app_exists", message: "moimroom is registered" } }));
    expect(specInvalid(await createApp({ repo: "org/moimroom", environments: ["eks"] }).catch((x: unknown) => x))).toBeUndefined();
    installFetch(() => json(422, { error: { code: "invalid_app_spec", message: "x" }, validation: "broken" }));
    expect(specInvalid(await createApp({ repo: "org/moimroom", environments: ["eks"] }).catch((x: unknown) => x))).toBeUndefined();
  });

  it("sends the register, deploy, validate and list requests the contract describes", async () => {
    setToken("op");
    const calls = installFetch((c) => {
      if (c.url === "/v1/apps" && c.method === "POST") return json(201, { app: {}, deployment: { id: "dep_1" } });
      if (c.url === "/v1/apps/validate") return json(200, { valid: true, errors: [] });
      if (c.url.startsWith("/v1/apps/moimroom/deployments") && c.method === "POST") return json(202, { id: "dep_2" });
      if (c.url.startsWith("/v1/apps/moimroom/deployments")) return json(200, { deployments: [] });
      if (c.url === "/v1/deployments/dep_1") return json(200, { id: "dep_1" });
      if (c.url === "/v1/github/repos") return json(200, { repos: [] });
      return json(200, { name: "moimroom" });
    });
    expect((await createApp({ repo: "org/moimroom", branch: "main", environments: ["eks", "gke"], autoDeploy: false })).deployment.id).toBe("dep_1");
    await validateAppSpec({ repo: "org/moimroom", branch: "dev" });
    expect((await createDeployment("moimroom")).id).toBe("dep_2");
    await createDeployment("moimroom", { ref: "abc123", environments: ["eks"] });
    await listDeployments("moimroom", { limit: 5 });
    await getDeployment("dep_1");
    await getApp("moimroom");
    await listGitHubRepos();
    expect(calls.map((c) => c.method + " " + c.url)).toEqual([
      "POST /v1/apps",
      "POST /v1/apps/validate",
      "POST /v1/apps/moimroom/deployments",
      "POST /v1/apps/moimroom/deployments",
      "GET /v1/apps/moimroom/deployments?limit=5",
      "GET /v1/deployments/dep_1",
      "GET /v1/apps/moimroom",
      "GET /v1/github/repos",
    ]);
    expect(JSON.parse(calls[0].body!)).toEqual({ repo: "org/moimroom", branch: "main", environments: ["eks", "gke"], autoDeploy: false });
    expect(JSON.parse(calls[1].body!)).toEqual({ repo: "org/moimroom", branch: "dev" });
    expect(calls[2].body).toBeUndefined(); // the app's branch, all of its environments
    expect(JSON.parse(calls[3].body!)).toEqual({ ref: "abc123", environments: ["eks"] });
    expect(calls[0].headers.get("Authorization")).toBe("Bearer op");
  });

  it("deletes with a bare 202 and reports why a delete was refused", async () => {
    const calls = installFetch(() => new Response(null, { status: 202 }));
    await expect(deleteApp("moimroom")).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "/v1/apps/moimroom" });

    installFetch(() => json(409, { error: { code: "app_not_registered", message: "shop is only in PLATFORM_APPS_FILE" } }));
    await expect(deleteApp("shop")).rejects.toMatchObject({ status: 409, code: "app_not_registered" });
  });

  it("adds and removes a branch instance, and deploys or lists one branch", async () => {
    setToken("op");
    const calls = installFetch((c) => {
      if (c.url === "/v1/apps/moimroom/instances") return json(201, { instance: { name: "moimroom--feature-x" }, deployment: { id: "dep_3" } });
      if (c.method === "DELETE") return new Response(null, { status: 202 });
      if (c.method === "POST") return json(202, { id: "dep_4" });
      return json(200, { deployments: [] });
    });
    const added = await createAppInstance("moimroom", { branch: "feature/x", autoDeploy: false });
    expect([added.instance.name, added.deployment.id]).toEqual(["moimroom--feature-x", "dep_3"]);
    await expect(deleteAppInstance("moimroom", "moimroom--feature-x")).resolves.toBeUndefined();
    expect((await createDeployment("moimroom", { branch: "feature/x" })).id).toBe("dep_4");
    await listDeployments("moimroom", { branch: "feature/x", limit: 5 });
    expect(calls.map((c) => c.method + " " + c.url)).toEqual([
      "POST /v1/apps/moimroom/instances",
      "DELETE /v1/apps/moimroom/instances/moimroom--feature-x",
      "POST /v1/apps/moimroom/deployments",
      "GET /v1/apps/moimroom/deployments?branch=feature%2Fx&limit=5",
    ]);
    expect(JSON.parse(calls[0].body!)).toEqual({ branch: "feature/x", autoDeploy: false });
    expect(calls[1].body).toBeUndefined();
    expect(JSON.parse(calls[2].body!)).toEqual({ branch: "feature/x" });
    expect(calls[0].headers.get("Authorization")).toBe("Bearer op");
  });

  it("reports why a branch instance was refused", async () => {
    for (const code of ["branch_exists", "instance_exists", "instance_limit"]) {
      installFetch(() => json(409, { error: { code, message: "refused" } }));
      await expect(createAppInstance("moimroom", { branch: "dev" })).rejects.toMatchObject({ status: 409, code });
    }
    installFetch(() => json(422, { error: { code: "invalid_app_spec", message: "platform.yaml breaks 1 rule" }, validation }));
    expect(specInvalid(await createAppInstance("moimroom", { branch: "dev" }).catch((x: unknown) => x))).toEqual(validation);
    installFetch(() => json(409, { error: { code: "default_instance", message: "moimroom goes only with the app" } }));
    await expect(deleteAppInstance("moimroom", "moimroom")).rejects.toMatchObject({ status: 409, code: "default_instance" });
  });
});
