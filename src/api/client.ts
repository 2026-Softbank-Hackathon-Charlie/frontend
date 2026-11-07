// Typed client for the HopCharlie platform API (platform/api/openapi.yaml).
//
// Every function returns the response body exactly as the contract defines it
// and throws ApiError on failure. Aborting the caller's signal rejects with
// the fetch AbortError instead, so callers can tell "cancelled" from "failed".
import type {
  SourceRetentionResponse,
  AbortRequest,
  AIRun,
  AIRunList,
  AIRunRequest,
  AgentEvent,
  AgentEventList,
  AgentSession,
  AgentSessionList,
  App,
  AppCreated,
  AppCreateRequest,
  AppEnvironmentAdded,
  AppEnvironmentAddRequest,
  AppEnvironmentRemoved,
  AppInstanceCreated,
  AppInstanceCreateRequest,
  AppList,
  AppSecrets,
  AppSecretsUpdate,
  AppSecretValue,
  AppSpecValidateRequest,
  AppSpecValidation,
  AuditList,
  Deployment,
  DeploymentCreateRequest,
  DeploymentList,
  DeviceLogin,
  DeviceLoginApproveRequest,
  EnginePlan,
  Environment,
  EnvironmentList,
  GitHubRepoList,
  Health,
  LoginRequest,
  Matrix,
  PlanAttachment,
  PlanDraftRequest,
  PlanList,
  PlanRecord,
  Principal,
  Role,
  ReviewRequest,
  RollbackRequest,
  Run,
  RunList,
  SecurityControlReport,
  SecurityException,
  SecurityExceptionList,
  SecurityExceptionRequest,
  SecurityOCSFExport,
  SecurityReport,
  SecuritySeverity,
  SecurityVulnerabilityReport,
  Session,
  StartMigrationRequest,
  StartMigrationResponse,
  TrafficState,
  WrittenRecordStats,
} from "./types";

/** An API failure. `status` is 0 when no HTTP response arrived (timeout, network, CORS). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** What failed in platform.yaml, for a 422 invalid_app_spec (the `validation` of AppSpecInvalid). */
  readonly validation?: AppSpecValidation;
  /** Seconds to wait before trying again, from the Retry-After header of a 429 too_many_attempts. */
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, validation?: AppSpecValidation, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (validation) this.validation = validation;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/** The check result of a 422 invalid_app_spec, to show like a POST /v1/apps/validate answer; undefined for any other failure. */
export function specInvalid(e: unknown): AppSpecValidation | undefined {
  return e instanceof ApiError && e.status === 422 ? e.validation : undefined;
}

/** The platform base URL without a trailing slash; empty means same origin. */
export const baseUrl: string = (import.meta.env.VITE_PLATFORM_URL ?? "").replace(/\/+$/, "");

export const DEFAULT_TIMEOUT_MS = 15_000;

// --- token ---
//
// The token lives in memory only. src/data/live.ts keeps the login session
// (in localStorage) and sets it here. The token is never logged and never put
// in an error message.

let token: string | null = null;

/** Set the bearer token. `null` clears it. */
export function setToken(value: string | null): void {
  token = value && value.trim() ? value.trim() : null;
}

const unauthorizedListeners = new Set<() => void>();

/**
 * Calls `cb` when a request or event stream that carried the current token
 * gets 401: the session is over (expired, logged out elsewhere, or revoked).
 * Returns the function that removes `cb`.
 */
export function onUnauthorized(cb: () => void): () => void {
  unauthorizedListeners.add(cb);
  return () => {
    unauthorizedListeners.delete(cb);
  };
}

// --- plumbing shared with sse.ts ---

type Query = Record<string, string | number | boolean | undefined>;

/** @internal */
export function apiUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
  const s = qs.toString();
  return baseUrl + path + (s ? "?" + s : "");
}

/** @internal Headers with the bearer token, if one is set. */
export function authHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers(extra);
  if (token) h.set("Authorization", "Bearer " + token);
  return h;
}

/**
 * @internal Tells the onUnauthorized listeners about a 401 to a request sent
 * with `sent` headers, if those carried the token that is still current. A
 * late answer to a request of an earlier session does not end the new one.
 */
export function noteUnauthorized(res: Response, sent: Headers): void {
  if (res.status !== 401 || token === null || sent.get("Authorization") !== "Bearer " + token) return;
  for (const cb of [...unauthorizedListeners]) cb();
}

