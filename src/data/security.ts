// Shared presentation models. A missing capability is null, never a successful empty scan.
import type { SecurityCategory, SecurityReport, SecuritySource, StorageKey } from "../api/types";
import { PROVIDER_LABEL, SOURCE_LABEL } from "./securityMatrix";
export type EnvId = string;
export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export type Domain = "identity" | "data" | "logging" | "policy" | "vulnerability";
export interface ControlEvaluation {
  id: string; title: string; controlId: string; domain: Domain; environment: EnvId; app?: string;
  status: "pass" | "fail" | "unknown" | "not_applicable";
  basisUrl: string; evidence: string; recommendation: string; observedAt: string;
}
export interface VulnerabilityFinding {
  id: string; advisory: string; title: string; package: string; installedVersion: string; fixedVersion: string | null;
  severity: SecuritySeverity; cvss: number | null; cvssVersion: string; cvssVector?: string; scoreSource: string;
  basisUrl: string; kev: boolean | null; epss: number | null; epssDate: string | null; imageDigest: string;
  occurrences: Array<{ environment: EnvId; app: string; workload: string; namespace: string; running: boolean | null }>;
  detail: string; recommendation: string;
}
export interface SecurityFindingRow {
  id: string; title: string; kind: "configuration" | "threat" | "governance"; environment: EnvId; app?: string;
  severity: SecuritySeverity; source: string; controlId?: string; basisUrl: string | null; check?: string; category?: SecurityCategory; domain?: Domain; resource: string;
  detail: string; recommendation: string; observedAt: string;
}
export interface SecuritySourceRow {
  id: string; name: string; environment: EnvId; app?: string; status: "ok" | "error" | "unavailable" | "not_configured" | "stale" | "unsupported";
  scope: string; lastCollected: string | null; lastScanned: string | null; scannerVersion?: string;
  databaseUpdatedAt?: string; detail: string;
}

export interface SecurityDataset {
  mode: "demo" | "live";
  generatedAt: string | null;
  environments: { id: EnvId; label: string; provider: string }[];
  apps: string[];
  appFilterAvailable: boolean;
  controls: ControlEvaluation[] | null;
  vulnerabilities: VulnerabilityFinding[] | null;
  findings: SecurityFindingRow[];
  sources: SecuritySourceRow[];
  storageKeys: StorageKey[] | undefined;
  storageKeySources: SecuritySource[];
}

const ENV_LABEL: Record<string, string> = { eks: "AWS EKS", gke: "GCP GKE", k3s: "온프레미스 k3s", "aws-account": "AWS 계정", platform: "플랫폼" };
export const environmentLabel = (id: string) => ENV_LABEL[id] ?? id;

/** The current API exposes signals, not atomic compliance evaluations or structured CVEs. */
export function securityData(report?: SecurityReport): SecurityDataset {
  const environments = new Map<string, { id: string; label: string; provider: string }>();
  for (const row of [...(report?.sources ?? []), ...(report?.findings ?? [])]) {
    environments.set(row.environment, { id: row.environment, label: ENV_LABEL[row.environment] ?? row.environment, provider: PROVIDER_LABEL[row.provider] });
  }
  for (const key of report?.storageKeys ?? []) {
    if (!environments.has(key.environment)) environments.set(key.environment, { id: key.environment, label: ENV_LABEL[key.environment] ?? key.environment, provider: key.driver });
  }
  const domainByCategory: Record<string, Domain> = { identity: "identity", data: "data", logging: "logging", network: "policy", workload: "policy" };
  return {
    mode: "live", generatedAt: report?.generatedAt ?? null,
    environments: [...environments.values()], apps: [], appFilterAvailable: false,
    controls: null, vulnerabilities: null,
    findings: (report?.findings ?? []).map((f) => ({
      id: f.id, title: f.title, kind: f.category === "threat" ? "threat" : f.source.startsWith("platform-") || f.source === "storage-keys" ? "governance" : "configuration",
      environment: f.environment, severity: f.severity, source: SOURCE_LABEL[f.source] ?? f.source,
      check: f.check, category: f.category, domain: domainByCategory[f.category], basisUrl: null,
      resource: f.resource, detail: f.detail, recommendation: f.recommendation, observedAt: f.observedAt,
    })),
    sources: (report?.sources ?? []).map((s) => ({
      id: `${s.environment}/${s.name}`, name: SOURCE_LABEL[s.name] ?? s.name, environment: s.environment,
      status: s.status, scope: "플랫폼이 보고한 발견 항목과 수집 상태", lastCollected: s.checkedAt,
      lastScanned: null, detail: s.message ?? "출처 조회 성공과 개별 통제 통과는 별개입니다. 검사 엔진·DB 시각은 현재 API가 제공하지 않습니다.",
    })),
    storageKeys: report?.storageKeys,
    storageKeySources: (report?.sources ?? []).filter((s) => s.name === "storage-keys"),
  };
}


export const DOMAINS: { id: Domain; label: string }[] = [
  { id: "identity", label: "권한·인증" }, { id: "data", label: "암호화" }, { id: "logging", label: "감사 로그" },
  { id: "policy", label: "정책" }, { id: "vulnerability", label: "취약점 관리" },
];

export function filterControls(controls: ControlEvaluation[], environment: "all" | EnvId, app: string): ControlEvaluation[] {
  return controls.filter((c) => (environment === "all" || c.environment === environment) && (app === "all" || c.app === app));
}
export function filterVulnerabilities(vulnerabilities: VulnerabilityFinding[], environment: "all" | EnvId, app: string): VulnerabilityFinding[] {
  return vulnerabilities.flatMap((v) => {
    const occurrences = v.occurrences.filter((o) => (environment === "all" || o.environment === environment) && (app === "all" || o.app === app));
    return occurrences.length ? [{ ...v, occurrences }] : [];
  });
}
export function controlCounts(controls: ControlEvaluation[]) {
  const counts = { pass: 0, fail: 0, unknown: 0, notApplicable: 0, total: controls.length, completed: 0 };
  for (const c of controls) {
    if (c.status === "not_applicable") counts.notApplicable++;
    else counts[c.status]++;
  }
  counts.completed = counts.pass + counts.fail;
  return counts;
}
export function summarizeVulnerabilities(vulnerabilities: VulnerabilityFinding[]) {
  const advisories = new Set<string>();
  const images = new Set<string>();
  const workloads = new Set<string>();
  const occurrences = new Set<string>();
  for (const v of vulnerabilities) {
    const advisory = v.advisory.trim().toUpperCase();
    advisories.add(advisory);
    images.add(v.imageDigest);
    occurrences.add(JSON.stringify([advisory, v.package, v.installedVersion, v.imageDigest]));
    for (const o of v.occurrences) {
      if (o.running === true) workloads.add(JSON.stringify([o.environment, o.namespace, o.workload]));
    }
  }
  return { advisories: advisories.size, images: images.size, workloads: workloads.size, occurrences: occurrences.size };
}
