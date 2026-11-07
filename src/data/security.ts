// Shared presentation models. A missing capability is null, never a successful empty scan.
import type {
  SecurityCategory, SecurityControlCoverage, SecurityControlReport, SecurityReport, SecuritySeverityBasis, SecuritySource,
  SecurityDeployedImage, SecurityException, SecurityRunningImage, SecurityVulnerabilityReport, StorageKey,
} from "../api/types";
import { PROVIDER_LABEL, SOURCE_LABEL } from "./securityMatrix";
import { evidenceUrl, reportObservation, securityCodeUrl, type SecurityObservation, type SecurityRequestState } from "./securityEvidence";
export type EnvId = string;
/** An operator's time-limited exception (SEC-08). It never changes severity. Live data only. */
export interface ExceptionInfo { id: string; reason: string; expiresAt: string; createdBy: string }
const exceptionInfo = (e?: SecurityException): ExceptionInfo | undefined =>
  e ? { id: e.id, reason: e.reason, expiresAt: e.expiresAt, createdBy: e.createdBy } : undefined;
/** Active while it has not expired; the server sends only unrevoked ones. */
export const activeException = (e?: ExceptionInfo, now = Date.now()) => !!e && Date.parse(e.expiresAt) > now;
export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export const isPrioritySeverity = (severity: SecuritySeverity) => severity === "critical" || severity === "high";
export type Domain = "identity" | "data" | "logging" | "policy" | "vulnerability";
export interface ControlEvaluation {
  id: string; title: string; controlId: string; domain: Domain; environment: EnvId; app?: string;
  status: "pass" | "fail" | "unknown" | "not_applicable";
  basisUrl: string; evidence: string; recommendation: string; observedAt: string;
  /** The evaluated asset ("*" when the whole source could not be read). Live data only. */
  asset?: string;
  source?: string; sourceStatus?: SecuritySource["status"]; sourceReason?: string; codeUrl?: string; ruleCodeUrl?: string;
}
export interface VulnerabilityFinding {
  id: string; advisory: string; title: string; package: string; installedVersion: string; fixedVersion: string | null;
  severity: SecuritySeverity; cvss: number | null; cvssVersion: string; cvssVector?: string; scoreSource: string;
  basisUrl: string; kev: boolean | null; epss: number | null; epssDate: string | null; imageDigest: string;
  /** SEC-07 states from the API; absent in demo data. kev/epss above stay the simple view. */
  kevState?: "listed" | "not_listed" | "unknown" | "no_cve";
  epssState?: "scored" | "not_scored" | "unknown" | "no_cve";
  epssPercentile?: number | null; kevDueDate?: string; ransomware?: boolean;
  occurrences: Array<{ environment: EnvId; app: string; workload: string; namespace: string; running: boolean | null; deployed?: DeployedState }>;
  detail: string; recommendation: string;
  exception?: ExceptionInfo;
  scanId?: string; scannedAt?: string; scanner?: string; databaseBuiltAt?: string; codeUrl?: string;
}
/** The running digest compared with the platform's deployment record (SEC-05). Live data only. */
export interface DeployedState { state: SecurityDeployedImage["state"]; reason: string; deploymentId?: string; digest?: string }
/** One running container and whether its digest has a stored scan (SEC-04) and matches its deployment record (SEC-05). */
export interface RunningImageRow {
  id: string; environment: EnvId; namespace: string; workload: string; container: string; app: string | null;
  image: string; digest: string | null; scanState: SecurityRunningImage["scanState"];
  scannedAt: string | null; scanMessage?: string; deployed?: DeployedState;
  scanId?: string; scanStatus?: "succeeded" | "failed" | "unsupported";
}
export interface SecurityFindingRow {
  id: string; title: string; kind: "configuration" | "threat" | "governance"; environment: EnvId; app?: string;
  severity: SecuritySeverity; source: string; controlId?: string; basisUrl: string | null; check?: string; category?: SecurityCategory; domain?: Domain; resource: string;
  detail: string; recommendation: string; observedAt: string;
  /** Who set the severity, the source's own value and the policy version. */
  severityBasis?: string;
  exception?: ExceptionInfo;
}
export interface SecuritySourceRow {
  id: string; name: string; environment: EnvId; app?: string; status: "ok" | "error" | "unavailable" | "not_configured" | "stale" | "unsupported" | "idle";
  scope: string; lastCollected: string | null; lastScanned: string | null; scannerVersion?: string;
  databaseUpdatedAt?: string; detail: string;
  codeUrl?: string;
}

