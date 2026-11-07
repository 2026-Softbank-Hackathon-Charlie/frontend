import type { SecurityReport } from "../api/types";
import { controlCounts, environmentLabel, filterControls, filterVulnerabilities, securityData, summarizeVulnerabilities, type ControlEvaluation, type VulnerabilityFinding } from "./security";

const control = (id: string, status: ControlEvaluation["status"], environment: ControlEvaluation["environment"] = "eks", app?: string): ControlEvaluation => ({
  id, title: id, controlId: "TEST.1", domain: "identity", environment, app, status,
  basisUrl: "https://example.org/control", evidence: "fixture", recommendation: "fixture", observedAt: "2026-11-06T00:00:00Z",
});
const vulnerability = (id: string, partial: Partial<VulnerabilityFinding> = {}): VulnerabilityFinding => ({
  id, advisory: "CVE-2021-44228", title: "fixture", package: "log4j-core", installedVersion: "2.14.1", fixedVersion: "2.15.0", severity: "critical",
  cvss: 10, cvssVersion: "3.1", scoreSource: "Apache", basisUrl: "https://logging.apache.org/security.html", kev: null, epss: null, epssDate: null,
  imageDigest: "sha256:one", detail: "fixture", recommendation: "fixture",
  occurrences: [{ environment: "eks", app: "moimroom", workload: "Deployment/web", namespace: "moimroom", running: true }], ...partial,
});

describe("security scope and denominators", () => {
  it("keeps failed and unknown evaluations separate, excluding N/A from completed", () => {
    expect(controlCounts([control("p", "pass"), control("f", "fail"), control("u", "unknown"), control("n", "not_applicable")])).toEqual({
      pass: 1, fail: 1, unknown: 1, notApplicable: 1, total: 4, completed: 2,
    });
  });

  it("filters both environment and app without attaching account checks to an app", () => {
    const rows = [control("account", "fail"), control("eks-app", "pass", "eks", "moimroom"), control("gke-app", "unknown", "gke", "moimroom")];
    expect(filterControls(rows, "all", "all").map((r) => r.id)).toEqual(["account", "eks-app", "gke-app"]);
    expect(filterControls(rows, "eks", "moimroom").map((r) => r.id)).toEqual(["eks-app"]);
    expect(filterControls(rows, "gke", "all").map((r) => r.id)).toEqual(["gke-app"]);
  });

  it("narrows a vulnerability's occurrences without changing the original", () => {
    const rows = [vulnerability("one", { occurrences: [
      { environment: "eks", app: "moimroom", workload: "Deployment/web", namespace: "moimroom", running: true },
      { environment: "gke", app: "moimroom", workload: "Deployment/web", namespace: "moimroom", running: null },
    ] }), vulnerability("other", { occurrences: [{ environment: "k3s", app: "platform", workload: "Deployment/worker", namespace: "platform", running: false }] })];
    const filtered = filterVulnerabilities(rows, "gke", "moimroom");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].occurrences).toEqual([{ environment: "gke", app: "moimroom", workload: "Deployment/web", namespace: "moimroom", running: null }]);
    expect(rows[0].occurrences).toHaveLength(2);
    expect(filtered[0].kev).toBeNull();
  });

  it("does not display advisories whose image has no occurrence in the selected scope", () => {
    expect(filterVulnerabilities([vulnerability("one")], "k3s", "all")).toEqual([]);
    expect(filterVulnerabilities([vulnerability("one")], "all", "platform")).toEqual([]);
  });

  it("counts advisory IDs, image digests, running workload identities and package occurrences separately", () => {
    const occurrences: VulnerabilityFinding["occurrences"] = [
      { environment: "eks", app: "moimroom", workload: "Deployment/web", namespace: "moimroom", running: true },
      { environment: "gke", app: "moimroom", workload: "Deployment/web", namespace: "moimroom", running: true },
      { environment: "k3s", app: "moimroom", workload: "Deployment/web", namespace: "moimroom", running: null },
    ];
    const rows = [vulnerability("first", { occurrences }), vulnerability("second", { advisory: "CVE-2022-42889", package: "commons-text", occurrences }),
      vulnerability("third", { imageDigest: "sha256:two", occurrences: [{ environment: "eks", app: "platform", workload: "Job/archive", namespace: "platform", running: false }] })];
    expect(summarizeVulnerabilities(rows)).toEqual({ advisories: 2, images: 2, workloads: 2, occurrences: 3 });
  });

  it("deduplicates repeated package findings and keeps other versions separate", () => {
    const one = vulnerability("one");
    expect(summarizeVulnerabilities([one, { ...one, id: "duplicate" }, { ...one, id: "other-version", installedVersion: "2.14.0" }])).toEqual({
      advisories: 1, images: 1, workloads: 1, occurrences: 2,
    });
  });

  it("returns zeroes for a genuinely empty scope", () => {
    expect(controlCounts([])).toEqual({ pass: 0, fail: 0, unknown: 0, notApplicable: 0, total: 0, completed: 0 });
    expect(summarizeVulnerabilities([])).toEqual({ advisories: 0, images: 0, workloads: 0, occurrences: 0 });
  });
});

