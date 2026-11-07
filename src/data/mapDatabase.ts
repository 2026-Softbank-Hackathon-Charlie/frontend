import type { App } from "../api/types";
import type { MigrationEndpoint } from "./agentContext";
import { isDatabaselessApp } from "./migrationMembership";

export type DatabasePresence = "present" | "none" | "unknown";

/** The executing endpoints outrank a later changed app spec. `none` does not exclude files. */
export function databasePresence(app?: App, source?: MigrationEndpoint, target?: MigrationEndpoint): DatabasePresence {
  const endpoints = [source, target];
  if (endpoints.some(endpoint => endpoint && (endpoint.kind === "external" || endpoint.kind === "cnpg" || !!endpoint.namespace && !!endpoint.cluster))) return "present";
  if (source?.kind === "none" && target?.kind === "none") return "none";
  if (!app) return "unknown";
  if (app.deploy?.dbTopology || app.environments?.some(env => !!env.cnpgCluster) || app.deploy?.spec?.resources?.some(resource => resource.type === "postgres")) return "present";
  return app.deploy?.spec && Array.isArray(app.environments) && isDatabaselessApp(app) ? "none" : "unknown";
}