/** @internal Decodes `{"error":{"code","message"}}` (and the `validation` of a 422), falling back to the HTTP status. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  const retryAfter = retryAfterOf(res);
  let text = "";
  try {
    text = await res.text();
  } catch {
    // body unreadable: fall through to the status
  }
  try {
    const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown }; validation?: unknown };
    const e = body.error;
    if (e && typeof e.code === "string" && typeof e.message === "string") {
      return new ApiError(res.status, e.code, e.message, asValidation(body.validation), retryAfter);
    }
  } catch {
    // not JSON (a proxy page, for example)
  }
  return new ApiError(res.status, "http_" + res.status, text.trim().slice(0, 200) || res.statusText || "HTTP " + res.status, undefined, retryAfter);
}

/** Retry-After in seconds. The contract sends an integer; the HTTP-date form is not used and reads as absent. */
function retryAfterOf(res: Response): number | undefined {
  const v = res.headers.get("Retry-After")?.trim();
  return v && /^\d+$/.test(v) ? Number(v) : undefined;
}

function asValidation(v: unknown): AppSpecValidation | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const x = v as Partial<AppSpecValidation>;
  return typeof x.valid === "boolean" && Array.isArray(x.errors) ? (v as AppSpecValidation) : undefined;
}

/** @internal Wraps a fetch rejection that is not a cancellation. */
export function networkError(e: unknown): ApiError {
  return new ApiError(0, "network_error", "network error: " + (e instanceof Error ? e.message : String(e)));
}

const seg = encodeURIComponent;

export interface RequestOptions {
  signal?: AbortSignal;
  /** Defaults to DEFAULT_TIMEOUT_MS; covers the whole request including the body. */
  timeoutMs?: number;
}

interface Call extends RequestOptions {
  query?: Query;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as is, as application/octet-stream, instead of `body`. */
  bytes?: Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | string;
  headers?: Record<string, string>;
  /** The answer has no body (DELETE /v1/apps/{name} is a bare 202); resolve with undefined instead of parsing it. */
  noContent?: boolean;
  /** Let the request finish even if the page unloads (fetch keepalive). */
  keepalive?: boolean;
  /** The answer is raw bytes (application/octet-stream): resolve with its ArrayBuffer instead of parsing JSON. */
  raw?: boolean;
}

async function request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, c: Call = {}): Promise<T> {
  const ctrl = new AbortController();
  const ms = c.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  const cancel = () => ctrl.abort(c.signal?.reason);
  if (c.signal?.aborted) cancel();
  else c.signal?.addEventListener("abort", cancel, { once: true });

  // errors are JSON either way; a raw answer is the bytes as uploaded
  const headers = authHeaders({ Accept: c.raw ? "application/octet-stream, application/json" : "application/json", ...c.headers });
  if (c.bytes !== undefined) headers.set("Content-Type", "application/octet-stream");
  else if (c.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    const res = await fetch(apiUrl(path, c.query), {
      method,
      headers,
      body: c.bytes ?? (c.body === undefined ? undefined : JSON.stringify(c.body)),
      signal: ctrl.signal,
      keepalive: c.keepalive,
    });
    if (!res.ok) {
      noteUnauthorized(res, headers);
      throw await errorFromResponse(res);
    }
    if (c.noContent) {
      await res.body?.cancel();
      return undefined as T;
    }
    if (c.raw) return (await res.arrayBuffer()) as T;
    try {
      return (await res.json()) as T;
    } catch (e) {
      if (ctrl.signal.aborted) throw e;
      throw new ApiError(res.status, "invalid_response", "response is not JSON");
    }
  } catch (e) {
    if (timedOut) throw new ApiError(0, "timeout", `request timed out after ${ms} ms`);
    if (c.signal?.aborted || e instanceof ApiError) throw e;
    throw networkError(e);
  } finally {
    clearTimeout(timer);
    c.signal?.removeEventListener("abort", cancel);
  }
}

// --- system ---

export const getHealth = (o?: RequestOptions) => request<Health>("GET", "/healthz", o);
export const getMe = (o?: RequestOptions) => request<Principal>("GET", "/v1/me", o);

// --- auth ---

/**
 * Log an administrator in. The answer is a console session (role operator,
 * 12 hours); send its token with setToken. 401 invalid_credentials, 429
 * too_many_attempts (with retryAfter), 503 login_not_configured.
 */