export interface SecurityDataset {
  mode: "demo" | "live";
  generatedAt: string | null;
  environments: { id: EnvId; label: string; provider: string }[];
  apps: string[];
  appFilterAvailable: boolean;
  controls: ControlEvaluation[] | null;
  vulnerabilities: VulnerabilityFinding[] | null;
  /** Running containers with their scan and deployment-record state; live mode only, also when the scanner is not connected. */
  runningImages?: RunningImageRow[];
  /** Why controls or vulnerabilities are null in live mode. */
  unavailable?: { controls?: string; vulnerabilities?: string };
  /** Per environment and domain: evaluated, not_connected or unsupported. */
  coverage?: SecurityControlCoverage[];
  policyVersion?: string;
  observations?: { findings: SecurityObservation; controls: SecurityObservation; vulnerabilities: SecurityObservation };
  findings: SecurityFindingRow[];
  sources: SecuritySourceRow[];
  storageKeys: StorageKey[] | undefined;
  storageKeySources: SecuritySource[];
}

const ENV_LABEL: Record<string, string> = { eks: "AWS EKS", gke: "GCP GKE", k3s: "onprem k3s", onprem: "onprem", "aws-account": "AWS Cloud", "gcp-project": "GCP Cloud", "cloudflare-account": "Cloudflare", platform: "Platform" };
export const environmentLabel = (id: string) => ENV_LABEL[id] ?? id;

/** Optional parts of a live dataset. A missing report or an error leaves its capability null with the reason. */
export interface SecurityPosture {
  controls?: SecurityControlReport; controlsError?: string;
  vulnerabilities?: SecurityVulnerabilityReport; vulnerabilitiesError?: string;
  findingsRequest?: SecurityRequestState; controlsRequest?: SecurityRequestState; vulnerabilitiesRequest?: SecurityRequestState;
}

const VULN_SEVERITY: Record<string, SecuritySeverity> = { critical: "critical", high: "high", medium: "medium", low: "low", negligible: "low", unknown: "unknown" };
const FIX_STATE: Record<string, string> = { fixed: "수정 버전 있음", not_fixed: "수정 버전 없음", wont_fix: "배포판이 수정하지 않기로 함", unknown: "수정 여부 미확인" };

/** Who set a severity, the source's own value and the policy version, in one line. */
export function basisText(b: SecuritySeverityBasis): string {
  const origin = b.type === "vendor" ? "벤더 등급" : b.type === "cvss" ? "CVSS" : "HopCharlie 정책";
  const source = [b.sourceSeverity, b.sourceScore === undefined ? undefined : `점수 ${b.sourceScore}`].filter(Boolean).join(" · ");
  return `${origin} · ${b.issuer}${source ? ` (${source})` : ""} · ${b.policy}`;
}