describe("live security report adapter", () => {
  const report: SecurityReport = {
    generatedAt: "2026-11-06T00:00:00Z",
    summary: { bySeverity: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
    sources: [
      { name: "aws-iam", provider: "aws", environment: "aws-account", status: "error", checkedAt: "2026-11-05T23:59:00Z", findings: 1, message: "some reads denied" },
      { name: "custom-scanner", provider: "onprem", environment: "edge-02", status: "unavailable", checkedAt: "2026-11-05T23:58:00Z", findings: 0 },
    ],
    findings: [{ id: "original", environment: "aws-account", provider: "aws", source: "aws-iam", check: "aws.user-mfa", category: "identity", severity: "high", title: "Original title", resource: "user/example", detail: "Original evidence", recommendation: "Original recommendation", observedAt: "2026-11-05T23:50:00Z" }],
    storageKeys: [{ app: "shop", instance: "shop-dev", environment: "storage-only", driver: "minio", bucket: "example", keyId: "...1234", use: "current", state: "unread" }],
  };

  it("keeps missing capabilities unavailable even when there are no findings", () => {
    const data = securityData();
    expect(data.mode).toBe("live");
    expect(data.controls).toBeNull();
    expect(data.vulnerabilities).toBeNull();
    expect(data.generatedAt).toBeNull();
    expect(data.appFilterAvailable).toBe(false);
    expect(data.environments).toEqual([]);
    expect(data.storageKeys).toBeUndefined();
  });

  it("keeps account, custom and storage-only environments without inventing clusters", () => {
    const data = securityData(report);
    expect(data.environments.map((e) => e.id)).toEqual(["aws-account", "edge-02", "storage-only"]);
    expect(data.environments[1].label).toBe("edge-02");
    expect(data.storageKeys).toEqual(report.storageKeys);
  });

  it("preserves original findings without inventing app or official-control mappings", () => {
    expect(securityData(report).findings[0]).toMatchObject({
      id: "original", severity: "high", title: "Original title", check: "aws.user-mfa", domain: "identity",
      category: "identity", resource: "user/example", detail: "Original evidence", recommendation: "Original recommendation", basisUrl: null,
    });
    expect(securityData(report).findings[0].app).toBeUndefined();
    expect(securityData(report).findings[0].controlId).toBeUndefined();
  });

  it("keeps source failures and read timestamps separate from scan evidence", () => {
    const data = securityData(report);
    expect(data.sources.map((s) => s.status)).toEqual(["error", "unavailable"]);
    expect(data.sources[0]).toMatchObject({ detail: "some reads denied", lastCollected: report.sources[0].checkedAt, lastScanned: null });
    expect(data.sources[1].name).toBe("custom-scanner");
    expect(data.sources[1].scannerVersion).toBeUndefined();
  });
});

describe("live posture mapping", () => {
  const generatedAt = "2026-11-06T09:00:00Z";
  const control = {
    id: "HC-IDN-03", title: "IAM user MFA", domain: "identity" as const, check: "aws.user-mfa", source: "aws-iam", asset: "IAM user", condition: "console users have MFA",
    mapping: "exact" as const, failSeverity: "medium", limitations: ["fixture limitation"],
    references: [{ framework: "AWS Security Hub CSPM", version: "2026-11-06", id: "IAM.5", url: "https://docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-5", relation: "exact" as const, severity: "Medium" }],
    severityBasis: { type: "vendor" as const, issuer: "AWS Security Hub CSPM", policy: "hopcharlie-security-policy/2026-11-06.1", sourceSeverity: "Medium" },
  };
  const evaluation = (id: string, asset: string, result: "pass" | "fail" | "unknown" | "not_applicable", controlId = "HC-IDN-03") => ({
    id, controlId, environment: "aws-account", source: "aws-iam", asset, result, reason: "fixture " + result, evaluatedAt: generatedAt, findingIds: [],
  });
  const digest = "sha256:" + "1".repeat(64);
  const images = [
    { environment: "gke", namespace: "shop", workload: "Deployment/web", container: "app", app: "shop", image: "ghcr.io/x/app:v1", digest, scanState: "scanned" as const, scanId: "scan1" },
    { environment: "eks", namespace: "shop", workload: "Deployment/web", container: "app", image: "ghcr.io/x/app:v1", scanState: "unknown_digest" as const },
  ];
  const summary = { advisories: 0, images: 0, affectedContainers: 0, occurrences: 0, notScannedContainers: 2 };

  it("leaves controls and vulnerabilities unavailable, with the reason, until their APIs answer", () => {
    const d = securityData(undefined, { controlsError: "404 not_found" });
    expect(d.controls).toBeNull();
    expect(d.vulnerabilities).toBeNull();
    expect(d.unavailable?.controls).toContain("404");
    expect(d.unavailable?.vulnerabilities).toBeTruthy();
  });

  it("treats a response outside the contract as unavailable, not empty", () => {
    const d = securityData(undefined, { controls: {} as never, vulnerabilities: { generatedAt } as never });
    expect(d.controls).toBeNull();
    expect(d.vulnerabilities).toBeNull();
    expect(d.unavailable?.controls).toContain("계약 형식");
    expect(d.unavailable?.vulnerabilities).toContain("계약 형식");
  });

  it("maps every evaluation with its control, asset and reference relation", () => {
    const d = securityData(undefined, { controls: { generatedAt, policyVersion: "hopcharlie-security-policy/2026-11-06.1", controls: [control], coverage: [],
      evaluations: [evaluation("e1", "user/alice", "pass"), evaluation("e2", "user/bob", "fail"), evaluation("e3", "*", "unknown"), evaluation("orphan", "x", "fail", "HC-NOPE")] } });
    expect(d.controls?.map((c) => [c.id, c.status, c.asset])).toEqual([["e1", "pass", "user/alice"], ["e2", "fail", "user/bob"], ["e3", "unknown", "*"]]);
    expect(d.controls?.[0].controlId).toBe("HC-IDN-03 · AWS Security Hub CSPM IAM.5");
    expect(d.controls?.[2].evidence).toContain("전체 자산");
    expect(d.policyVersion).toBe("hopcharlie-security-policy/2026-11-06.1");
  });

  it("keeps a shared control's source evidence separate by environment without inventing app ownership", () => {
    const controls = { generatedAt, policyVersion: "p1", controls: [control], coverage: [], evaluations: [
      evaluation("first", "user/alice", "pass"),
      { ...evaluation("second", "*", "unknown"), environment: "other-account" },
    ] };
    const base = { generatedAt, findings: [], storageKeys: [], summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} }, sources: [
      { name: "aws-iam", provider: "aws" as const, environment: "aws-account", status: "ok" as const, checkedAt: generatedAt, findings: 0 },
      { name: "aws-iam", provider: "aws" as const, environment: "other-account", status: "error" as const, checkedAt: generatedAt, findings: 0, message: "denied in other environment" },
    ] };
    const d = securityData(base, { controls });
    expect(d.controls?.map((c) => [c.id, c.environment, c.sourceStatus, c.sourceReason])).toEqual([
      ["first", "aws-account", "ok", undefined], ["second", "other-account", "error", "denied in other environment"],
    ]);
    expect(filterControls(d.controls!, "aws-account", "all").map((c) => c.id)).toEqual(["first"]);
    expect(filterControls(d.controls!, "all", "shop")).toEqual([]);
  });

  it("does not call a connected empty scan store zero vulnerabilities", () => {
    const d = securityData(undefined, { vulnerabilities: { generatedAt, scanner: { status: "connected" }, scans: [], vulnerabilities: [], runningImages: [{ ...images[0], scanState: "not_scanned", scanId: undefined }], summary } });
    expect(d.vulnerabilities).toBeNull();
    expect(d.observations?.vulnerabilities.state).toBe("unobserved");
    expect(d.unavailable?.vulnerabilities).toContain("0건이 아닙니다");
  });

  it.each([["failed", "error"], ["unsupported", "unsupported"]] as const)("keeps an entirely %s scan separate from an empty successful result", (status, state) => {
    const d = securityData(undefined, { vulnerabilities: { generatedAt, scanner: { status: "connected" }, summary, vulnerabilities: [],
      scans: [{ id: "scan1", digest, status, scanner: { name: "grype", version: "one" } }],
      runningImages: [{ ...images[0], scanState: "scan_failed" }],
    } });
    expect(d.vulnerabilities).toBeNull();
    expect(d.observations?.vulnerabilities.state).toBe(state);
    expect(d.runningImages?.[0].scanStatus).toBe(status);
  });

  it("joins CVE evidence by scan ID and image digest, and preserves only its actual container occurrences", () => {
    const other = "sha256:" + "2".repeat(64);
    const baseV = { id: "v1", scanId: "scan1", digest, advisory: "CVE-2026-0001", aliases: [], package: { name: "openssl", version: "3", type: "deb" }, fixedVersions: [], fixState: "unknown" as const, severity: "high" as const, severityBasis: { type: "vendor" as const, issuer: "grype", policy: "p1" }, cvss: [], urls: ["javascript:alert(1)", "https://nvd.nist.gov/vuln/detail/CVE-2026-0001"] };
    const d = securityData(undefined, { vulnerabilities: { generatedAt, scanner: { status: "connected" }, summary,
      scans: [
        { id: "scan1", digest, status: "succeeded", scanner: { name: "grype", version: "one" }, finishedAt: generatedAt },
        { id: "scan2", digest: other, status: "succeeded", scanner: { name: "grype", version: "two" }, finishedAt: "2026-11-06T08:00:00Z" },
      ],
      vulnerabilities: [baseV, { ...baseV, id: "other", digest: other, scanId: "scan1" }, { ...baseV, id: "valid-other", digest: other, scanId: "scan2" }],
      runningImages: [images[0], { ...images[0], environment: "eks", digest: other, scanId: "scan2" }, { ...images[0], environment: "onprem", scanId: "scan2" }],
    } });
    expect(d.vulnerabilities?.[0]).toMatchObject({ scanId: "scan1", scanner: "grype one", scannedAt: generatedAt, basisUrl: baseV.urls[1] });
    expect(d.vulnerabilities?.[0].occurrences.map((o) => o.environment)).toEqual(["gke"]);
    expect(d.vulnerabilities?.[1].scanner).toBeUndefined();
    expect(d.vulnerabilities?.[1].occurrences).toEqual([]);
    expect(d.vulnerabilities?.[2].scanner).toBe("grype two");
    expect(d.vulnerabilities?.[2].occurrences.map((o) => o.environment)).toEqual(["eks"]);
    expect(d.runningImages?.map((i) => i.scannedAt)).toEqual([generatedAt, "2026-11-06T08:00:00Z", null]);
  });

  it("does not turn a missing scanner into zero vulnerabilities", () => {
    const d = securityData(undefined, { vulnerabilities: { generatedAt, scanner: { status: "not_configured", message: "no scanner" }, scans: [], vulnerabilities: [], runningImages: images, summary } });
    expect(d.vulnerabilities).toBeNull();
    expect(d.unavailable?.vulnerabilities).toContain("컨테이너 2개");
    expect(d.unavailable?.vulnerabilities).toContain("0건이 아닙니다");
    expect(d.sources.find((s) => s.id === "platform/image-scan")?.status).toBe("not_configured");
  });

  it("links a scanned vulnerability to the running containers of its digest", () => {
    const basis = { type: "vendor" as const, issuer: "Grype", policy: "hopcharlie-security-policy/2026-11-06.1", sourceSeverity: "Negligible" };
    const d = securityData(undefined, { vulnerabilities: { generatedAt, scanner: { status: "connected" }, scans: [], runningImages: images, summary,
      vulnerabilities: [{ id: "v1", scanId: "scan1", digest, advisory: "CVE-2026-0001", aliases: [], package: { name: "openssl", version: "3.0.13", type: "deb" },
        fixedVersions: [], fixState: "not_fixed", severity: "negligible", severityBasis: basis, cvss: [], urls: [] }] } });
    const v = d.vulnerabilities?.[0];
    expect(v?.severity).toBe("low");
    expect(v?.cvss).toBeNull();
    expect(v?.kev).toBeNull();
    expect(v?.fixedVersion).toBeNull();
    expect(v?.occurrences).toEqual([{ environment: "gke", app: "shop", workload: "Deployment/web/app", namespace: "shop", running: true }]);
    expect(v?.scoreSource).toContain("Negligible");
  });

  it("lists every running container with its scan and deployment-record state, and the scanner's metadata", () => {
    const failedDigest = "sha256:" + "2".repeat(64);
    const d = securityData(undefined, { vulnerabilities: { generatedAt, scanner: { status: "connected" }, vulnerabilities: [], summary,
      scans: [
        { id: "scan1", digest, status: "succeeded", scanner: { name: "grype", version: "0.121.0" }, finishedAt: "2026-11-06T08:00:00Z", database: { builtAt: "2026-11-05T04:00:00Z" } },
        { id: "scan2", digest: failedDigest, status: "failed", scanner: { name: "grype", version: "0.121.0" }, finishedAt: "2026-11-06T08:30:00Z", message: "pull denied" },
      ],
      runningImages: [
        { ...images[0], deployed: { state: "mismatch", deploymentId: "dep_1", digest: "sha256:" + "9".repeat(64), reason: "differs" } },
        { ...images[1], digest: failedDigest, scanState: "scan_failed", scanId: "scan2", deployed: { state: "unknown", reason: "records unreadable" } },
      ] } });
    expect(d.vulnerabilities).toEqual([]);
    expect(d.runningImages?.map((r) => [r.scanState, r.deployed?.state, r.scanMessage])).toEqual([["scanned", "mismatch", undefined], ["scan_failed", "unknown", "pull denied"]]);
    expect(d.runningImages?.[0].scannedAt).toBe("2026-11-06T08:00:00Z");
    const source = d.sources.find((s) => s.id === "platform/image-scan");
    expect(source).toMatchObject({ status: "ok", lastScanned: "2026-11-06T08:30:00Z", scannerVersion: "grype 0.121.0" });
    expect(source?.detail).toContain("실패/미지원 1개");
  });

  it("keeps a finding's severity basis and source URL", () => {
    const report: SecurityReport = {
      generatedAt, summary: { bySeverity: { total: 1, critical: 0, high: 0, medium: 1, low: 0, info: 0 }, byEnvironment: {} }, sources: [], storageKeys: [], findings: [{
        id: "f1", source: "aws-iam", provider: "aws", environment: "aws-account", check: "aws.user-mfa", category: "identity", severity: "medium",
        title: "t", resource: "user/bob", detail: "d", recommendation: "r", observedAt: generatedAt, kind: "configuration", controlId: "HC-IDN-03",
        severityBasis: { type: "vendor", issuer: "AWS Security Hub CSPM", policy: "hopcharlie-security-policy/2026-11-06.1", sourceSeverity: "Medium", sourceUrl: "https://docs.aws.amazon.com/x" },
      }],
    };
    const f = securityData(report).findings[0];
    expect(f.basisUrl).toBe("https://docs.aws.amazon.com/x");
    expect(f.controlId).toBe("HC-IDN-03");
    expect(f.severityBasis).toContain("벤더 등급");
  });
});

