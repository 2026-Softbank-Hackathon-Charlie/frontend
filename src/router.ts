import { useSyncExternalStore } from "react";

const ROUTES = [
  "overview",
  "apps",
  "apps-healthy",
  "apps-problem",
  "apps-deploying",
  "new",
  "onboard",
  "migrate",
  "migrate-app",
  "routes",
  "agents",
  "security",
  "envs",
  "device",
  "design-system",
];

/** Old routes that still open their page: #migrate-shop was the migration page while the sample app was shop. */
const ALIASES: Record<string, string> = { "migrate-shop": "migrate-app" };

/**
 * #app-<name>[/<tab>] is one app, #deploy-<id> one deployment, #apps-<filter> the app list filtered by status.
 * A query after the route (#migrate-app?app=<name>) is for the page and does not change the route.
 */
export function parseRoute(hash: string): string {
  const raw = hash.replace(/^#/, "").replace(/\?.*$/, "") || "overview";
  const h = ALIASES[raw] ?? raw;
  if (ROUTES.includes(h) || /^app-[a-z0-9-]+(\/(instances|secrets|deploys))?$/.test(h) || /^deploy-[A-Za-z0-9_-]+$/.test(h) || /^security\/(sources|(controls|vulnerabilities|findings)(\/[A-Za-z0-9_-]+)?)$/.test(h)) return h;
  return "overview";
}

/** The tabs of an app's page: #app-<name> is the overview, #app-<name>/<tab> the others. */
export type AppTab = "overview" | "instances" | "secrets" | "deploys";

/** `app-<name>` or `app-<name>/<tab>` → the app's name and tab. */
export function appRoute(r: string): { name: string; tab: AppTab } {
  const [name, tab] = r.slice("app-".length).split("/");
  return { name, tab: (tab ?? "overview") as AppTab };
}

/** The page a route shows: an app's tabs are one page. */
const pageOf = (r: string) => (r.startsWith("app-") || r.startsWith("security") ? r.split("/")[0] : r);
/** The route of a whole URL, as a hashchange event names the old and new one. */
const routeOfUrl = (url: string) => parseRoute(url.includes("#") ? url.slice(url.indexOf("#")) : "");

function subscribe(cb: () => void) {
  const on = (e: HashChangeEvent) => {
    cb();
    // A new page starts at the top; tabs of one app or the security section retain their position.
    const from = routeOfUrl(e.oldURL ?? "");
    const samePage = !!e.oldURL && !!e.newURL && (from.startsWith("app-") || from.startsWith("security")) && pageOf(from) === pageOf(routeOfUrl(e.newURL));
    if (!samePage) window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", on);
  return () => window.removeEventListener("hashchange", on);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));
}

export function navigate(hash: string): void {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

/** Which side-nav entry is current for a route. */
export function navCurrent(r: string): string {
  if (r === "overview") return "overview";
  if (r.startsWith("apps") || r === "new" || r === "onboard" || r.startsWith("app-") || r.startsWith("deploy-")) return "apps";
  if (r.startsWith("migrate")) return "migrate";
  if (r === "security" || r.startsWith("security/")) return "security";
  return r;
}
