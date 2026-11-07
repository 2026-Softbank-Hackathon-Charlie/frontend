// Friendly names for the generated contract types (src/api/schema.d.ts).
import type { components } from "./schema";
import type { components as LLMComponents } from "./llm-schema";

type S = components["schemas"];

export type ErrorBody = S["ErrorBody"];
export type ErrorResponse = S["Error"];
export type Health = S["Health"];
export type Role = S["Role"];
export type Principal = S["Principal"];

export type LoginRequest = S["LoginRequest"];
export type Session = S["Session"];
export type DeviceLoginStatus = S["DeviceLoginStatus"];
export type DeviceLogin = S["DeviceLogin"];
export type DeviceLoginApproveRequest = S["DeviceLoginApproveRequest"];

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
export type AIRun = S["AIRun"];
export type AIRunRequest = S["AIRunRequest"];
export type AIRunList = S["AIRunList"];
export type AIActivity = S["AIActivity"];
export type AppObservation = S["AppObservation"];
export type LLMObservability = LLMComponents["schemas"]["LLMObservability"];
export type AIActivityEvent = S["AIActivityEvent"];
export type AIActivitySummary = S["AIActivitySummary"];
export type App = S["App"];
export type AppDatabase = S["AppDatabase"];
export type AppEnvironment = S["AppEnvironment"];
export type AppList = S["AppList"];
export type AppResources = S["AppResources"];

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
export type WriteVerification = S["WriteVerification"];
export type SourceRetentionResponse = S["SourceRetentionResponse"];
export type CanaryResult = S["CanaryResult"];
export type CanaryStep = S["CanaryStep"];
export type GateResult = S["GateResult"];
export type EngineOutcome = S["EngineOutcome"];
export type EngineState = S["EngineState"];
export type StepStatus = S["StepStatus"];
export type StepRecord = S["StepRecord"];
export type RunEvent = S["RunEvent"];
export type RollbackRequest = S["RollbackRequest"];
export type ObserveOptions = S["ObserveOptions"];
export type ObserveResult = S["ObserveResult"];
export type ObserveStep = S["ObserveStep"];
export type ObserveVerdict = ObserveStep["verdict"];
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
/** OCSF 1.9.0 events of the security data (SEC-09); the events themselves are free-form OCSF objects. */
export type SecurityOCSFExport = S["SecurityOCSFExport"];
export type SecuritySeverityBasis = S["SecuritySeverityBasis"];
export type SecurityControl = S["SecurityControl"];
export type SecurityControlEvaluation = S["SecurityControlEvaluation"];
export type SecurityControlCoverage = S["SecurityControlCoverage"];
export type SecurityControlReport = S["SecurityControlReport"];
export type SecurityImageScan = S["SecurityImageScan"];
export type SecurityVulnerability = S["SecurityVulnerability"];
export type SecurityRunningImage = S["SecurityRunningImage"];
export type SecurityDeployedImage = S["SecurityDeployedImage"];
export type SecurityScannerState = S["SecurityScannerState"];
export type SecurityVulnerabilityReport = S["SecurityVulnerabilityReport"];
export type SecurityExploitSource = S["SecurityExploitSource"];
export type SecurityException = S["SecurityException"];
export type SecurityExceptionRequest = S["SecurityExceptionRequest"];
export type SecurityExceptionList = S["SecurityExceptionList"];
export type StorageKey = S["StorageKey"];
export type StorageKeyUse = S["StorageKeyUse"];
export type StorageKeyState = S["StorageKeyState"];

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
  /** Older servers leave it out; then gate.passed decides. */
  verdict?: CanaryStep["verdict"];
  gate: GateResult;
}
/** `observe_step`: one gate evaluation of the target after the cutover. */
export interface ObserveStepData {
  verdict: ObserveVerdict;
  gate: GateResult;
}
/** `observe_rollback`: the rollback the observe phase started, or why it could not. */
export interface ObserveRollbackData {
  rollbackRunId?: string;
  error?: string;
}
export interface MetricData {
  lagBytes?: number;
  downtimeMillis?: number;
}

// Apps registered from GitHub and their deployments (ADR 0011).
export type AppDeploy = S["AppDeploy"];
export type AppDBTopology = S["AppDBTopology"];
export type AppDBReadiness = S["AppDBReadiness"];
export type AppDBReadinessEnvironment = S["AppDBReadinessEnvironment"];
export type AppEnvironmentAddRequest = S["AppEnvironmentAddRequest"];
export type AppEnvironmentAdded = S["AppEnvironmentAdded"];
export type AppEnvironmentRemoved = S["AppEnvironmentRemoved"];
export type AppEnvironmentStatus = S["AppEnvironmentStatus"];
export type AppCreateRequest = S["AppCreateRequest"];
export type AppCreated = S["AppCreated"];
export type AppInstance = S["AppInstance"];
export type AppInstanceCreateRequest = S["AppInstanceCreateRequest"];
export type AppInstanceCreated = S["AppInstanceCreated"];
export type AppSpec = S["AppSpec"];
export type AppSpecService = S["AppSpecService"];
export type AppSpecResource = S["AppSpecResource"];
export type AppSpecFieldError = S["AppSpecFieldError"];
export type AppSpecValidation = S["AppSpecValidation"];
export type AppSpecValidateRequest = S["AppSpecValidateRequest"];
export type AppSpecInvalid = S["AppSpecInvalid"];
export type DeploymentTrigger = S["DeploymentTrigger"];
export type DeploymentStatus = S["DeploymentStatus"];
export type DeploymentEnvironmentStatus = S["DeploymentEnvironmentStatus"];
export type Deployment = S["Deployment"];
export type DeploymentImage = S["DeploymentImage"];
export type DeploymentEnvironment = S["DeploymentEnvironment"];
export type DeploymentList = S["DeploymentList"];
export type DeploymentCreateRequest = S["DeploymentCreateRequest"];
export type DeploymentEventType = S["DeploymentEventType"];
export type DeploymentEvent = S["DeploymentEvent"];
export type GitHubRepo = S["GitHubRepo"];
export type GitHubRepoList = S["GitHubRepoList"];

// App secrets (ADR 0019).
export type AppSecretInfo = S["AppSecretInfo"];
export type AppSecrets = S["AppSecrets"];
export type AppSecretsUpdate = S["AppSecretsUpdate"];
export type AppSecretValue = S["AppSecretValue"];