export const login = (req: LoginRequest, o?: RequestOptions) => request<Session>("POST", "/v1/auth/login", { ...o, body: req });
/** End the session that sends it; the token answers 401 from then on. 204, no body. Sent with keepalive, so closing the tab right after does not cancel it. */
export const logout = (o?: RequestOptions) => request<void>("POST", "/v1/auth/logout", { ...o, noContent: true, keepalive: true });
// The three below need operator and a console session (a password login): a CLI or static token gets 403 console_session_required.

/** A CLI device login that has not expired, by the code the CLI shows. 404 device_login_not_found. */
export const getDeviceLogin = (userCode: string, o?: RequestOptions) =>
  request<DeviceLogin>("GET", `/v1/auth/device/${seg(userCode)}`, o);
/**
 * Let the CLI's next poll get a token (30 days) with the caller's name and
 * `role`. It also gives the CLI 10 more minutes to pick it up, so the answer's
 * expiresAt may be later. 400 for a missing or unknown role, 404, or 409
 * device_login_state_conflict.
 */
export const approveDeviceLogin = (userCode: string, role: Role, o?: RequestOptions) =>
  request<DeviceLogin>("POST", `/v1/auth/device/${seg(userCode)}/approve`, { ...o, body: { role } satisfies DeviceLoginApproveRequest });
/** The CLI's next poll gets access_denied. 404, or 409 device_login_state_conflict. */
export const denyDeviceLogin = (userCode: string, o?: RequestOptions) =>
  request<DeviceLogin>("POST", `/v1/auth/device/${seg(userCode)}/deny`, o);

// --- plans ---
export const getSourceRetention = (runId: string, o?: RequestOptions) => request<SourceRetentionResponse>("GET", `/v1/migrations/${seg(runId)}/retention`, o);
export const preserveSource = (runId: string, change: { keep: true } | { retainUntil: string }, o?: RequestOptions) => request<SourceRetentionResponse>("POST", `/v1/migrations/${seg(runId)}/retention`, { ...o, body: change });

export const listPlans = (o?: RequestOptions) => request<PlanList>("GET", "/v1/plans", o);
export const getPlan = (ref: string, o?: RequestOptions) => request<PlanRecord>("GET", `/v1/plans/${seg(ref)}`, o);
export const submitPlan = (plan: EnginePlan, o?: RequestOptions) =>
  request<PlanRecord>("POST", "/v1/plans", { ...o, body: plan });
/**
 * Approve a pending plan. Send the `revision` the user reviewed
 * (PlanRecord.revision): a plan with attachments needs it, and a revision
 * that changed since (an attachment was uploaded) fails with 409
 * plan_state_conflict. Approving twice is a no-op.
 */
export const approvePlan = (ref: string, review?: ReviewRequest, o?: RequestOptions) =>
  request<PlanRecord>("POST", `/v1/plans/${seg(ref)}/approve`, { ...o, body: review });
export const rejectPlan = (ref: string, review: ReviewRequest = {}, o?: RequestOptions) =>
  request<PlanRecord>("POST", `/v1/plans/${seg(ref)}/reject`, { ...o, body: review });
/** Every app: the ones in PLATFORM_APPS_FILE (what plans are drafted for) first, then the ones registered from GitHub. */
export const listApps = (o?: RequestOptions) => request<AppList>("GET", "/v1/apps", o);
/** A plan built from the server's configuration. It is not stored: submit it, as is or edited, with submitPlan. */
export const draftPlan = (req: PlanDraftRequest, o?: RequestOptions) =>
  request<EnginePlan>("POST", "/v1/plans/draft", { ...o, body: req });
/**
 * Start the AI runner (hopai) on the platform for one app and route: AI plan, sandbox rehearsal, diagnosis.
 * Operator only; 409 ai_run_active while one runs for the app, 503 ai_runner_not_configured without it.
 */
export const startAIRun = (req: AIRunRequest, o?: RequestOptions) => request<AIRun>("POST", "/v1/ai-runs", { ...o, body: req });
/** The AI runner's runs, newest first; `app` narrows to one app. */
export const listAIRuns = (app?: string, o?: RequestOptions) =>
  request<AIRunList>("GET", "/v1/ai-runs" + (app ? "?app=" + encodeURIComponent(app) : ""), o);
/**
 * Upload a file the plan refers to as `attachment:<name>`, at most 1 MiB, sent
 * as raw bytes. Only while the plan is pending_approval; the same name again
 * replaces it, and every upload raises the plan's revision by one.
 */
