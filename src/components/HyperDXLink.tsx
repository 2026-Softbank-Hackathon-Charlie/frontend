import type { MouseEvent } from "react";

/**
 * Parses the team's HyperDX address (the log and trace console of the observability stack). Only a plain http(s)
 * address is taken: no query, no fragment and no credentials, because a search path is appended to it. Anything else
 * (unset, "javascript:...", "host.example", "https://h/?a=b") means there is no link.
 */
export function parseHyperdxBase(raw: string | undefined): string {
  try {
    const u = new URL((raw ?? "").trim());
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.search || u.hash || u.username || u.password) return "";
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** The address set at build time with VITE_HYPERDX_URL, read when asked so a test can set it. HyperDX has no public address by default. */
export const hyperdxBase = (): string => parseHyperdxBase(import.meta.env.VITE_HYPERDX_URL);

const HOUR = 60 * 60 * 1000;

/**
 * Lucene text for a search term. A plain name (letters, digits, dot, dash, underscore) goes as it is; anything else
 * (a colon that would read as a field, a space, a quote) is quoted whole.
 */
export function luceneTerm(text: string): string {
  return /^[\w.-]+$/.test(text) ? text : '"' + text.replace(/[\\"]/g, "\\$&") + '"';
}

/**
 * A HyperDX search for the text (an app name or a run id) over the last hour. The query parameters follow HyperDX's
 * search page (where, whereLanguage, from, to, isLive); an older or newer HyperDX that does not know one of them still
 * opens its search page.
 */
export function hyperdxSearchUrl(base: string, text: string, now: number = Date.now(), windowMs: number = HOUR): string {
  const q = new URLSearchParams({
    where: luceneTerm(text),
    whereLanguage: "lucene",
    isLive: "false",
    from: String(now - windowMs),
    to: String(now),
  });
  return base + "/search?" + q.toString();
}

/**
 * "Open in HyperDX". Nothing is drawn without an address or without a term to search (an empty search would open
 * every log).
 */
export function HyperDXLink({ text, base = hyperdxBase() }: { text: string; base?: string }) {
  if (!base || !text.trim()) return null;
  // The hour is taken when the link is used, so a page that stays open for hours does not search a stale hour. A
  // middle click, a context menu ("copy link address") and the keyboard start with a mouse down or a click.
  const refresh = (e: MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.href = hyperdxSearchUrl(base, text);
  };
  return (
    <a
      className="btn ghost"
      href={hyperdxSearchUrl(base, text)}
      onMouseDown={refresh}
      onClick={refresh}
      target="_blank"
      rel="noreferrer"
      title="이 앱의 로그와 트레이스를 HyperDX에서 봅니다"
    >
      HyperDX에서 보기 <span aria-hidden="true">↗</span>
    </a>
  );
}
