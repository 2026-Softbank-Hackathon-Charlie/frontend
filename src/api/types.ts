// Friendly names for the generated contract types (src/api/schema.d.ts).
import type { components } from "./schema";

type S = components["schemas"];

export type ErrorBody = S["ErrorBody"];
export type ErrorResponse = S["Error"];
export type Health = S["Health"];
export type Role = S["Role"];
export type Principal = S["Principal"];

export type EnginePlan = S["EnginePlan"];
export type EnginePlanEndpoint = S["EnginePlanEndpoint"];
export type PlanStatus = S["PlanStatus"];
export type PlanEndpoint = S["PlanEndpoint"];
export type PlanSummary = S["PlanSummary"];
export type PlanRecord = S["PlanRecord"];
export type PlanList = S["PlanList"];
export type ReviewRequest = S["ReviewRequest"];

export type StartMigrationRequest = S["StartMigrationRequest"];
export type StartMigrationResponse = S["StartMigrationResponse"];
export type AbortRequest = S["AbortRequest"];
export type CanaryOptions = S["CanaryOptions"];
export type GateThresholds = S["GateThresholds"];
export type RunStatus = S["RunStatus"];
export type RunPhase = S["RunPhase"];
export type Run = S["Run"];
export type RunList = S["RunList"];
export type RunResult = S["RunResult"];
export type CanaryResult = S["CanaryResult"];
export type CanaryStep = S["CanaryStep"];
export type GateResult = S["GateResult"];
export type EngineOutcome = S["EngineOutcome"];
export type EngineState = S["EngineState"];
export type StepStatus = S["StepStatus"];
export type StepRecord = S["StepRecord"];
export type RunEvent = S["RunEvent"];

export type Provider = S["Provider"];
export type Environment = S["Environment"];
export type EnvironmentStatus = S["EnvironmentStatus"];
export type EnvironmentList = S["EnvironmentList"];
export type NodeSummary = S["NodeSummary"];
export type DatabaseCluster = S["DatabaseCluster"];

export type TrafficState = S["TrafficState"];
export type InFlight = S["InFlight"];
export type BackendState = S["BackendState"];
export type BackendStats = S["BackendStats"];
export type BackendTotals = S["BackendTotals"];

export type Matrix = S["Matrix"];
export type MatrixRoute = S["MatrixRoute"];

export type AuditEntry = S["AuditEntry"];
export type AuditList = S["AuditList"];

// `RunEvent.data` by kind, as the contract describes it. Other keys may appear.
export interface StatusChangedData {
  status: RunStatus;
  phase: RunPhase;
  reason?: string;
}
export interface CanaryStepData {
  /** 0 means all reads are back on the source. */
  weight: number;
  readWeights: Record<string, number>;
}
export interface GateResultData {
  weight: number;
  gate: GateResult;
}
export interface MetricData {
  lagBytes?: number;
  downtimeMillis?: number;
}
