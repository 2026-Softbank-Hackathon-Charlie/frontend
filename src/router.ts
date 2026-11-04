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

/** #app-<name> is one app, #deploy-<id> one deployment, #apps-<filter> the app list filtered by status. */
export function parseRoute(hash: string): string {
  const raw = hash.replace(/^#/, "") || "overview";
  const h = ALIASES[raw] ?? raw;
  if (ROUTES.includes(h) || /^app-[a-z0-9-]+$/.test(h) || /^deploy-[A-Za-z0-9_-]+$/.test(h)) return h;
  return "overview";
}

function subscribe(cb: () => void) {
  const on = () => {
    cb();
    window.scrollTo(0, 0);
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
  return r;
}
