import type { SecurityFinding, SecurityReport, SecuritySource } from "../api/types";
import { SIM_SECURITY } from "../sim/security";
import { securityMatrix } from "./securityMatrix";

const at = "2026-11-06T00:00:00Z";
const src = (name: string, environment: string, status: SecuritySource["status"] = "ok"): SecuritySource => ({
  name,
  environment,
  status,
  provider: environment === "aws-account" ? "aws" : environment === "gcp-project" ? "gcp" : "onprem",
  checkedAt: at,
  findings: 0,
});
const finding = (f: Partial<SecurityFinding>): SecurityFinding => ({
  id: "x",
  environment: "aws-account",
  provider: "aws",
  source: "aws-guardduty",
  check: "c",
  category: "threat",
  severity: "low",
  title: "t",
  resource: "r",
  detail: "d",
  recommendation: "",
  observedAt: at,
  ...f,
});
const report = (sources: SecuritySource[], findings: SecurityFinding[]): SecurityReport => ({
  generatedAt: at,
  summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
  sources,
  findings,
});

describe("environment × category matrix", () => {
  it("shows the highest severity and the count", () => {
    const [row] = securityMatrix(
      report([src("aws-guardduty", "aws-account")], [finding({ severity: "low" }), finding({ id: "y", severity: "high" }), finding({ id: "z", severity: "medium" })]),
    );
    expect(row.cells.threat).toEqual({ kind: "findings", count: 3, top: "high" });
  });

  it("tells clean, unread and unchecked apart", () => {
    const rows = securityMatrix(
      report([src("aws-iam", "aws-account"), src("aws-guardduty", "aws-account", "error"), src("gcp-scc", "gcp-project", "not_configured"), src("kubernetes", "k3s")], []),
    );
    const aws = rows.find((r) => r.environment === "aws-account")!;
    expect(aws.cells.identity).toEqual({ kind: "clean", sources: ["aws-iam"] });
    expect(aws.cells.threat).toEqual({ kind: "unread", sources: ["aws-guardduty"] });
    expect(aws.cells.data).toEqual({ kind: "unchecked" });
    // a not-configured aggregator covers everything but read nothing
    const gcp = rows.find((r) => r.environment === "gcp-project")!;
    expect(Object.values(gcp.cells).every((c) => c.kind === "unread")).toBe(true);
    // on-prem Kubernetes checks workloads, network and identity; no threat detection
    const k3s = rows.find((r) => r.environment === "k3s")!;
    expect(k3s.cells.workload.kind).toBe("clean");
    expect(k3s.cells.threat.kind).toBe("unchecked");
    expect(k3s.cells.logging.kind).toBe("unchecked");
  });

  it("covers an unknown source by the categories it reported", () => {
    const [row] = securityMatrix(report([src("new-scanner", "k3s")], [finding({ environment: "k3s", source: "new-scanner", category: "data", provider: "onprem" })]));
    expect(row.cells.data.kind).toBe("findings");
    expect(row.cells.network.kind).toBe("unchecked");
  });

  it("keeps an environment that only findings name", () => {
    const rows = securityMatrix(report([], [finding({ environment: "edge" })]));
    expect(rows.map((r) => r.environment)).toEqual(["edge"]);
  });

  it("orders rows like the report's sources", () => {
    expect(securityMatrix(SIM_SECURITY).map((r) => r.environment)).toEqual(["eks", "gke", "k3s"]);
  });
});
