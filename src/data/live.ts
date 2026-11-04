// Mode and login.
//
// The console runs in demo mode (the simulation in src/sim, no login) or live
// mode (the platform API in src/api, behind an administrator login). The mode
// is kept in localStorage under hopcharlie.mode; with none stored the app asks
// first. The login session (token, expiresAt, principal) is kept under
// hopcharlie.session, so a reload or another tab stays logged in until it
// expires (12 hours) or the operator logs out. Script on the console origin
// can read localStorage, which is why sessions are short and end on logout.
// When storage is unavailable or throws, both live in memory for this page.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, baseUrl, listPlans, login, logout, networkError, onUnauthorized, setToken } from "../api/client";
import type { PlanRecord, Session } from "../api/types";

export type Mode = "demo" | "live";

export interface AuthState {
  /** null until the operator picks one. */
  mode: Mode | null;
  session: Session | null;
  /** Shown on the login screen, e.g. after the server ended the session. */
  notice: string | null;
}

const MODE_KEY = "hopcharlie.mode";
const SESSION_KEY = "hopcharlie.session";

export const EXPIRED_NOTICE = "세션이 만료되었습니다. 다시 로그인하세요";

const listeners = new Set<() => void>();
let auth: AuthState = { mode: null, session: null, notice: null };

function update(next: Partial<AuthState>): void {
  auth = { ...auth, ...next };
  setToken(auth.session?.token ?? null);
  listeners.forEach((l) => l());
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage disabled or unavailable
  }
}

/** `null` removes the key. */
function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage disabled: the in-memory state still works for this page
  }
}

/** The stored session if it is well formed and not expired; anything else is removed. */
function readSession(): Session | null {
  const raw = readStored(SESSION_KEY);
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw) as Partial<Session> | null;
    // The server sends nanoseconds; cut them to milliseconds, which Date.parse takes everywhere.
    const expires = typeof s?.expiresAt === "string" ? Date.parse(s.expiresAt.replace(/(\.\d{3})\d*/, "$1")) : NaN;
    if (s && typeof s.token === "string" && s.token && typeof s.principal?.name === "string" && expires > Date.now()) return s as Session;
  } catch {
    // not JSON
  }
  writeStored(SESSION_KEY, null);
  return null;
}

/** Reads the mode and session from storage, dropping an expired session. Runs on load; tests run it again after changing storage. */
export function initAuth(): void {
  const mode = readStored(MODE_KEY);
  update({ mode: mode === "demo" || mode === "live" ? mode : null, session: readSession(), notice: null });
}

initAuth();

// A request or stream that carried the session token got 401: back to the login screen.
onUnauthorized(() => {
  writeStored(SESSION_KEY, null);
  update({ session: null, notice: EXPIRED_NOTICE });
});

/** Switch modes. The session is kept, so switching back to live needs no new login. */
export function chooseMode(mode: Mode): void {
  writeStored(MODE_KEY, mode);
  update({ mode, notice: null });
}

/** Keep `session` as the login and switch to live mode. */
export function startSession(session: Session): void {
  writeStored(SESSION_KEY, JSON.stringify(session));
  writeStored(MODE_KEY, "live");
  update({ mode: "live", session, notice: null });
}

/** POST /v1/auth/login, then startSession. Rejects with the error for loginErrorText. */
export async function logIn(username: string, password: string): Promise<void> {
  startSession(await login({ username, password }));
}

/**
 * Ends the session on the server, best effort, and forgets it here at once
 * whatever the answer. The mode stays. The returned promise settles when the
 * server answered or the request failed.
 */
export function logOut(): Promise<void> {
  // logout() builds its headers before its first await, so the request carries the token cleared below.
  const done = auth.session ? logout().catch(() => {}) : Promise.resolve();
  writeStored(SESSION_KEY, null);
  update({ session: null, notice: null });
  return done;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => auth);
}

/** True in live mode with a session: pages read the platform API. Without a session the login screen replaces them. */
export function useLive(): boolean {
  const { mode, session } = useAuth();
  return mode === "live" && session !== null;
}

/** Where requests go, for the live-mode banner and the login screen. */
export function apiTarget(): string {
  return baseUrl || window.location.origin + " (같은 주소)";
}

/** Plan list, polled. src/api has no hook for it, so it lives here with the same shape as the others. */
export function usePlans(pollMs: number, enabled = true): { data: PlanRecord[] | undefined; error: ApiError | undefined; reload: () => void } {
  const [state, setState] = useState<{ data?: PlanRecord[]; error?: ApiError }>({});
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await listPlans({ signal: ctrl.signal });
        if (!ctrl.signal.aborted) setState({ data: res.plans });
      } catch (e) {
        if (!ctrl.signal.aborted) setState((s) => ({ data: s.data, error: e instanceof ApiError ? e : networkError(e) }));
      }
      if (!ctrl.signal.aborted && pollMs > 0) timer = setTimeout(tick, pollMs);
    };
    void tick();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [pollMs, enabled, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, reload };
}

/** A short Korean message for an API error. Never includes the token. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return "알 수 없는 오류";
  if (e.status === 0) return e.code === "timeout" ? "서버가 응답하지 않습니다 (시간 초과)" : "서버에 연결할 수 없습니다 (주소, CORS, 네트워크 확인)";
  if (e.status === 401) return EXPIRED_NOTICE;
  if (e.status === 403) return "이 계정의 역할로는 할 수 없습니다 (operator 필요)";
  // Refused by a pre-start check: the reasons are shown in the page's pre-start check box.
  if (e.code === "residency_denied") return "데이터 레지던시 정책에 걸려 이전을 시작하지 않았습니다. Plan은 승인된 채로 남아 있습니다.";
  if (e.code === "capacity_insufficient") return "측정한 용량이 부족해 이전을 시작하지 않았습니다. Plan은 승인된 채로 남아 있습니다.";
  if (e.status === 409) return "상태가 그사이 바뀌었습니다: " + e.message;
  return e.message || "요청 실패 (" + e.status + ")";
}

/** A short Korean message for a failed login. */
export function loginErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "아이디 또는 비밀번호가 맞지 않습니다";
    if (e.status === 429)
      return e.retryAfter !== undefined
        ? "로그인 시도가 너무 많습니다. " + e.retryAfter + "초 뒤에 다시 시도하세요"
        : "로그인 시도가 너무 많습니다. 잠시 뒤에 다시 시도하세요";
    if (e.code === "login_not_configured") return "서버에 관리자 계정이 설정되어 있지 않습니다";
  }
  return errorText(e);
}
