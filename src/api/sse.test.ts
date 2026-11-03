import { ApiError, setToken } from "./client";
import { agentEventMsg, deploymentEventMsg, eventMsg, fakeAgentSession, fakeDeployment, fakeRun, hang, installFetch, json, sequence, snapshotMsg, sse } from "./fakes";
import {
  isFinalDeploymentStatus,
  readSse,
  SseParser,
  watchAgentSession,
  watchDeployment,
  watchRun,
  type AgentWatchHandlers,
  type DeploymentWatchHandlers,
  type SseMessage,
  type WatchHandlers,
} from "./sse";
import type { AgentSessionStatus, DeploymentStatus, RunStatus } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

function parse(...chunks: string[]): SseMessage[] {
  const p = new SseParser();
  return chunks.flatMap((c) => p.push(c));
}

describe("SseParser", () => {
  it("joins multi-line data and reads event names", () => {
    expect(parse('event: snapshot\ndata: {"a":\ndata: 1}\n\n')).toEqual([{ event: "snapshot", data: '{"a":\n1}', id: "" }]);
  });

  it("skips comments and names unnamed events message", () => {
    expect(parse(": keep-alive\n\n:\n", "data: x\n\n")).toEqual([{ event: "message", data: "x", id: "" }]);
  });

  it("accepts CRLF and lone CR line ends", () => {
    expect(parse("data: a\r\n\r\n", "data: b\r\r")).toEqual([
      { event: "message", data: "a", id: "" },
      { event: "message", data: "b", id: "" },
    ]);
  });

  it("treats a CRLF split across chunks as one line end", () => {
    expect(parse("data: a\r", "\ndata: b\n\n")).toEqual([{ event: "message", data: "a\nb", id: "" }]);
  });

  it("carries the last id over and ignores an id with NUL", () => {
    const got = parse("id: 7\nevent: log\ndata: x\n\n", "event: snapshot\ndata: y\n\n", "id: 8\0\ndata: z\n\n");
    expect(got.map((m) => [m.event, m.id])).toEqual([
      ["log", "7"],
      ["snapshot", "7"],
      ["message", "7"],
    ]);
  });

  it("follows the spec for colons and spaces", () => {
    expect(parse("data\n\n", "data:x\n\n", "data:  x\n\n", "event\ndata: y\n\n").map((m) => [m.event, m.data])).toEqual([
      ["message", ""],
      ["message", "x"],
      ["message", " x"],
      ["message", "y"],
    ]);
  });

  it("strips a leading BOM and drops a message cut off by the end of the stream", () => {
    expect(parse("\ufeffdata: done\n\n", "data: partial\n")).toEqual([{ event: "message", data: "done", id: "" }]);
  });

  it("parses the same when bytes split inside a UTF-8 character", async () => {
    const bytes = new TextEncoder().encode('id: 1\nevent: log\ndata: {"message":"이전 시작"}\n\n: keep-alive\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const b of bytes) c.enqueue(new Uint8Array([b]));
        c.close();
      },
    });
    const got: SseMessage[] = [];
    let chunks = 0;
    await readSse(body, (m) => got.push(m), () => chunks++);
    expect(got).toEqual([{ event: "log", data: '{"message":"이전 시작"}', id: "1" }]);
    expect(chunks).toBe(bytes.length);
  });
});