/** Maps the platform's reports. Controls and vulnerabilities come only from their own APIs, never from findings or fixtures. */
export function securityData(report?: SecurityReport, posture: SecurityPosture = {}): SecurityDataset {
  const environments = new Map<string, { id: string; label: string; provider: string }>();
  for (const row of [...(report?.sources ?? []), ...(report?.findings ?? [])]) {
    environments.set(row.environment, { id: row.environment, label: ENV_LABEL[row.environment] ?? row.environment, provider: PROVIDER_LABEL[row.provider] });
  }
  for (const key of report?.storageKeys ?? []) {
    if (!environments.has(key.environment)) environments.set(key.environment, { id: key.environment, label: ENV_LABEL[key.environment] ?? key.environment, provider: key.driver });
  }
  const domainByCategory: Record<string, Domain> = { identity: "identity", data: "data", logging: "logging", network: "policy", workload: "policy" };
  // A response that does not follow the contract (an older server, a proxy page) is unavailable, not empty.
  const controlReport = isControlReport(posture.controls) ? posture.controls : undefined;
  const vulnReport = isVulnerabilityReport(posture.vulnerabilities) ? posture.vulnerabilities : undefined;
  const controls = controlReport ? controlRows(controlReport, report?.sources) : null;
  const scanner = vulnReport?.scanner;
  const scanEvidence = !!vulnReport && (vulnReport.scans.some((s) => s.status === "succeeded") || vulnReport.vulnerabilities.length > 0 || vulnReport.runningImages.some((i) => i.scanState === "scanned"));
  const vulnerabilities = vulnReport && scanner?.status === "connected" && scanEvidence ? vulnerabilityRows(vulnReport) : null;
  const observations = {
    findings: reportObservation("GET /v1/security", report?.generatedAt, posture.findingsRequest),
    controls: reportObservation("GET /v1/security/controls", controlReport?.generatedAt, posture.controlsRequest, posture.controlsError),
    vulnerabilities: reportObservation("GET /v1/security/vulnerabilities", vulnReport?.generatedAt, posture.vulnerabilitiesRequest, posture.vulnerabilitiesError),
  };
  if (posture.controls && !controlReport && !posture.controlsRequest?.error) observations.controls = { ...observations.controls, state: "error", reason: "통제 평가 API 응답이 계약 형식과 다릅니다." };
  if (posture.vulnerabilities && !vulnReport && !posture.vulnerabilitiesRequest?.error) observations.vulnerabilities = { ...observations.vulnerabilities, state: "error", reason: "취약점 API 응답이 계약 형식과 다릅니다." };
  if (observations.controls.state === "observed" && !controls?.some((c) => c.status === "pass" || c.status === "fail")) {
    observations.controls = { ...observations.controls, state: "unobserved", reason: "판정 가능한 통제 평가가 없습니다. 미확인·해당 없음과 통과는 다릅니다." };
  }
  if (observations.vulnerabilities.state === "observed" && vulnReport && vulnerabilities === null) {
    const failed = scanner?.status === "error" || vulnReport.scans.some((s) => s.status === "failed");
    const unsupported = vulnReport.scans.length > 0 && vulnReport.scans.every((s) => s.status === "unsupported");
    observations.vulnerabilities = { ...observations.vulnerabilities, state: failed ? "error" : unsupported ? "unsupported" : "unobserved", reason: scanner?.message ?? (failed ? "스캔 수집에 실패했습니다." : unsupported ? "저장된 스캔이 해당 이미지를 지원하지 않습니다." : "성공한 이미지 스캔을 아직 관측하지 못했습니다. 취약점 0건이 아닙니다.") };
  }
  for (const row of [...(controlReport?.coverage ?? []), ...(controlReport?.evaluations ?? []), ...(vulnReport?.runningImages ?? [])]) {
    if (!environments.has(row.environment)) environments.set(row.environment, { id: row.environment, label: environmentLabel(row.environment), provider: "출처 미확인" });
  }
  const unavailable: NonNullable<SecurityDataset["unavailable"]> = {};
  if (!controls) {
    unavailable.controls = posture.controlsError ? `통제 평가 API 오류: ${posture.controlsError}`
      : posture.controls ? "통제 평가 API 응답이 계약 형식과 다릅니다."
      : "통제 평가 API 응답을 아직 받지 못했습니다.";
  }
  if (!vulnerabilities) {
    const images = vulnReport?.runningImages ?? [];
    const digests = new Set(images.flatMap((i) => (i.digest ? [i.digest] : []))).size;
    unavailable.vulnerabilities = posture.vulnerabilitiesError ? `취약점 API 오류: ${posture.vulnerabilitiesError}`
      : posture.vulnerabilities && !vulnReport ? "취약점 API 응답이 계약 형식과 다릅니다."
      : !vulnReport ? "취약점 API 응답을 아직 받지 못했습니다."
      : `${observations.vulnerabilities.reason} 실행 중 컨테이너 ${images.length}개(이미지 digest ${digests}개)의 스캔 상태를 확인하세요. 이는 취약점 0건이 아닙니다.`;
  }
  const latestScan = vulnReport?.scans.filter((s) => s.finishedAt).sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0];
  const scanCounts = vulnReport ? `스캔 성공 ${vulnReport.scans.filter((s) => s.status === "succeeded").length}개 · 실패/미지원 ${vulnReport.scans.filter((s) => s.status !== "succeeded").length}개 digest. ` : "";
  const scanSource: SecuritySourceRow[] = vulnReport ? [{
    id: "platform/image-scan", name: "이미지 취약점 스캔", environment: "platform",
    status: scanner?.status === "connected" ? "ok" : scanner?.status === "error" ? "error" : "not_configured",
    scope: "실행 중 이미지 digest의 저장된 스캔 결과", lastCollected: vulnReport.generatedAt, lastScanned: latestScan?.finishedAt ?? null,
    scannerVersion: latestScan ? `${latestScan.scanner.name} ${latestScan.scanner.version}` : undefined,
    databaseUpdatedAt: latestScan?.database?.builtAt,
    codeUrl: securityCodeUrl("image-scan"),
    detail: `${scanner?.status === "connected" ? scanCounts : ""}${scanner?.message ?? "조회 API는 스캔하지 않고 저장된 결과만 읽습니다."}`,
  }] : [];
  const EXPLOIT_SCOPE: Record<string, [string, string]> = {
    "cisa-kev": ["CISA KEV", "알려진 악용 취약점 카탈로그 · 취약점 우선순위 근거"],
    "first-epss": ["FIRST EPSS", "30일 내 악용 확률 추정 · 취약점 우선순위 근거"],
  };
  const exploitSources = (vulnReport?.exploitSources ?? []).map((s): SecuritySourceRow => ({
    id: `platform/${s.name}`, name: EXPLOIT_SCOPE[s.name]?.[0] ?? s.name, environment: "platform", status: s.state,
    scope: EXPLOIT_SCOPE[s.name]?.[1] ?? "취약점 우선순위 근거", lastCollected: s.collectedAt ?? null, lastScanned: null,
    detail: `${s.version ? `기준 ${s.version} · ` : ""}${s.message}`,
  }));
  return {
    mode: "live", generatedAt: report?.generatedAt ?? controlReport?.generatedAt ?? vulnReport?.generatedAt ?? null,
    environments: [...environments.values()], apps: [], appFilterAvailable: false,
    controls, vulnerabilities, unavailable, observations,
    runningImages: vulnReport ? runningImageRows(vulnReport) : undefined,
    coverage: controlReport?.coverage, policyVersion: controlReport?.policyVersion,
    findings: (report?.findings ?? []).map((f) => ({
      id: f.id, title: f.title,
      kind: f.kind === "threat" || f.kind === "governance" || f.kind === "configuration" ? f.kind
        : f.category === "threat" ? "threat" : f.source.startsWith("platform-") || f.source === "storage-keys" ? "governance" : "configuration",
      environment: f.environment, severity: f.severity, source: SOURCE_LABEL[f.source] ?? f.source,
      check: f.check, category: f.category, domain: domainByCategory[f.category], controlId: f.controlId,
      basisUrl: f.severityBasis?.sourceUrl ?? null, severityBasis: f.severityBasis ? basisText(f.severityBasis) : undefined,
      resource: f.resource, detail: f.detail, recommendation: f.recommendation, observedAt: f.observedAt,
      exception: exceptionInfo(f.exception),
    })),
    sources: [...(report?.sources ?? []).map((s): SecuritySourceRow => ({
      id: `${s.environment}/${s.name}`, name: SOURCE_LABEL[s.name] ?? s.name, environment: s.environment,
      status: s.status, scope: "플랫폼이 보고한 발견 항목과 수집 상태", lastCollected: s.checkedAt,
      lastScanned: null, detail: s.message ?? "출처 조회 성공과 개별 통제 통과는 별개입니다.",
      codeUrl: securityCodeUrl(s.name),
    })), ...scanSource, ...exploitSources],
    storageKeys: report?.storageKeys,
    storageKeySources: (report?.sources ?? []).filter((s) => s.name === "storage-keys"),
  };
}

