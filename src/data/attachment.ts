// A plan attachment's content (GET /v1/plans/{ref}/attachments/{name}), checked against the SHA-256 the plan
// record lists, so the operator approves what they read.
import { useEffect, useState } from "react";
import { getPlanAttachment } from "../api/client";
import type { PlanAttachment } from "../api/types";
import { errorText } from "./live";

export interface AttachmentContent {
  loading: boolean;
  /** the content as UTF-8 text; undefined for a binary file */
  text?: string;
  bytes?: number;
  /** the content's hash equals the record's; undefined until checked or when the browser cannot hash */
  verified?: boolean;
  error?: string;
}

/** Text when it decodes as UTF-8 and has no NUL bytes, else undefined (shown as binary). */
export function textOf(buf: ArrayBuffer): string | undefined {
  const b = new Uint8Array(buf);
  if (b.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return undefined;
  }
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined; // not a secure context
  const d = new Uint8Array(await subtle.digest("SHA-256", buf));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Loads again when the plan's revision changes: an upload replaces the content under the same name. */
export function useAttachment(planRef: string, a: PlanAttachment, revision: number): AttachmentContent {
  const [s, setS] = useState<AttachmentContent>({ loading: true });
  useEffect(() => {
    const ctrl = new AbortController();
    setS({ loading: true });
    getPlanAttachment(planRef, a.name, { signal: ctrl.signal })
      .then(async (buf) => {
        const hash = await sha256Hex(buf);
        if (ctrl.signal.aborted) return;
        setS({ loading: false, text: textOf(buf), bytes: buf.byteLength, verified: hash === undefined ? undefined : hash === a.sha256.toLowerCase() });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setS({ loading: false, error: errorText(e) });
      });
    return () => ctrl.abort();
  }, [planRef, a.name, a.sha256, revision]);
  return s;
}