describe("watchRun", () => {
  const snap = (status: RunStatus) => snapshotMsg(fakeRun({ status }));
  const log = (seq: number) => eventMsg(seq, "log", { n: seq });

  function recorder() {
    const r = { seqs: [] as number[], snaps: [] as string[], conn: [] as boolean[], retries: [] as string[] };
    const handlers: WatchHandlers = {
      onEvent: (e) => r.seqs.push(e.seq),
      onSnapshot: (run) => r.snaps.push(run.status),
      onConnection: (c) => r.conn.push(c),
      onRetry: (e) => r.retries.push(e.code),
    };
    return { r, handlers };
  }

  it("reconnects after a drop with Last-Event-ID and delivers each event once", async () => {
    setToken("tok");
    const calls = installFetch(
      sequence(
        sse([snap("running"), log(1), log(2), log(3)], "drop"),
        // A replay that overlaps what was already delivered.
        sse([snap("running"), log(2), log(3), log(4), snap("succeeded")], "close"),
      ),
    );
    const { r, handlers } = recorder();
    await watchRun("run_1", handlers, { minDelayMs: 1 });

    expect(r.seqs).toEqual([1, 2, 3, 4]);
    expect(r.snaps).toEqual(["running", "running", "succeeded"]);
    expect(r.conn).toEqual([true, false, true, false]);
    expect(r.retries).toEqual(["network_error"]);
    expect(calls.map((c) => c.headers.get("Last-Event-ID"))).toEqual([null, "3"]);
    expect(calls[0].url).toBe("/v1/migrations/run_1/events");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer tok");
    expect(calls[0].headers.get("Accept")).toBe("text/event-stream");
    // CORS allows only Authorization, Content-Type, Idempotency-Key, Last-Event-ID and X-Request-Id.
    expect(calls[0].headers.has("Cache-Control")).toBe(false);
  });

  it("reads a finished run's history until the server closes", async () => {
    const calls = installFetch(sse([snap("rolled_back"), log(1), log(2), snap("rolled_back")]));
    const { r, handlers } = recorder();
    await watchRun("run_1", handlers);
    expect(r.seqs).toEqual([1, 2]);
    expect(r.snaps).toEqual(["rolled_back", "rolled_back"]);
    expect(calls).toHaveLength(1);
  });

  it("reconnects when the stream of an active run closes", async () => {
    const calls = installFetch(sequence(sse([snap("awaiting_switch"), log(1)]), sse([snap("succeeded")])));
    const { r, handlers } = recorder();
    await watchRun("run_1", handlers, { minDelayMs: 1 });
    expect(r.retries).toEqual(["stream_closed"]);
    expect(calls.map((c) => c.headers.get("Last-Event-ID"))).toEqual([null, "1"]);
  });

  it("starts after the given seq", async () => {
    const calls = installFetch(sse([snap("succeeded")]));
    await watchRun("run_1", {}, { after: 41 });
    expect(calls[0].headers.get("Last-Event-ID")).toBe("41");
  });

  it("retries 5xx and network errors, and stops on 4xx", async () => {
    const calls = installFetch(
      sequence(
        () => json(503, { error: { code: "internal", message: "busy" } }),
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => json(401, { error: { code: "unauthorized", message: "missing or invalid token" } }),
      ),
    );
    const { r, handlers } = recorder();
    const err = await watchRun("run_1", handlers, { minDelayMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "unauthorized" });
    expect(r.retries).toEqual(["internal", "network_error"]);
    expect(calls).toHaveLength(3);
  });

  it("rejects a stream that breaks the contract", async () => {
    installFetch(() => json(200, { not: "a stream" }));
    await expect(watchRun("run_1", {})).rejects.toMatchObject({ code: "invalid_stream" });

    installFetch(sse(["event: snapshot\ndata: {oops\n\n"], "hang"));
    await expect(watchRun("run_1", {})).rejects.toMatchObject({ code: "invalid_stream" });
  });

  it("reconnects a stream that goes silent past the idle timeout", async () => {
    installFetch(sequence(sse([snap("running")], "hang"), sse([snap("succeeded")])));
    const { r, handlers } = recorder();
    await watchRun("run_1", handlers, { minDelayMs: 1, idleTimeoutMs: 30 });
    expect(r.retries).toEqual(["timeout"]);
    expect(r.snaps).toEqual(["running", "succeeded"]);
  });

  it("keeps a stream open while keep-alives arrive", async () => {
    const keepAlives = Array.from({ length: 6 }, () => ": keep-alive\n\n");
    const calls = installFetch(sse([snap("awaiting_switch"), ...keepAlives, snap("succeeded")], "close", 15));
    const { r, handlers } = recorder();
    await watchRun("run_1", handlers, { minDelayMs: 1, idleTimeoutMs: 50 });
    expect(r.retries).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("resolves on abort and calls no handler afterwards", async () => {
    const ctrl = new AbortController();
    const calls = installFetch(sse([snap("running")], "hang"));
    const { r, handlers } = recorder();
    const done = watchRun("run_1", { ...handlers, onSnapshot: () => ctrl.abort() }, { signal: ctrl.signal });
    await expect(done).resolves.toBeUndefined();
    expect(calls[0].signal?.aborted).toBe(true);
    expect(r.conn).toEqual([true]);
    expect(r.retries).toEqual([]);
  });

  it("stops waiting for the server when aborted during connect", async () => {
    const ctrl = new AbortController();
    installFetch(hang);
    const done = watchRun("run_1", {}, { signal: ctrl.signal });
    ctrl.abort();
    await expect(done).resolves.toBeUndefined();
  });
});

describe("watchAgentSession", () => {
  const snap = (status: AgentSessionStatus) => snapshotMsg(fakeAgentSession({ status }));
  const ev = (seq: number) => agentEventMsg(seq, seq % 2 ? "tool_call" : "tool_result", { tool: "kubectl" });

  function recorder() {
    const r = { seqs: [] as number[], snaps: [] as string[], conn: [] as boolean[], retries: [] as string[] };
    const handlers: AgentWatchHandlers = {
      onEvent: (e) => r.seqs.push(e.seq),
      onSnapshot: (s) => r.snaps.push(s.status),
      onConnection: (c) => r.conn.push(c),
      onRetry: (e) => r.retries.push(e.message),
    };
    return { r, handlers };
  }

  it("replays after a reconnect without duplicates and resolves on a final snapshot", async () => {
    setToken("tok");
    const calls = installFetch(
      sequence(
        sse([snap("running"), ev(1), ev(2)], "drop"),
        // The replay overlaps what was already delivered.
        sse([snap("running"), ev(2), ev(3), snap("succeeded")], "close"),
      ),
    );
    const { r, handlers } = recorder();
    await watchAgentSession("ags_1", handlers, { minDelayMs: 1 });

    expect(r.seqs).toEqual([1, 2, 3]);
    expect(r.snaps).toEqual(["running", "running", "succeeded"]);
    expect(r.conn).toEqual([true, false, true, false]);
    expect(calls.map((c) => c.headers.get("Last-Event-ID"))).toEqual([null, "2"]);
    expect(calls[0].url).toBe("/v1/agent/sessions/ags_1/events");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer tok");
    expect(calls[0].headers.get("Accept")).toBe("text/event-stream");
  });

  it("reconnects while the session runs and treats failed and cancelled as final", async () => {
    const calls = installFetch(sequence(sse([snap("running"), ev(1)]), sse([snap("cancelled")])));
    const { r, handlers } = recorder();
    await watchAgentSession("ags_1", handlers, { minDelayMs: 1 });
    expect(r.retries).toEqual(["event stream closed while the session is active"]);
    expect(calls.map((c) => c.headers.get("Last-Event-ID"))).toEqual([null, "1"]);

    const finished = installFetch(sse([snap("failed"), ev(1), ev(2), snap("failed")]));
    const second = recorder();
    await watchAgentSession("ags_1", second.handlers);
    expect(second.r.seqs).toEqual([1, 2]);
    expect(finished).toHaveLength(1);
  });
});

describe("watchDeployment", () => {
  const snap = (status: DeploymentStatus) => snapshotMsg(fakeDeployment({ status }));
  const log = (seq: number) => deploymentEventMsg(seq, "log", { phase: "building", message: "#" + seq });

  function recorder() {
    const r = { seqs: [] as number[], snaps: [] as string[], retries: [] as string[] };
    const handlers: DeploymentWatchHandlers = {
      onEvent: (e) => r.seqs.push(e.seq),
      onSnapshot: (d) => r.snaps.push(d.status),
      onRetry: (e) => r.retries.push(e.message),
    };
    return { r, handlers };
  }

  it("resumes with Last-Event-ID without duplicates and resolves after the final snapshot", async () => {
    setToken("tok");
    const calls = installFetch(
      sequence(
        sse([snap("building"), log(1), log(2)], "drop"),
        sse([snap("building"), log(2), log(3), deploymentEventMsg(4, "done", { phase: "healthy" }), snap("healthy")], "close"),
      ),
    );
    const { r, handlers } = recorder();
    await watchDeployment("dep_1", handlers, { minDelayMs: 1 });
    expect(r.seqs).toEqual([1, 2, 3, 4]);
    expect(r.snaps).toEqual(["building", "building", "healthy"]);
    expect(calls.map((c) => c.headers.get("Last-Event-ID"))).toEqual([null, "2"]);
    expect(calls[0].url).toBe("/v1/deployments/dep_1/events");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer tok");
  });

  it("keeps a queued deployment open and treats failed and superseded as final", async () => {
    const calls = installFetch(sequence(sse([snap("queued")]), sse([snap("superseded")])));
    const { r, handlers } = recorder();
    await watchDeployment("dep_1", handlers, { minDelayMs: 1 });
    expect(r.retries).toEqual(["event stream closed while the deployment is active"]);
    expect(calls).toHaveLength(2);

    const finished = installFetch(sse([snap("failed"), log(1), snap("failed")]));
    const second = recorder();
    await watchDeployment("dep_1", second.handlers);
    expect(second.r.seqs).toEqual([1]);
    expect(finished).toHaveLength(1);
    const unfinished: DeploymentStatus[] = ["queued", "building", "committing", "syncing"];
    expect(unfinished.some(isFinalDeploymentStatus)).toBe(false);
  });
});
