// Test doubles for the api tests. Nothing in the app imports this file.
import { vi } from "vitest";
import type { AgentEvent, AgentEventType, AgentSession, Deployment, DeploymentEvent, DeploymentEventType, Run, RunEvent } from "./types";

export interface FakeCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
  /** The body exactly as given to fetch. */
  raw: RequestInit["body"];
  signal: AbortSignal | undefined;
}

export type FakeHandler = (call: FakeCall) => Response | Promise<Response>;

const abortError = () => new DOMException("The operation was aborted.", "AbortError");

/** Replaces global fetch with `route` and records every call. Aborting a call's signal rejects it, like fetch. */
export function installFetch(route: FakeHandler): FakeCall[] {
  const calls: FakeCall[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const call: FakeCall = {
      url: String(input),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : undefined,
      raw: init.body,
      signal: init.signal ?? undefined,
    };
    calls.push(call);
    return new Promise<Response>((resolve, reject) => {
      if (call.signal?.aborted) return reject(abortError());
      call.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      Promise.resolve()
        .then(() => route(call))
        .then(resolve, reject);
    });
  });
  return calls;
}

/** Answers call n with handlers[n]; calls past the end fail like a network error. */
export function sequence(...handlers: FakeHandler[]): FakeHandler {
  let i = 0;
  return (call) => {
    const h = handlers[i++];
    if (!h) throw new TypeError("no more fake responses");
    return h(call);
  };
}

/** A route that never answers (until the call is aborted). */
export const hang: FakeHandler = () => new Promise<Response>(() => {});

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * An event stream that sends `chunks` one read at a time, `gapMs` apart, then
 * closes, drops (a network error) or hangs until the call is aborted.
 */
export function sse(chunks: string[], end: "close" | "drop" | "hang" = "close", gapMs = 0): FakeHandler {
  return (call) => {
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        start(c) {
          call.signal?.addEventListener("abort", () => {
            try {
              c.error(abortError());
            } catch {
              // already closed
            }
          });
        },
        async pull(c) {
          if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
          if (i < chunks.length) return c.enqueue(enc.encode(chunks[i++]));
          if (end === "close") return c.close();
          if (end === "drop") return c.error(new TypeError("network connection lost"));
          return new Promise<void>(() => {});
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  };
}

/** 2026-11-02T03:00:<s>.<ns>Z, nanosecond precision like the Go server. */
export function at(s: number, ns = 0): string {
  return `2026-11-02T03:00:${String(s).padStart(2, "0")}.${String(ns).padStart(9, "0")}Z`;
}

export function fakeRun(p: Partial<Run> = {}): Run {
  const t = at(0);
  return {
    runId: "run_1",
    planRef: "pln_1",
    planId: "shop",
    source: { env: "gke", namespace: "shop", cluster: "shop-db" },
    target: { env: "eks", namespace: "shop", cluster: "shop-db" },
    status: "running",
    phase: "sync",
    autoSwitch: false,
    startedBy: "operator",
    startedAt: t,
    updatedAt: t,
    result: {},
    engine: {
      runId: "run_1",
      planId: "shop",
      createdAt: t,
      updatedAt: t,
      outcome: "running",
      steps: {},
      writesHeld: false,
      sourceDemoted: false,
      promoteRequested: false,
      trafficOnTarget: false,
    },
    ...p,
  };
}

/** A snapshot message as the server writes it: no id. */
export function snapshotMsg(snapshot: Run | AgentSession | Deployment): string {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

/** A RunEvent message as the server writes it: the seq as id, the kind as event name. */
export function eventMsg(seq: number, kind: string, data?: Record<string, unknown>, time = at(seq)): string {
  const ev: RunEvent = { seq, time, runId: "run_1", kind, ...(data ? { data } : {}) };
  return `id: ${seq}\nevent: ${kind}\ndata: ${JSON.stringify(ev)}\n\n`;
}

export function fakeAgentSession(p: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "ags_1",
    kind: "plan",
    title: "shop gke to eks",
    actor: "planner",
    status: "running",
    createdAt: at(0),
    totals: { events: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMillis: 0 },
    ...p,
  };
}

/** An AgentEvent message as the server writes it: the seq as id, the type as event name. */
export function agentEventMsg(seq: number, type: AgentEventType = "tool_call", p: Partial<AgentEvent> = {}): string {
  const ev: AgentEvent = { seq, sessionId: "ags_1", time: at(seq), type, ...p };
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

export function fakeDeployment(p: Partial<Deployment> = {}): Deployment {
  return {
    id: "dep_1",
    app: "moimroom",
    branch: "main",
    instance: "moimroom",
    ref: "main",
    commit: "9fceb02d0ae598e95dc970b74767f19372d61af8",
    trigger: "register",
    triggeredBy: "operator",
    status: "queued",
    images: [],
    environments: [
      { env: "eks", status: "pending" },
      { env: "gke", status: "pending" },
    ],
    createdAt: at(0),
    ...p,
  };
}

/** A DeploymentEvent message as the server writes it: the seq as id, the type as event name. */
export function deploymentEventMsg(seq: number, type: DeploymentEventType, p: Partial<DeploymentEvent> = {}): string {
  const ev: DeploymentEvent = { seq, deploymentId: "dep_1", time: at(seq), type, ...p };
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(ev)}\n\n`;
}
