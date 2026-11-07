import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { securityData } from "../data/security";
import type { SecurityControlReport, SecurityVulnerabilityReport } from "../api/types";
import { SecurityWorkspace } from "./SecurityWorkspace";

const generatedAt = "2026-11-08T00:00:00Z";
const controlReport: SecurityControlReport = { generatedAt, policyVersion: "p1", controls: [{ id: "check", title: "Container policy", domain: "policy", check: "k8s.privileged", source: "kubernetes", asset: "container", condition: "unprivileged", mapping: "unmapped", references: [], failSeverity: "high", severityBasis: { type: "platform_policy", issuer: "platform", policy: "p1" }, limitations: [] }], coverage: [], evaluations: [] };
const imageReport: SecurityVulnerabilityReport = { generatedAt, scanner: { status: "connected" }, scans: [], vulnerabilities: [], runningImages: [{ environment: "onprem", namespace: "shop", workload: "Deployment/web", container: "app", image: "registry/web:v1", digest: "sha256:other", scanState: "not_scanned" }], summary: { advisories: 0, images: 0, affectedContainers: 0, occurrences: 0, notScannedContainers: 1 } };
afterEach(cleanup);

it("does not present an empty successful control report as failure zero or completion zero/zero", () => {
  render(<SecurityWorkspace route="security" data={securityData(undefined, { controls: controlReport })} />);
  expect(screen.getByRole("link", { name: /실패한 통제 평가/ })).toHaveTextContent("미관측");
  expect(screen.getByRole("link", { name: /통제 평가 완료/ })).toHaveTextContent("미관측");
  expect(screen.getByRole("link", { name: /통제 평가 완료/ })).not.toHaveTextContent("0/ 0");
});

it("keeps an onprem image-only scope unobserved when controls were evaluated only in GKE", async () => {
  const data = securityData(undefined, { controls: { ...controlReport, evaluations: [{ id: "gke-check", controlId: "check", environment: "gke", source: "kubernetes", asset: "shop/web", result: "pass", reason: "unprivileged", evaluatedAt: generatedAt, findingIds: [] }] }, vulnerabilities: imageReport });
  render(<SecurityWorkspace route="security" data={data} />);
  const row = screen.getByRole("row", { name: /^onprem/ });
  expect(within(row).getAllByText("미관측")).toHaveLength(5);
  expect(row).not.toHaveTextContent("통과 0");
  await userEvent.setup().selectOptions(screen.getByLabelText("보안 환경"), "onprem");
  expect(screen.getByRole("link", { name: /실패한 통제 평가/ })).toHaveTextContent("미관측");
  expect(screen.getByRole("link", { name: /통제 평가 완료/ })).toHaveTextContent("미관측");
});

it("keeps a real not-applicable evaluation apart from missing observations", () => {
  render(<SecurityWorkspace route="security" data={securityData(undefined, { controls: { ...controlReport, evaluations: [{ id: "na", controlId: "check", environment: "gke", source: "kubernetes", asset: "*", result: "not_applicable", reason: "no containers", evaluatedAt: generatedAt, findingIds: [] }] } })} />);
  expect(screen.getByRole("link", { name: /통제 평가 완료/ })).toHaveTextContent("해당 없음");
  expect(screen.getByRole("link", { name: /통제 평가 완료/ })).not.toHaveTextContent("0/ 0");
});

it("uses explicit unsupported coverage instead of inventing an evaluated zero", () => {
  const coverage = (["identity", "data", "logging", "policy", "vulnerability"] as const).map((domain) => ({ environment: "onprem", domain, state: "unsupported" as const, reason: "no implemented control", counts: { applicable: 0, evaluated: 0, pass: 0, fail: 0, unknown: 0, notApplicable: 0 } }));
  render(<SecurityWorkspace route="security" data={securityData(undefined, { controls: { ...controlReport, coverage } })} />);
  expect(screen.getByRole("link", { name: /통제 평가 완료/ })).toHaveTextContent("미지원");
  const row = screen.getByRole("row", { name: /^onprem/ });
  expect(within(row).getAllByText("미지원 · 검사 통제 없음")).toHaveLength(5);
  expect(row).not.toHaveTextContent("통과 0");
});

it("shows the selected scan coverage beside a clean result with other unscanned containers", () => {
  const images: SecurityVulnerabilityReport = { ...imageReport, scans: [{ id: "clean", digest: "sha256:clean", status: "succeeded", scanner: { name: "grype", version: "1" } }], runningImages: [{ ...imageReport.runningImages[0], digest: "sha256:clean", scanId: "clean", scanState: "scanned" }, imageReport.runningImages[0]] };
  render(<SecurityWorkspace route="security" data={securityData(undefined, { vulnerabilities: images })} />);
  expect(screen.getByText("선택 범위 · 검사됨 1/2 컨테이너 · 미검사·실패 1")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /취약 이미지/ })).toHaveTextContent("0개");
});