function isControlReport(r: unknown): r is SecurityControlReport {
  const v = r as Partial<SecurityControlReport> | undefined;
  return !!v && Array.isArray(v.controls) && Array.isArray(v.evaluations) && Array.isArray(v.coverage);
}

function isVulnerabilityReport(r: unknown): r is SecurityVulnerabilityReport {
  const v = r as Partial<SecurityVulnerabilityReport> | undefined;
  return !!v && typeof v.scanner?.status === "string" && Array.isArray(v.vulnerabilities) && Array.isArray(v.runningImages) && Array.isArray(v.scans);
}

function controlRows(r: SecurityControlReport, sources: SecuritySource[] = []): ControlEvaluation[] {
  const byId = new Map(r.controls.map((c) => [c.id, c]));
  return r.evaluations.flatMap((e) => {
    const c = byId.get(e.controlId);
    if (!c) return [];
    const refs = c.references.map((ref) => `${ref.framework} ${ref.id}${ref.relation === "partial" ? " (부분 대응)" : ""}`);
    const source = sources.find((s) => s.environment === e.environment && s.name === e.source);
    return [{
      id: e.id, title: c.title, controlId: [c.id, ...refs].join(" · "), domain: c.domain, environment: e.environment,
      status: e.result, basisUrl: evidenceUrl(c.references.find((ref) => evidenceUrl(ref.url))?.url), asset: e.asset,
      source: e.source, sourceStatus: source?.status, sourceReason: source?.message, codeUrl: securityCodeUrl(e.source),
      ruleCodeUrl: c.source !== e.source ? securityCodeUrl(c.source) : undefined,
      evidence: `${e.asset === "*" ? "전체 자산" : e.asset}: ${e.reason}`,
      recommendation: [`통과 조건: ${c.condition}`, ...c.limitations].join(" "),
      observedAt: e.evaluatedAt,
    }];
  });
}