export const putPlanAttachment = (
  ref: string,
  name: string,
  body: Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | string,
  o?: RequestOptions,
) => request<PlanAttachment>("PUT", `/v1/plans/${seg(ref)}/attachments/${seg(name)}`, { ...o, bytes: body });
/** An attachment's content exactly as uploaded. 404 attachment_not_found. */
export const getPlanAttachment = (ref: string, name: string, o?: RequestOptions) =>
  request<ArrayBuffer>("GET", `/v1/plans/${seg(ref)}/attachments/${seg(name)}`, { ...o, raw: true });

// --- migrations ---

/** A random Idempotency-Key. Make one per user intent and reuse it on every retry of that start. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Start an approved plan. The same key returns the original run instead of starting a second one. */
export const startMigration = (req: StartMigrationRequest, idempotencyKey: string, o?: RequestOptions) =>
  request<StartMigrationResponse>("POST", "/v1/migrations", {
    ...o,
    body: req,
    headers: { "Idempotency-Key": idempotencyKey },
  });
export const listMigrations = (o?: RequestOptions) => request<RunList>("GET", "/v1/migrations", o);
export const getMigration = (runId: string, o?: RequestOptions) =>
  request<Run>("GET", `/v1/migrations/${seg(runId)}`, o);
export const switchMigration = (runId: string, o?: RequestOptions) =>
  request<Run>("POST", `/v1/migrations/${seg(runId)}/switch`, o);
export const abortMigration = (runId: string, req?: AbortRequest, o?: RequestOptions) =>
  request<Run>("POST", `/v1/migrations/${seg(runId)}/abort`, { ...o, body: req });
export const resumeMigration = (runId: string, o?: RequestOptions) =>
  request<Run>("POST", `/v1/migrations/${seg(runId)}/resume`, o);
/**
 * Migrate a succeeded run back the way it came, as a new plan and run that
 * both carry `rollbackOf`. It takes no Idempotency-Key: the server rolls a run
 * back at most once, so a retry restarts a rollback whose start failed, and
 * one that already started gets 409 run_state_conflict naming its run.
 */
export const rollbackMigration = (runId: string, req?: RollbackRequest, o?: RequestOptions) =>
  request<StartMigrationResponse>("POST", `/v1/migrations/${seg(runId)}/rollback`, { ...o, body: req });
/** How many records a written-records stream holds; a stream nobody wrote to has count 0. */
export const getWrittenRecords = (stream: string, o?: RequestOptions) =>
  request<WrittenRecordStats>("GET", `/v1/written-records/${seg(stream)}`, o);

// --- environments, traffic, matrix, audit ---

export const listEnvironments = (o?: RequestOptions) => request<EnvironmentList>("GET", "/v1/envs", o);
export const getEnvironment = (name: string, o?: RequestOptions) =>
  request<Environment>("GET", `/v1/envs/${seg(name)}`, o);
/**
 * `window` is a duration between 1s and 5m; the server defaults to 10s. `app` (a registered app, else 400) reads that
 * app's gateway scope, the one its migration routes; without it, the gateway's default app.
 */
export const getTraffic = (window?: string, app?: string, o?: RequestOptions) =>
  request<TrafficState>("GET", "/v1/traffic", { ...o, query: { window, app } });
export const getMatrix = (o?: RequestOptions) => request<Matrix>("GET", "/v1/matrix", o);
/** Newest first. Pass `nextBefore` from the previous page as `before`. */
export const listAudit = (q: { limit?: number; before?: number } = {}, o?: RequestOptions) =>
  request<AuditList>("GET", "/v1/audit", { ...o, query: q });

// --- security ---

export type SecurityQuery = {
  /** Only this environment, e.g. gke, aws-account or platform. An unknown name is a 400. */
  environment?: string;
  /** The minimum severity: high returns critical and high. */
  severity?: SecuritySeverity;
  /** Read the sources again instead of the 60 s cache; the server collects at most once every 10 s. */
  refresh?: boolean;
};

/** The filters apply to the findings and to every count. 503 security_not_configured when the server has no collectors. */
export const getSecurity = (q: SecurityQuery = {}, o?: RequestOptions) =>
  request<SecurityReport>("GET", "/v1/security", { ...o, query: q });

/** The same data as OCSF events: findings (2004/2003), vulnerabilities (2002) and control evaluations (2003). `severity` filters findings only. */
export const getSecurityOCSF = (q: SecurityQuery = {}, o?: RequestOptions) =>
  request<SecurityOCSFExport>("GET", "/v1/security/ocsf", { ...o, query: q });

export type SecurityPostureQuery = Omit<SecurityQuery, "severity">;

