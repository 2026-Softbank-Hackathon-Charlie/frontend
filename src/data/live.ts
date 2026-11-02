// Live mode: the pages read the platform API (src/api) instead of the simulation.
// It is on while an API token is set. The token stays in memory unless the operator asks to keep it for this tab.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, baseUrl, hasToken, listPlans, networkError, setToken } from "../api/client";
import type { PlanRecord } from "../api/types";

const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  listeners.forEach((l) => l());
}

export function connect(token: string, persist: boolean): void {
  setToken(token.trim(), { persist });
  bump();
}

export function disconnect(): void {
  setToken(null);
  bump();
}

/** True while an API token is set: pages read the platform API. */
export function useLive(): boolean {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return hasToken();
}

/** Where requests go, for the connection dialog. */
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
  if (e.status === 401) return "토큰이 맞지 않습니다";
  if (e.status === 403) return "이 토큰의 역할로는 할 수 없습니다 (operator 토큰 필요)";
  if (e.status === 409) return "상태가 그사이 바뀌었습니다: " + e.message;
  return e.message || "요청 실패 (" + e.status + ")";
}
