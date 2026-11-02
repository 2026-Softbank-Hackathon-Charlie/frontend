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
export type PlanAttachment = S["PlanAttachment"];
export type PlanDraftRequest = S["PlanDraftRequest"];
export type App = S["App"];
export type AppDatabase = S["AppDatabase"];
export type AppEnvironment = S["AppEnvironment"];
export type AppList = S["AppList"];

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
export type RollbackRequest = S["RollbackRequest"];
export type WrittenRecordStats = S["WrittenRecordStats"];

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

export type SecurityProvider = S["SecurityProvider"];
export type SecuritySeverity = S["SecuritySeverity"];
export type SecurityCategory = S["SecurityCategory"];
export type SecuritySourceStatus = S["SecuritySourceStatus"];
export type SecurityFinding = S["SecurityFinding"];
export type SecuritySource = S["SecuritySource"];
export type SeverityCounts = S["SeverityCounts"];
export type SecuritySummary = S["SecuritySummary"];
export type SecurityReport = S["SecurityReport"];

export type AgentSessionKind = S["AgentSessionKind"];
export type AgentSessionStatus = S["AgentSessionStatus"];
export type AgentEventType = S["AgentEventType"];
export type AgentSessionTotals = S["AgentSessionTotals"];
export type AgentSession = S["AgentSession"];
export type AgentSessionList = S["AgentSessionList"];
export type TokenUsage = S["TokenUsage"];
export type AgentEvent = S["AgentEvent"];
export type AgentEventList = S["AgentEventList"];

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