/** The HopCharlie control catalog, its evaluations and per-domain coverage. Older servers answer 404. */
export const getSecurityControls = (q: SecurityPostureQuery = {}, o?: RequestOptions) =>
  request<SecurityControlReport>("GET", "/v1/security/controls", { ...o, query: q });

/** Running images, their scan state and stored scan results. The server never scans in this call. */
export const getSecurityVulnerabilities = (q: SecurityPostureQuery = {}, o?: RequestOptions) =>
  request<SecurityVulnerabilityReport>("GET", "/v1/security/vulnerabilities", { ...o, query: q });

/** Every exception, active, expired and revoked. Role viewer. */
export const listSecurityExceptions = (o?: RequestOptions) =>
  request<SecurityExceptionList>("GET", "/v1/security/exceptions", o);
/**
 * Except one finding or vulnerability until expiresAt (at most 30 days, 7 for a KEV-listed CVE). It never changes
 * severity. 400 for a bad reason or expiry, 403 below operator, 409 when the target already has an active one.
 */
export const createSecurityException = (body: SecurityExceptionRequest, o?: RequestOptions) =>
  request<SecurityException>("POST", "/v1/security/exceptions", { ...o, body });
/** End an exception now; answers it with revokedAt. Role operator. */
export const revokeSecurityException = (id: string, o?: RequestOptions) =>
  request<SecurityException>("DELETE", `/v1/security/exceptions/${seg(id)}`, o);

// --- agent activity ---

export type AgentSessionQuery = {
  planRef?: string;
  runId?: string;
  /** 1 to 200; the server defaults to 50. */
  limit?: number;
};

/** Newest first. */
export const listAgentSessions = (q: AgentSessionQuery = {}, o?: RequestOptions) =>
  request<AgentSessionList>("GET", "/v1/agent/sessions", { ...o, query: q });
export const getAgentSession = (id: string, o?: RequestOptions) =>
  request<AgentSession>("GET", `/v1/agent/sessions/${seg(id)}`, o);
/**
 * One page of a session's stored events with seq above `after`, at most
 * `limit` (1 to 2000, server default 500). `nextAfter` is set when more
 * follow; pass it as the next `after`. watchAgentSession follows them live.
 */
export const listAgentEvents = (id: string, q: { after?: number; limit?: number } = {}, o?: RequestOptions) =>
  request<AgentEventList>("GET", `/v1/agent/sessions/${seg(id)}/events`, { ...o, query: { format: "json", ...q } });

/** Every stored event of a session in seq order, read page by page. `o` applies to each page. */
export async function listAllAgentEvents(id: string, o?: RequestOptions): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await listAgentEvents(id, { after: after || undefined }, o);
    out.push(...page.events);
    if (page.nextAfter === undefined) return out;
    // A cursor that does not move would ask for the same page forever.
    if (page.nextAfter <= after) throw new ApiError(200, "invalid_response", "nextAfter did not advance");
    after = page.nextAfter;
  }
}

// --- apps from GitHub and their deployments ---

/** One app as GET /v1/apps lists it; `deploy` is set for apps registered from GitHub. */
export const getApp = (name: string, o?: RequestOptions) => request<App>("GET", `/v1/apps/${seg(name)}`, o);
/**
 * Register a repository and queue its first deployment (trigger register).
 * A platform.yaml that breaks a rule fails with 422 invalid_app_spec; read
 * the check result with specInvalid(e). Role operator.
 */
export const createApp = (req: AppCreateRequest, o?: RequestOptions) =>
  request<AppCreated>("POST", "/v1/apps", { ...o, body: req });
/** Unregister an app. 202 means Argo CD is removing its workloads, and their data with them. Role operator. */
export const deleteApp = (name: string, o?: RequestOptions) =>
  request<void>("DELETE", `/v1/apps/${seg(name)}`, { ...o, noContent: true });
/** Check platform.yaml at the head of a branch (`repo`, `branch`) or given as `spec`. Always 200; `valid` says whether it passed. */
export const validateAppSpec = (req: AppSpecValidateRequest, o?: RequestOptions) =>
  request<AppSpecValidation>("POST", "/v1/apps/validate", { ...o, body: req });
/**
 * Deploy a registered app now (trigger manual). `branch` picks the instance
 * (default: the app's own branch, the default instance), `ref` defaults to
 * that branch, `environments` to all of the app's. 400 for a branch the app
 * does not deploy; 422 as for createApp. With `redeploy: true` (trigger
 * redeploy) nothing is built: the instance's last healthy deployment goes out
 * again with the secrets as they are now; 409 nothing_to_redeploy when it has
 * none, 400 with `ref`.
 */
