// Environment × category view of a security report: every cloud's own services
// (GuardDuty, Security Hub, Security Command Center, Kubernetes checks, ...) on one
// set of categories and severities. A cell with no finding is only "clean" when a
// source that checks that category was read; otherwise it says it was not checked.
import type { SecurityCategory, SecurityFinding, SecurityProvider, SecurityReport, SecuritySeverity, SecuritySource } from "../api/types";

export const CATEGORIES: SecurityCategory[] = ["identity", "network", "workload", "data", "logging", "threat"];

export const CATEGORY_LABEL: Record<SecurityCategory, string> = {
  identity: "신원·권한",
  network: "네트워크",
  workload: "워크로드",
  data: "데이터",
  logging: "로깅·감사",
  threat: "위협 탐지",
};

export const PROVIDER_LABEL: Record<SecurityProvider, string> = {
  aws: "AWS",
  gcp: "GCP",
  onprem: "온프레미스",
  cloudflare: "Cloudflare",
  platform: "플랫폼",
};

/** Friendly names of the platform's sources (security.Collectors). */
export const SOURCE_LABEL: Record<string, string> = {
  kubernetes: "Kubernetes 점검",
  "aws-iam": "IAM",
  "aws-ec2": "EC2",
  "aws-cloudtrail": "CloudTrail",
  "aws-guardduty": "GuardDuty",
  "aws-securityhub": "Security Hub",
  "aws-s3": "S3",
  "gcp-scc": "Security Command Center",
  cloudflare: "Cloudflare",
  "platform-audit": "감사 로그",
  "platform-config": "플랫폼 설정",
};

/**
 * What each platform source checks, from the checks it runs (platform internal/security).
 * Security Hub and Security Command Center aggregate many controls, so they cover every category.
 * A source not listed here covers the categories of the findings it reported.
 */
const COVERS: Record<string, SecurityCategory[]> = {
  kubernetes: ["workload", "network", "identity"],
  "aws-iam": ["identity"],
  "aws-ec2": ["network", "data"],
  "aws-cloudtrail": ["logging"],
  "aws-guardduty": ["threat"],
  "aws-securityhub": CATEGORIES,
  "aws-s3": ["data"],
  "gcp-scc": CATEGORIES,
  "platform-audit": ["identity"],
  "platform-config": ["data", "network"],
};

const SEV_RANK: Record<SecuritySeverity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export type CellState =
  /** findings exist */
  | { kind: "findings"; count: number; top: SecuritySeverity }
  /** a source that checks this category was read and found nothing */
  | { kind: "clean"; sources: string[] }
  /** the sources that would check it could not be read (not configured, unavailable, error) */
  | { kind: "unread"; sources: string[] }
  /** no source checks this category in this environment */
  | { kind: "unchecked" };

export interface MatrixRow {
  environment: string;
  providers: SecurityProvider[];
  sources: SecuritySource[];
  cells: Record<SecurityCategory, CellState>;
}

function covers(src: SecuritySource, findings: SecurityFinding[]): SecurityCategory[] {
  return COVERS[src.name] ?? [...new Set(findings.filter((f) => f.source === src.name && f.environment === src.environment).map((f) => f.category))];
}

/** Rows in the order the report lists its sources, then environments only findings name. */
export function securityMatrix(r: SecurityReport): MatrixRow[] {
  const envs: string[] = [];
  for (const e of [...r.sources.map((s) => s.environment), ...r.findings.map((f) => f.environment)]) if (!envs.includes(e)) envs.push(e);
  return envs.map((env) => {
    const sources = r.sources.filter((s) => s.environment === env);
    const found = r.findings.filter((f) => f.environment === env);
    const providers = [...new Set([...sources.map((s) => s.provider), ...found.map((f) => f.provider)])];
    const cells = {} as Record<SecurityCategory, CellState>;
    for (const c of CATEGORIES) {
      const hits = found.filter((f) => f.category === c);
      if (hits.length) {
        const top = hits.reduce((a, f) => (SEV_RANK[f.severity] > SEV_RANK[a] ? f.severity : a), hits[0].severity);
        cells[c] = { kind: "findings", count: hits.length, top };
        continue;
      }
      const checking = sources.filter((s) => covers(s, r.findings).includes(c));
      const read = checking.filter((s) => s.status === "ok").map((s) => s.name);
      if (read.length) cells[c] = { kind: "clean", sources: read };
      else if (checking.length) cells[c] = { kind: "unread", sources: checking.map((s) => s.name) };
      else cells[c] = { kind: "unchecked" };
    }
    return { environment: env, providers, sources, cells };
  });
}