function vulnerabilityRows(r: SecurityVulnerabilityReport): VulnerabilityFinding[] {
  return r.vulnerabilities.map((v) => {
    const score = v.cvss[0];
    const fixed = v.fixedVersions.length ? v.fixedVersions.join(", ") : null;
    const scan = r.scans.find((s) => s.id === v.scanId && s.digest === v.digest);
    return {
      id: v.id, advisory: v.advisory, title: `${v.package.name} ${v.package.version} (${v.package.type})`,
      package: v.package.name, installedVersion: v.package.version, fixedVersion: fixed,
      severity: VULN_SEVERITY[v.severity] ?? "unknown",
      cvss: score ? score.baseScore : null, cvssVersion: score?.version ?? "", cvssVector: score?.vector,
      scoreSource: score ? `${score.source} · ${basisText(v.severityBasis)}` : basisText(v.severityBasis),
      basisUrl: evidenceUrl(v.urls.find((url) => evidenceUrl(url))), ...exploitFields(v), imageDigest: v.digest,
      scanId: v.scanId, scannedAt: scan?.finishedAt, scanner: scan ? `${scan.scanner.name} ${scan.scanner.version}` : undefined, databaseBuiltAt: scan?.database?.builtAt, codeUrl: securityCodeUrl(scan?.scanner.name === "grype" ? "grype" : "image-scan"),
      occurrences: r.runningImages.filter((i) => i.digest === v.digest && (!i.scanId || i.scanId === v.scanId)).map((i) => ({
        environment: i.environment, app: i.app ?? "앱 미확인", workload: `${i.workload}/${i.container}`, namespace: i.namespace, running: true,
        deployed: deployedState(i.deployed),
      })),
      detail: FIX_STATE[v.fixState] ?? v.fixState,
      recommendation: fixed ? `${v.package.name}을(를) ${fixed} 이상으로 올린 이미지를 다시 빌드하세요.` : "수정 버전이 없으면 배포판 공지를 확인하고 완화책을 검토하세요.",
      exception: exceptionInfo(v.exception),
    };
  });
}


function exploitFields(v: SecurityVulnerabilityReport["vulnerabilities"][number]): Pick<VulnerabilityFinding, "kev" | "epss" | "epssDate" | "kevState" | "epssState" | "epssPercentile" | "kevDueDate" | "ransomware"> {
  const e = v.exploitation;
  if (!e) return { kev: null, epss: null, epssDate: null };
  return {
    kev: e.kev.state === "listed" ? true : e.kev.state === "not_listed" ? false : null,
    kevState: e.kev.state, kevDueDate: e.kev.dueDate, ransomware: e.kev.ransomware,
    epss: e.epss.state === "scored" ? e.epss.probability ?? null : null,
    epssPercentile: e.epss.percentile ?? null, epssDate: e.epss.date ?? null, epssState: e.epss.state,
  };
}

function deployedState(d?: SecurityDeployedImage): DeployedState | undefined {
  return d ? { state: d.state, reason: d.reason ?? "", deploymentId: d.deploymentId, digest: d.digest } : undefined;
}

function runningImageRows(r: SecurityVulnerabilityReport): RunningImageRow[] {
  const scans = new Map(r.scans.map((s) => [s.id, s]));
  return r.runningImages.map((i) => {
    const candidate = i.scanId ? scans.get(i.scanId) : undefined;
    const scan = candidate?.digest === i.digest ? candidate : undefined;
    return {
      id: `${i.environment}/${i.namespace}/${i.workload}/${i.container}@${i.digest ?? ""}`,
      environment: i.environment, namespace: i.namespace, workload: i.workload, container: i.container, app: i.app ?? null,
      image: i.image, digest: i.digest ?? null, scanState: i.scanState,
      scannedAt: scan?.finishedAt ?? null, scanMessage: scan?.message, deployed: deployedState(i.deployed),
      scanId: i.scanId, scanStatus: scan?.status,
    };
  });
}

export const SCAN_STATE: Record<RunningImageRow["scanState"], [string, string]> = {
  scanned: ["스캔됨", "ok"], scan_failed: ["스캔 실패", "bad"], not_scanned: ["미검사", "warn"], unknown_digest: ["digest 미확인", "warn"],
};
export const DEPLOYED_STATE: Record<DeployedState["state"], [string, string]> = {
  match: ["배포 기록과 일치", "ok"], mismatch: ["배포 기록과 다름", "bad"], no_record: ["배포 기록 없음", ""], unknown: ["비교 불가", "warn"],
};

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
