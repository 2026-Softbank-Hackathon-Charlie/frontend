import type { MouseEvent } from "react";

/**
 * Base URL of the team's HyperDX (the log and trace console of the observability stack), set at build time with
 * VITE_HYPERDX_URL. Unset or not an http(s) address means there is no link: HyperDX has no public address by default.
 */
export const hyperdxBase: string = (() => {
  const raw = (import.meta.env.VITE_HYPERDX_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/i.test(raw) ? raw : "";
})();

const HOUR = 60 * 60 * 1000;

/**
 * A HyperDX search for the text (an app name or a run id) over the last hour. The query parameters follow HyperDX's
 * search page (where, whereLanguage, from, to, isLive); an older or newer HyperDX that does not know one of them still
 * opens its search page.
 */
export function hyperdxSearchUrl(base: string, text: string, now: number = Date.now(), windowMs: number = HOUR): string {
  const q = new URLSearchParams({
    where: text,
    whereLanguage: "lucene",
    isLive: "false",
    from: String(now - windowMs),
    to: String(now),
  });
  return base + "/search?" + q.toString();
}

/** "Open in HyperDX": nothing is drawn when no HyperDX address is configured. */
export function HyperDXLink({ text, base = hyperdxBase }: { text: string; base?: string }) {
  if (!base) return null;
  // The time window is taken when the link is used, so a page that stays open for hours does not search a stale hour.
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.href = hyperdxSearchUrl(base, text);
  };
  return (
    <a className="btn ghost" href={hyperdxSearchUrl(base, text)} onClick={open} target="_blank" rel="noreferrer" title="이 앱의 로그와 트레이스를 HyperDX에서 봅니다">
      HyperDX에서 보기 <span aria-hidden="true">↗</span>
    </a>
  );
}
