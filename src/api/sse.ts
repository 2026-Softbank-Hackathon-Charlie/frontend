// Server-Sent Events over fetch. EventSource cannot send the Authorization
// header, so the stream is read from a fetch body instead.
import { ApiError, apiUrl, authHeaders, errorFromResponse, networkError } from "./client";
import type { Run, RunEvent, RunStatus } from "./types";

// --- parser ---

export interface SseMessage {
  /** The event name; "message" when the stream gave none. */
  event: string;
  data: string;
  /** The last event id at dispatch time. Per the SSE spec it carries over to messages without an id. */
  id: string;
}

/**
 * An incremental parser for text/event-stream as the WHATWG HTML spec
 * describes it: LF, CRLF and lone CR line ends (also split across chunks),
 * comments, multi-line data, event names and ids. `retry` is ignored because
 * watchRun has its own backoff. A message cut off by the end of the stream is
 * never returned.
 */
export class SseParser {
  private rest = "";
  private afterCR = false;
  private first = true;
  private event = "";
  private data: string[] = [];
  private lastId = "";

  /** Feeds decoded text and returns the messages it completed. */
  push(text: string): SseMessage[] {
    if (this.first && text) {
      this.first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (this.afterCR && text) {
      this.afterCR = false;
      if (text[0] === "\n") text = text.slice(1); // the LF of a CRLF split across chunks
    }
    const out: SseMessage[] = [];
    const buf = this.rest + text;
    let start = 0;
    for (let i = this.rest.length; i < buf.length; i++) {
      const c = buf[i];
      if (c !== "\r" && c !== "\n") continue;
      this.line(buf.slice(start, i), out);
      if (c === "\r") {
        if (i + 1 === buf.length) this.afterCR = true;
        else if (buf[i + 1] === "\n") i++;
      }
      start = i + 1;
    }
    this.rest = buf.slice(start);
    return out;
  }

  private line(line: string, out: SseMessage[]): void {
    if (line === "") {
      if (this.data.length > 0) out.push({ event: this.event || "message", data: this.data.join("\n"), id: this.lastId });
      this.event = "";
      this.data = [];
      return;
    }
    if (line[0] === ":") return; // comment, e.g. ": keep-alive"
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value[0] === " ") value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.lastId = value;
  }
}

/** Reads a byte stream as SSE until it ends. `onChunk` runs for every chunk, keep-alives included. */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onMessage: (m: SseMessage) => void,
  onChunk?: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder(); // SSE is always UTF-8
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk?.();
      for (const m of parser.push(decoder.decode(value, { stream: true }))) onMessage(m);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// --- run events ---

/** running and awaiting_switch are active; every other status is final for a stream. */
export function isActiveStatus(s: RunStatus): boolean {
  return s === "running" || s === "awaiting_switch";
}

export interface WatchHandlers {
  /** Every connection starts with a snapshot, the source of truth at that moment; a run ends with one. */
  onSnapshot?(run: Run): void;
  /** Every stored event exactly once, in seq order, across reconnects. */
  onEvent?(event: RunEvent): void;
  /** true when a stream opened, false when it closed or dropped. */
  onConnection?(connected: boolean): void;
  /** A connection failed or dropped; watchRun reconnects after `delayMs`. */
  onRetry?(error: ApiError, delayMs: number): void;
}

export interface WatchOptions {
  signal?: AbortSignal;
  /** Replay only events with a greater seq. Default 0: the whole history. */
  after?: number;
  /** Backoff between reconnects. Defaults 500 ms and 15 s. */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Until response headers arrive. Default 15 s. */
  connectTimeoutMs?: number;
  /** No byte at all, not even a keep-alive (sent every 15 s), for this long means a dead stream. Default 45 s. */
  idleTimeoutMs?: number;
}

const protocolError = (msg: string) => new ApiError(0, "invalid_stream", msg);

function retryable(e: ApiError): boolean {
  if (e.code === "invalid_stream") return false;
  return e.status === 0 || e.status >= 500 || e.status === 408 || e.status === 429;
}