describe("environmentLabel", () => {
  it("names every environment the live API reports", () => {
    expect(["eks", "gke", "onprem", "aws-account", "gcp-project", "cloudflare-account", "platform"].map(environmentLabel))
      .toEqual(["AWS EKS", "GCP GKE", "onprem", "AWS Cloud", "GCP Cloud", "Cloudflare", "Platform"]);
    expect(environmentLabel("new-env")).toBe("new-env");
  });
});

describe("exploitation evidence", () => {
  const report = (vulnerability: object | null, exploitSources: object[] = []) => ({
    generatedAt: "2026-11-07T00:00:00Z", scanner: { status: "connected" as const }, scans: [], runningImages: [],
    summary: { advisories: 1, images: 1, affectedContainers: 0, occurrences: 1, notScannedContainers: 0 },
    vulnerabilities: vulnerability ? [{
      id: "v1", scanId: "s1", digest: "sha256:a", advisory: "CVE-2024-6387", aliases: [], fixedVersions: [], fixState: "unknown" as const,
      severity: "high" as const, severityBasis: { type: "vendor" as const, issuer: "x", policy: "p1", reason: "y" }, cvss: [], urls: [],
      package: { name: "openssh", version: "9.6", type: "deb" }, ...vulnerability,
    }] : [],
    exploitSources,
  });
  it("maps KEV and EPSS evidence and lists them as sources", () => {
    const vulnerabilities = {
      generatedAt: "2026-11-07T00:00:00Z", scanner: { status: "connected" as const }, scans: [], runningImages: [],
      summary: { advisories: 1, images: 1, affectedContainers: 0, occurrences: 1, notScannedContainers: 0 },
      vulnerabilities: [{
        id: "v1", scanId: "s1", digest: "sha256:a", advisory: "CVE-2024-6387", aliases: [], fixedVersions: [], fixState: "unknown" as const,
        severity: "high" as const, severityBasis: { type: "vendor" as const, issuer: "x", policy: "p1", reason: "y" }, cvss: [], urls: [],
        package: { name: "openssh", version: "9.6", type: "deb" },
        exploitation: { cve: "CVE-2024-6387", kev: { state: "listed" as const, dueDate: "2026-11-18", ransomware: true },
          epss: { state: "scored" as const, probability: 0.042, percentile: 0.92, date: "2026-11-06" } },
      }],
      exploitSources: [{ name: "cisa-kev", state: "stale" as const, version: "2026.11.04", collectedAt: "2026-11-06T00:00:00Z", message: "refresh failed" }],
    };
    const data = securityData(undefined, { vulnerabilities });
    expect(data.vulnerabilities?.[0]).toMatchObject({ kev: true, kevState: "listed", kevDueDate: "2026-11-18", ransomware: true, epss: 0.042, epssPercentile: 0.92, epssDate: "2026-11-06" });
    expect(data.sources.find((s) => s.id === "platform/cisa-kev")).toMatchObject({ name: "CISA KEV", status: "stale", lastCollected: "2026-11-06T00:00:00Z", lastScanned: null, detail: "기준 2026.11.04 · refresh failed" });
  });

  it("lists an idle FIRST EPSS source as idle", () => {
    const data = securityData(undefined, { vulnerabilities: report(null, [{ name: "first-epss", state: "idle" as const, message: "no CVE" }]) as never });
    expect(data.sources.find((s) => s.id === "platform/first-epss")).toMatchObject({ name: "FIRST EPSS", status: "idle" });
  });

  it("keeps unknown KEV and EPSS as null with an unknown state", () => {
    const data = securityData(undefined, { vulnerabilities: report({ exploitation: { cve: "CVE-2024-6387", kev: { state: "unknown" }, epss: { state: "unknown" } } }) as never });
    expect(data.vulnerabilities?.[0]).toMatchObject({ kev: null, kevState: "unknown", epss: null, epssState: "unknown" });
  });

  it("marks a GHSA-only vulnerability as no_cve", () => {
    const data = securityData(undefined, { vulnerabilities: report({ advisory: "GHSA-aaaa-bbbb-cccc", exploitation: { kev: { state: "no_cve" }, epss: { state: "no_cve" } } }) as never });
    expect(data.vulnerabilities?.[0]).toMatchObject({ kev: null, kevState: "no_cve", epssState: "no_cve" });
  });

  it("leaves evidence empty when the vulnerability has no exploitation field", () => {
    const data = securityData(undefined, { vulnerabilities: report({}) as never });
    expect(data.vulnerabilities?.[0]).toMatchObject({ kev: null, epss: null });
    expect(data.vulnerabilities?.[0].kevState).toBeUndefined();
  });
});

