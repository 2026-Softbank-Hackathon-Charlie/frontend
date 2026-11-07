import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ApiError, getMigrationRecommendations, networkError } from "../api/client";
import type { Session } from "../api/types";
import { useAuth } from "./live";
import type { MigrationRecommendationReport } from "./recommendations";

interface State { report?: MigrationRecommendationReport; error?: ApiError; loading: boolean; retryAt: number }
interface Entry { state: State; listeners: Set<() => void>; pending?: { controller: AbortController } }
// Weak keys isolate users/logins without retaining credentials in a second store.
const sessions = new WeakMap<Session, Entry>();
const disconnected: Entry = { state: { loading: false, retryAt: 0 }, listeners: new Set() };
function entryFor(session: Session | null): Entry {
  if (!session) return disconnected;
  let entry = sessions.get(session);
  if (!entry) { entry = { state: { loading: true, retryAt: 0 }, listeners: new Set() }; sessions.set(session, entry); }
  return entry;
}
export const recommendationDeadline = (state: State) => Math.max(state.retryAt,
  state.report ? Date.parse(state.report.status === "generating" ? state.report.nextCheckAt ?? state.report.nextRefreshAt : state.report.nextRefreshAt) : 0);
function publish(entry: Entry, next: State) { entry.state = next; entry.listeners.forEach(listener => listener()); }
function subscribe(entry: Entry, listener: () => void) {
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    // React's development remount can immediately resubscribe. A real departure
    // cancels work after that microtask, before a late answer can enter the cache.
    const pending = entry.pending;
    queueMicrotask(() => {
      if (!entry.listeners.size && pending && entry.pending === pending) {
        entry.pending = undefined;
        pending.controller.abort();
        publish(entry, { ...entry.state, loading: false });
      }
    });
  };
}
async function load(entry: Entry) {
  if (entry === disconnected || entry.pending || Date.now() < recommendationDeadline(entry.state)) return;
  const pending = { controller: new AbortController() };
  entry.pending = pending;
  publish(entry, { ...entry.state, loading: true });
  try {
    const report = await getMigrationRecommendations(entry.state.report?.status === "generating", { signal: pending.controller.signal });
    if (entry.pending === pending && !pending.controller.signal.aborted) publish(entry, { report, loading: false, retryAt: 0 });
  } catch (error) {
    if (entry.pending === pending && !pending.controller.signal.aborted) {
      const failure = error instanceof ApiError ? error : networkError(error);
      publish(entry, { ...entry.state, error: failure, loading: false, retryAt: Date.now() + Math.max(60, failure.retryAfter ?? 0) * 1000 });
    }
  } finally { if (entry.pending === pending) entry.pending = undefined; }
}

/** One request on entry, then explicit refresh only. No poll/focus/background fetch. */
export function useRecommendations() {
  const { session } = useAuth();
  const entry = entryFor(session);
  const listen = useCallback((listener: () => void) => subscribe(entry, listener), [entry]);
  const snapshot = useCallback(() => entry.state, [entry]);
  const state = useSyncExternalStore(listen, snapshot);
  useEffect(() => { void load(entry); }, [entry]);
  const refresh = useCallback(() => { void load(entry); }, [entry]);
  return { ...state, refresh };
}
