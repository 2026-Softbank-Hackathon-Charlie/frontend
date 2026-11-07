import type { AgentSession, App, PlanRecord, Run } from "../api/types";
import type { components } from "../api/migration-context-schema";

export type MigrationEndpoint = components["schemas"]["PlanEndpoint"];
type Summary = components["schemas"]["PlanSummary"];
type RunContext = components["schemas"]["Run"];
export interface SessionContext { app?: string; source?: string; target?: string }

/** Only exact reference links and declared app endpoints; never parse titles or plan IDs. */
export function sessionContext(session: AgentSession, plans: PlanRecord[], runs: Run[], apps: App[]): SessionContext {
  const run: RunContext | undefined = session.runId ? runs.find(run => run.runId === session.runId) : undefined;
  if (run && session.planRef && run.planRef !== session.planRef) return {};
  const ref = session.planRef ?? run?.planRef;
  const plan: Summary | undefined = ref ? plans.find(plan => plan.ref === ref)?.summary : undefined;
  const source = run?.source ?? plan?.source, target = run?.target ?? plan?.target;
  if (!source || !target) return {};
  const matches = apps.filter(app => [source, target].every(endpoint => !!endpoint.namespace && !!endpoint.cluster &&
    app.namespace === endpoint.namespace && app.environments.some(env => env.env === endpoint.env && env.cnpgCluster === endpoint.cluster)));
  const app = run?.app ?? plan?.app ?? (matches.length === 1 ? matches[0].name : undefined);
  return { app, source: source.env || undefined, target: target.env || undefined };
}