describe("security exceptions", () => {
  it("maps an exception on a finding and on a vulnerability", () => {
    const exception = { id: "sx_1", targetType: "finding" as const, targetId: "f1", reason: "accepted risk", expiresAt: "2026-11-20T14:59:59Z", createdBy: "admin", createdAt: "2026-11-07T00:00:00Z" };
    const report = {
      generatedAt: "2026-11-07T00:00:00Z", sources: [], storageKeys: [],
      summary: { bySeverity: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
      findings: [{ id: "f1", environment: "eks", provider: "aws", source: "aws-iam", check: "c", category: "identity", severity: "high", title: "t", resource: "r", detail: "d", recommendation: "x", observedAt: "2026-11-07T00:00:00Z", exception }],
    } as SecurityReport;
    const data = securityData(report, { vulnerabilities: {
      generatedAt: "2026-11-07T00:00:00Z", scanner: { status: "connected" }, scans: [], runningImages: [],
      summary: { advisories: 1, images: 1, affectedContainers: 0, occurrences: 1, notScannedContainers: 0 },
      vulnerabilities: [{ id: "v1", scanId: "s", digest: "sha256:a", advisory: "CVE-1", aliases: [], fixedVersions: [], fixState: "unknown", severity: "high",
        severityBasis: { type: "vendor", issuer: "x", policy: "p" }, cvss: [], urls: [], package: { name: "p", version: "1", type: "deb" },
        exception: { ...exception, targetType: "vulnerability", targetId: "v1" } }],
    } as never });
    expect(data.findings[0].exception).toEqual({ id: "sx_1", reason: "accepted risk", expiresAt: "2026-11-20T14:59:59Z", createdBy: "admin" });
    expect(data.vulnerabilities![0].exception).toEqual({ id: "sx_1", reason: "accepted risk", expiresAt: "2026-11-20T14:59:59Z", createdBy: "admin" });
  });
});
