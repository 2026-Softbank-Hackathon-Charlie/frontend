import type { SecurityReport } from "../api/types";
import { controlCounts, filterControls, filterVulnerabilities, securityData, summarizeVulnerabilities, type ControlEvaluation, type VulnerabilityFinding } from "./security";

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
