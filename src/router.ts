import { useSyncExternalStore } from "react";

const ROUTES = ["overview", "apps", "new", "onboard", "migrate", "migrate-shop", "routes", "agents", "security", "envs", "design-system"];

export function parseRoute(hash: string): string {
  const h = hash.replace(/^#/, "") || "overview";
  if (ROUTES.includes(h) || /^app-[a-z0-9-]+$/.test(h)) return h;
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
  if (r === "apps" || r === "new" || r === "onboard" || r.startsWith("app-")) return "apps";
  if (r.startsWith("migrate")) return "migrate";
  return r;
}