function decode<T extends object>(data: string, what: string): T {
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    throw protocolError(`${what}: data is not JSON`);
  }
  if (typeof v !== "object" || v === null) throw protocolError(`${what}: data is not an object`);
  return v as T;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const t = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(t);
      signal?.removeEventListener("abort", finish);
      done();
    }
  });
}

/**
 * Follows a run's event stream (GET /v1/migrations/{runId}/events) until the
 * run ends.
 *
 * After a dropped stream it reconnects with backoff and sends the last seq it
 * delivered as Last-Event-ID, so missed events are replayed and none is
 * delivered twice. It resolves once a snapshot shows a final status and the
 * server then closes the stream, or when `signal` aborts; no handler is
 * called after that. It rejects with an ApiError for answers a reconnect
 * cannot fix: 4xx other than 408 and 429, or a stream that breaks the
 * contract. Network errors, timeouts and 5xx are retried.
 */
export async function watchRun(runId: string, handlers: WatchHandlers, opts: WatchOptions = {}): Promise<void> {
  const { signal } = opts;
  const minDelay = opts.minDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 15_000;
  const connectTimeout = opts.connectTimeoutMs ?? 15_000;
  const idleTimeout = opts.idleTimeoutMs ?? 45_000;
  const live = () => !signal?.aborted;
  let lastSeq = opts.after ?? 0;
  let delay = minDelay;

  while (live()) {
    const conn = new AbortController();
    const cancel = () => conn.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut: ApiError | undefined;
    const arm = (ms: number, why: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = new ApiError(0, "timeout", why);
        conn.abort();
      }, ms);
    };
    let opened = false;
    let progressed = false; // this stream delivered a message
    let ended = false; // this stream's latest snapshot shows a final status
    let failure = new ApiError(0, "stream_closed", "event stream closed while the run is active");

    try {
      arm(connectTimeout, `event stream did not open within ${connectTimeout} ms`);
      const headers = authHeaders({ Accept: "text/event-stream" });
      if (lastSeq > 0) headers.set("Last-Event-ID", String(lastSeq));
      let res: Response;
      try {
        res = await fetch(apiUrl(`/v1/migrations/${encodeURIComponent(runId)}/events`), {
          headers,
          cache: "no-store",
          signal: conn.signal,
        });
      } catch (e) {
        throw timedOut ?? networkError(e);
      }
      if (!res.ok) throw await errorFromResponse(res);
      const type = (res.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "text/event-stream") throw protocolError(`event stream answered with Content-Type "${type}"`);
      if (!res.body) throw protocolError("event stream has no body");

      opened = true;
      if (live()) handlers.onConnection?.(true);
      arm(idleTimeout, `event stream sent nothing for ${idleTimeout} ms`);
      // Set when a message breaks the contract or a handler throws: that ends the watch.
      let fatal: unknown;
      const deliver = (m: SseMessage) => {
        if (!live()) return;
        progressed = true;
        if (m.event === "snapshot") {
          const run = decode<Run>(m.data, "snapshot");
          ended = !isActiveStatus(run.status);
          handlers.onSnapshot?.(run);
          return;
        }
        const ev = decode<RunEvent>(m.data, `"${m.event}" event`);
        // The JSON seq, not the SSE id: an id carries over to messages without one.
        if (ev.seq > 0) {
          if (ev.seq <= lastSeq) return; // replayed after a reconnect
          lastSeq = ev.seq;
        }
        handlers.onEvent?.(ev);
      };
      try {
        await readSse(
          res.body,
          (m) => {
            try {
              deliver(m);
            } catch (e) {
              fatal = e;
              throw e;
            }
          },
          () => arm(idleTimeout, `event stream sent nothing for ${idleTimeout} ms`),
        );
      } catch (e) {
        throw fatal !== undefined ? fatal : (timedOut ?? networkError(e));
      }
      if (ended) return;
    } catch (e) {
      if (!live()) return;
      if (!(e instanceof ApiError) || !retryable(e)) throw e;
      failure = e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (opened && live()) handlers.onConnection?.(false);
    }

    // A stream that delivered something earns a quick reconnect; one that did not backs off further.
    if (progressed) delay = minDelay;
    handlers.onRetry?.(failure, delay);
    await sleep(delay, signal);
    if (!progressed) delay = Math.min(delay * 2, maxDelay);
  }
}