export const createDeployment = (name: string, req?: DeploymentCreateRequest, o?: RequestOptions) =>
  request<Deployment>("POST", `/v1/apps/${seg(name)}/deployments`, { ...o, body: req });
/** Newest first, of every instance; `branch` keeps one branch's instance, `limit` 1 to 200 (server default 20) counts those alone. */
export const listDeployments = (name: string, q: { branch?: string; limit?: number } = {}, o?: RequestOptions) =>
  request<DeploymentList>("GET", `/v1/apps/${seg(name)}/deployments`, { ...o, query: q });
/**
 * Deploy another branch of a registered app as its own instance
 * `<app>--<slug>` (ADR 0015) and queue its first deployment (trigger
 * register). 409 branch_exists (the app's branch or one already added),
 * instance_exists (another branch has the same instance name) or
 * instance_limit (3 instances, the default one included); 422 as for
 * createApp. Role operator.
 */
export const createAppInstance = (name: string, req: AppInstanceCreateRequest, o?: RequestOptions) =>
  request<AppInstanceCreated>("POST", `/v1/apps/${seg(name)}/instances`, { ...o, body: req });
/** Remove an added instance with its namespace and data; 202 like deleteApp. The default instance is a 409 default_instance. Role operator. */
export const deleteAppInstance = (name: string, instance: string, o?: RequestOptions) =>
  request<void>("DELETE", `/v1/apps/${seg(name)}/instances/${seg(instance)}`, { ...o, noContent: true });
/**
 * Add an environment of this server to a registered app (ADR 0037) and queue a deployment of the default instance
 * (trigger environment) to all of the app's environments, without a build. 409 environment_exists,
 * deployment_in_progress, migration_in_progress, nothing_to_redeploy, db_pair_unavailable, app_not_registered;
 * 404 env_not_found; 503 storage_not_configured, sealing_not_configured. Role operator.
 */
export const addAppEnvironment = (name: string, req: AppEnvironmentAddRequest, o?: RequestOptions) =>
  request<AppEnvironmentAdded>("POST", `/v1/apps/${seg(name)}/environments`, { ...o, body: req });
/**
 * Take an environment out of a registered app with its namespaces and data there (ADR 0037). 409
 * primary_environment, write_backend, deployment_in_progress, migration_in_progress; 502 github_unreachable,
 * gateway_unreachable; 503 github_not_configured. Role operator.
 */
export const removeAppEnvironment = (name: string, env: string, o?: RequestOptions) =>
  request<AppEnvironmentRemoved>("DELETE", `/v1/apps/${seg(name)}/environments/${seg(env)}`, o);
export const getDeployment = (id: string, o?: RequestOptions) =>
  request<Deployment>("GET", `/v1/deployments/${seg(id)}`, o);

// --- app secrets (ADR 0019) ---
// Values travel only in the PUT body and the getAppSecret answer, never in a URL, and are never logged.

/** The names of the app-wide secrets and of each instance's overrides, without values. 503 secrets_not_configured when the server has no secrets key. Role viewer. */
export const listAppSecrets = (name: string, o?: RequestOptions) => request<AppSecrets>("GET", `/v1/apps/${seg(name)}/secrets`, o);
/**
 * Set and delete secrets in one change: app-wide without `instance`, or that
 * instance's overrides with it. Answers the names after the change. Running
 * instances keep the old values until a deployment (createDeployment with
 * `redeploy`). 400 invalid_request, 404 instance_not_found. Role operator.
 */
export const updateAppSecrets = (name: string, body: AppSecretsUpdate, o?: RequestOptions) =>
  request<AppSecrets>("PUT", `/v1/apps/${seg(name)}/secrets`, { ...o, body });
/** One value, for the show button; with `instance`, that instance's override. Every call is audited. 404 secret_not_found or instance_not_found. Role operator. */
export const getAppSecret = (name: string, secret: string, q: { instance?: string } = {}, o?: RequestOptions) =>
  request<AppSecretValue>("GET", `/v1/apps/${seg(name)}/secrets/${seg(secret)}`, { ...o, query: { instance: q.instance || undefined } });
/** The repositories the GitHub App installation can see, by full name. */
export const listGitHubRepos = (o?: RequestOptions) => request<GitHubRepoList>("GET", "/v1/github/repos", o);
