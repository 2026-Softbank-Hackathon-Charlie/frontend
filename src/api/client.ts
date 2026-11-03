// Typed client for the HopCharlie platform API (platform/api/openapi.yaml).
//
// Every function returns the response body exactly as the contract defines it
// and throws ApiError on failure. Aborting the caller's signal rejects with
// the fetch AbortError instead, so callers can tell "cancelled" from "failed".
import type {
  AbortRequest,
  AgentEvent,
  AgentEventList,
  AgentSession,
  AgentSessionList,
  App,
  AppCreated,
  AppCreateRequest,
  AppInstanceCreated,
  AppInstanceCreateRequest,
  AppList,
  AppSpecValidateRequest,
  AppSpecValidation,
  AuditList,
  Deployment,
  DeploymentCreateRequest,
  DeploymentList,
  EnginePlan,
  Environment,
  EnvironmentList,
  GitHubRepoList,
  Health,
  Matrix,
  PlanAttachment,
  PlanDraftRequest,
  PlanList,
  PlanRecord,
  Principal,
  ReviewRequest,
  RollbackRequest,
  Run,
  RunList,
  SecurityReport,
  SecuritySeverity,
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

  constructor(status: number, code: string, message: string, validation?: AppSpecValidation) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (validation) this.validation = validation;
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
// The token lives in memory. With { persist: true } it is also written to
// sessionStorage so a reload keeps the login for this tab. Anything that runs
// script on the console origin (an XSS bug, a malicious extension) can read
// sessionStorage, so persist only short-lived tokens. The token is never
// logged and never put in an error message.

const TOKEN_KEY = "hopcharlie.token";

let token: string | null = readStoredToken();

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage disabled or unavailable
  }
}

/** Set the bearer token. `null` clears it. Without `persist`, any stored copy is removed. */
export function setToken(value: string | null, opts: { persist?: boolean } = {}): void {
  token = value && value.trim() ? value.trim() : null;
  try {
    if (token && opts.persist) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage disabled: the in-memory token still works
  }
}

export function hasToken(): boolean {
  return token !== null;
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

/** @internal Decodes `{"error":{"code","message"}}` (and the `validation` of a 422), falling back to the HTTP status. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
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
      return new ApiError(res.status, e.code, e.message, asValidation(body.validation));
    }
  } catch {
    // not JSON (a proxy page, for example)
  }
  return new ApiError(res.status, "http_" + res.status, text.trim().slice(0, 200) || res.statusText || "HTTP " + res.status);
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

  const headers = authHeaders({ Accept: "application/json", ...c.headers });
  if (c.bytes !== undefined) headers.set("Content-Type", "application/octet-stream");
  else if (c.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    const res = await fetch(apiUrl(path, c.query), {
      method,
      headers,
      body: c.bytes ?? (c.body === undefined ? undefined : JSON.stringify(c.body)),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await errorFromResponse(res);
    if (c.noContent) {
      await res.body?.cancel();
      return undefined as T;
    }
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

// --- plans ---

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
/** `window` is a duration between 1s and 5m; the server defaults to 10s. */
export const getTraffic = (window?: string, o?: RequestOptions) =>
  request<TrafficState>("GET", "/v1/traffic", { ...o, query: { window } });
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
 * does not deploy; 422 as for createApp.
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
export const getDeployment = (id: string, o?: RequestOptions) =>
  request<Deployment>("GET", `/v1/deployments/${seg(id)}`, o);
/** The repositories the GitHub App installation can see, by full name. */
export const listGitHubRepos = (o?: RequestOptions) => request<GitHubRepoList>("GET", "/v1/github/repos", o);
