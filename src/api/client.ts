// Typed client for the HopCharlie platform API (platform/api/openapi.yaml).
//
// Every function returns the response body exactly as the contract defines it
// and throws ApiError on failure. Aborting the caller's signal rejects with
// the fetch AbortError instead, so callers can tell "cancelled" from "failed".
import type {
  AbortRequest,
  AuditList,
  EnginePlan,
  Environment,
  EnvironmentList,
  Health,
  Matrix,
  PlanList,
  PlanRecord,
  Principal,
  ReviewRequest,
  Run,
  RunList,
  StartMigrationRequest,
  StartMigrationResponse,
  TrafficState,
} from "./types";

/** An API failure. `status` is 0 when no HTTP response arrived (timeout, network, CORS). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
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

type Query = Record<string, string | number | undefined>;

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

/** @internal Decodes `{"error":{"code","message"}}`, falling back to the HTTP status. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // body unreadable: fall through to the status
  }
  try {
    const e = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error;
    if (e && typeof e.code === "string" && typeof e.message === "string") {
      return new ApiError(res.status, e.code, e.message);
    }
  } catch {
    // not JSON (a proxy page, for example)
  }
  return new ApiError(res.status, "http_" + res.status, text.trim().slice(0, 200) || res.statusText || "HTTP " + res.status);
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
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(method: "GET" | "POST", path: string, c: Call = {}): Promise<T> {
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
  if (c.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    const res = await fetch(apiUrl(path, c.query), {
      method,
      headers,
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await errorFromResponse(res);
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
export const approvePlan = (ref: string, review?: ReviewRequest, o?: RequestOptions) =>
  request<PlanRecord>("POST", `/v1/plans/${seg(ref)}/approve`, { ...o, body: review });
export const rejectPlan = (ref: string, review: ReviewRequest = {}, o?: RequestOptions) =>
  request<PlanRecord>("POST", `/v1/plans/${seg(ref)}/reject`, { ...o, body: review });

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
