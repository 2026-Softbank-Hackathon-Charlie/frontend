import type { App } from "../api/types";

/** Deployment membership is distinct from observed database endpoints/readiness. */
export function migrationEnvironments(app: App): string[] {
  return [...new Set([...app.environments.map((e) => e.env), ...(app.deploy?.environments ?? [])])];
}

/** The registered app spec, rather than an empty DB status list, declares no database. */
export function isDatabaselessApp(app: App): boolean {
  return !!app.deploy && !app.deploy.dbTopology && !app.environments.some((e) => !!e.cnpgCluster) && !(app.deploy.spec.resources ?? []).some((r) => r.type === "postgres");
}

export function migrationEntryLabel(app: App): "이전" | "이전 준비" {
  return (isDatabaselessApp(app) ? migrationEnvironments(app).length : app.environments.length) >= 2 ? "이전" : "이전 준비";
}
