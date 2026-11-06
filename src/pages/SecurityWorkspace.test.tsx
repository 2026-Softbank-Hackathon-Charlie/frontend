import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chooseMode, initAuth, startSession } from "../data/live";
import { fakeSession, installFetch, json } from "../api/fakes";
import { useRoute } from "../router";
import { Security } from "./Security";
import { SecurityWorkspace } from "./SecurityWorkspace";
import { securityData } from "../data/security";
import type { SecurityReport } from "../api/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  initAuth();
});

const liveReport: SecurityReport = {
  generatedAt: "2026-11-06T00:00:00Z",
  summary: { bySeverity: { total: 2, critical: 0, high: 1, medium: 0, low: 1, info: 0 }, byEnvironment: {} },
  sources: [{ name: "kubernetes", provider: "onprem", environment: "edge-02", status: "error", checkedAt: "2026-11-06T00:00:00Z", findings: 2, message: "partial read" }],
  findings: [
    { id: "high-item", environment: "edge-02", provider: "onprem", source: "kubernetes", check: "k8s.privileged", category: "workload", severity: "high", title: "실제 높은 등급 신호", resource: "shop/web", detail: "original evidence", recommendation: "original recommendation", observedAt: "2026-11-06T00:00:00Z" },
    { id: "low-item", environment: "eks", provider: "aws", source: "aws-ec2", check: "aws.test", category: "network", severity: "low", title: "실제 낮은 등급 신호", resource: "sg-123", detail: "original evidence", recommendation: "original recommendation", observedAt: "2026-11-06T00:00:00Z" },
  ],
  storageKeys: [
    { app: "shop", instance: "shop", environment: "edge-02", driver: "minio", bucket: "edge-bucket", keyId: "...EDGE", use: "current", state: "ok" },
    { app: "shop", instance: "shop", environment: "eks", driver: "aws", bucket: "eks-bucket", keyId: "...AWS1", use: "current", state: "inactive" },
  ],
};

function RoutedSecurity() {
  return <Security route={useRoute()} />;
}

function open(route = "#security") {
  window.history.replaceState(null, "", "/" + route);
  chooseMode("demo");
  render(<RoutedSecurity />);
  return userEvent.setup();
}

describe("shared security workspace", () => {
  it("preserves original severity/category filtering and scopes storage keys to the environment", async () => {
    installFetch(() => json(200, liveReport));
    window.history.replaceState(null, "", "/#security/findings");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "실제 높은 등급 신호" })).toBeInTheDocument();
    expect(screen.getByLabelText("보안 앱")).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("발견 항목 심각도"), "high");
    expect(screen.queryByRole("link", { name: "실제 낮은 등급 신호" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("발견 항목 심각도"), "all");
    await user.selectOptions(screen.getByLabelText("발견 항목 분류"), "network");
    expect(screen.queryByRole("link", { name: "실제 높은 등급 신호" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "실제 낮은 등급 신호" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("발견 항목 분류"), "all");
    await user.selectOptions(screen.getByLabelText("보안 환경"), "edge-02");
    expect(screen.getByText("...EDGE")).toBeInTheDocument();
    expect(screen.queryByText("...AWS1")).not.toBeInTheDocument();
  });

  it("keeps source failures visible and never calls a read timestamp a scan", async () => {
    installFetch(() => json(200, liveReport));
    window.history.replaceState(null, "", "/#security/sources");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    expect(await screen.findByText("partial read")).toBeInTheDocument();
    expect(screen.getByText("검사 미확인")).toBeInTheDocument();
    expect(screen.getByText("수집 실패")).toBeInTheDocument();
    expect(screen.queryByText("수집 완료")).not.toBeInTheDocument();
  });

  it("shows loading and retry without presenting an empty successful report", () => {
    const reload = vi.fn();
    const { rerender } = render(<SecurityWorkspace route="security" data={securityData()} loading />);
    expect(screen.queryByText("수집된 발견 항목 0건")).not.toBeInTheDocument();
    rerender(<SecurityWorkspace route="security" data={securityData()} error="network failure" reload={reload} />);
    expect(screen.getByText("보안 점검 결과를 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeInTheDocument();
    expect(screen.queryByText("수집된 발견 항목 0건")).not.toBeInTheDocument();
  });

  it("keeps the last successful report visible when a later read fails", () => {
    render(<SecurityWorkspace route="security" data={securityData(liveReport)} error="network failure" reload={vi.fn()} />);
    expect(screen.getByText("최신 결과를 다시 읽지 못했습니다. 마지막 성공 결과를 표시합니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /실제 높은 등급 신호/ })).toBeInTheDocument();
    expect(screen.getAllByText("미연동")).toHaveLength(4);
  });
  it("shares all five tabs in live mode without filling unsupported capabilities from fixtures", async () => {
    installFetch((call) => call.url.includes("/v1/security/vulnerabilities") ? json(200, {
      generatedAt: "2026-11-06T00:00:00Z", scanner: { status: "not_configured", message: "스캐너 미연결." }, scans: [], vulnerabilities: [],
      runningImages: [{ environment: "gke", namespace: "shop", workload: "Deployment/web", container: "app", image: "ghcr.io/x/app:v1", scanState: "unknown_digest" }],
      summary: { advisories: 0, images: 0, affectedContainers: 0, occurrences: 0, notScannedContainers: 1 },
    }) : call.url.includes("/v1/security/controls") ? json(404, { error: { code: "not_found", message: "no route" } }) : json(200, {
      generatedAt: "2026-11-06T00:00:00Z", sources: [], storageKeys: [], findings: [],
      summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
    }));
    window.history.replaceState(null, "", "/#security/vulnerabilities");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    expect(within(screen.getByRole("navigation", { name: "보안 메뉴" })).getAllByRole("link")).toHaveLength(5);
    expect(await screen.findByText("취약점 결과 없음")).toBeInTheDocument();
    expect(screen.getByText(/컨테이너 1개.*0건이 아닙니다/)).toBeInTheDocument();
    expect(screen.queryByText("데모 보안 데이터")).not.toBeInTheDocument();
    expect(screen.queryByText("CVE-2021-44228")).not.toBeInTheDocument();
  });

  it("shows live control evaluations with their asset and policy version", async () => {
    installFetch((call) => call.url.includes("/v1/security/controls") ? json(200, {
      generatedAt: "2026-11-06T00:00:00Z", policyVersion: "hopcharlie-security-policy/2026-11-06.1", coverage: [],
      controls: [{ id: "HC-IDN-03", title: "IAM 사용자 MFA", domain: "identity", check: "aws.user-mfa", source: "aws-iam", asset: "IAM user", condition: "c", mapping: "exact", failSeverity: "medium", limitations: [],
        references: [{ framework: "AWS Security Hub CSPM", version: "2026-11-06", id: "IAM.5", url: "https://docs.aws.amazon.com/x", relation: "exact", severity: "Medium" }],
        severityBasis: { type: "vendor", issuer: "AWS Security Hub CSPM", policy: "hopcharlie-security-policy/2026-11-06.1" } }],
      evaluations: [{ id: "e1", controlId: "HC-IDN-03", environment: "aws-account", source: "aws-iam", asset: "user/bob", result: "fail", reason: "no MFA", evaluatedAt: "2026-11-06T00:00:00Z", findingIds: [] }],
    }) : call.url.includes("/v1/security/vulnerabilities") ? json(503, { error: { code: "security_not_configured", message: "off" } }) : json(200, {
      generatedAt: "2026-11-06T00:00:00Z", sources: [], storageKeys: [], findings: [],
      summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
    }));
    window.history.replaceState(null, "", "/#security/controls");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    expect(await screen.findByRole("link", { name: "IAM 사용자 MFA" })).toBeInTheDocument();
    expect(screen.getByText("user/bob")).toBeInTheDocument();
    expect(screen.getByText(/정책 hopcharlie-security-policy\/2026-11-06.1/)).toBeInTheDocument();
    expect(screen.queryByText("데모 보안 데이터")).not.toBeInTheDocument();
  });

  it("shows each running container's scan and deployment-record state next to the vulnerabilities", async () => {
    const digest = "sha256:" + "1".repeat(64);
    installFetch((call) => call.url.includes("/v1/security/vulnerabilities") ? json(200, {
      generatedAt: "2026-11-06T00:00:00Z", scanner: { status: "connected" },
      scans: [{ id: "scan1", digest, status: "failed", scanner: { name: "grype", version: "0.121.0" }, finishedAt: "2026-11-06T00:00:00Z", message: "pull denied" }],
      vulnerabilities: [],
      runningImages: [{ environment: "eks", namespace: "shop", workload: "Deployment/shop-web", container: "web", app: "shop", image: "r/web:v1", digest, scanState: "scan_failed", scanId: "scan1",
        deployed: { state: "mismatch", deploymentId: "dep_1", reason: "the running digest differs" } }],
      summary: { advisories: 0, images: 0, affectedContainers: 0, occurrences: 0, notScannedContainers: 1, driftedContainers: 1 },
    }) : call.url.includes("/v1/security/controls") ? json(503, { error: { code: "security_not_configured", message: "off" } }) : json(200, {
      generatedAt: "2026-11-06T00:00:00Z", sources: [], storageKeys: [], findings: [],
      summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
    }));
    window.history.replaceState(null, "", "/#security/vulnerabilities");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    const table = await screen.findByRole("region", { name: "실행 컨테이너 스캔 상태" });
    expect(within(table).getByText("스캔 실패")).toBeInTheDocument();
    expect(within(table).getByText("pull denied")).toBeInTheDocument();
    expect(within(table).getByText("배포 기록과 다름")).toBeInTheDocument();
    expect(within(table).getByText(/배포 기록과 다름 1/)).toBeInTheDocument();
    expect(within(table).getByText(/취약점 0건이 아닙니다/)).toBeInTheDocument();
  });

  it("continues to read the existing API report at the live security root", async () => {
    const calls = installFetch(() => json(200, {
      generatedAt: "2026-11-06T00:00:00Z",
      sources: [], storageKeys: [],
      summary: { bySeverity: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
      findings: [{ id: "live-finding", environment: "eks", provider: "aws", source: "aws-iam", check: "aws.user-mfa", category: "identity", severity: "high", title: "API에서 받은 점검 항목", resource: "user/example", detail: "API 응답의 내용", recommendation: "MFA 확인", observedAt: "2026-11-06T00:00:00Z" }],
    }));
    window.history.replaceState(null, "", "/#security");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    expect(await screen.findByText("API에서 받은 점검 항목")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/v1/security"))).toBe(true);
    expect(screen.queryByText("데모 보안 데이터")).not.toBeInTheDocument();
    expect(screen.queryByText("CVE-2021-44228")).not.toBeInTheDocument();
  });
  it("labels the fixture clearly and exposes all five views", () => {
    open();
    expect(screen.getByText("데모 보안 데이터")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "보안 메뉴" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(5);
    for (const label of ["개요", "통제 점검", "취약점", "발견 항목", "수집 상태"]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/실제 인프라 점검 결과가 아닙니다/)).toBeInTheDocument();
  });

  it("keeps environment and application scope across tabs", async () => {
    const user = open();
    await user.selectOptions(screen.getByLabelText("보안 환경"), "gke");
    await user.selectOptions(screen.getByLabelText("보안 앱"), "moimroom");
    await user.click(within(screen.getByRole("navigation", { name: "보안 메뉴" })).getByRole("link", { name: "취약점" }));
    expect(await screen.findByRole("heading", { level: 2, name: "취약점" })).toBeInTheDocument();
    expect(screen.getByLabelText("보안 환경")).toHaveValue("gke");
    expect(screen.getByLabelText("보안 앱")).toHaveValue("moimroom");
    expect(screen.getByRole("region", { name: "취약점 목록" })).toHaveTextContent("CVE-2021-44228");
  });

  it("opens evidence details and returns to the filtered list", async () => {
    const user = open("#security/vulnerabilities");
    await user.selectOptions(screen.getByLabelText("보안 환경"), "gke");
    const list = screen.getByRole("region", { name: "취약점 목록" });
    await user.click(within(list).getByRole("link", { name: /CVE-2021-44228/ }));
    expect(await screen.findByRole("heading", { level: 2, name: /CVE-2021-44228/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "판정 근거" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "영향 자산" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "취약점 목록으로" }));
    expect(await screen.findByRole("region", { name: "취약점 목록" })).toBeInTheDocument();
    expect(screen.getByLabelText("보안 환경")).toHaveValue("gke");
  });

  it("explains an empty filter without declaring the environment safe", async () => {
    const user = open("#security/controls");
    await user.type(screen.getByLabelText("통제 검색"), "no-such-control-123");
    expect(screen.getByText("현재 필터에 해당하는 통제 점검이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("모든 통제 통과")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "검색 초기화" }));
    expect(screen.queryByText("현재 필터에 해당하는 통제 점검이 없습니다.")).not.toBeInTheDocument();
  });

  it("shows unverified execution separately from confirmed running workloads", () => {
    open("#security/vulnerabilities");
    const row = within(screen.getByRole("region", { name: "취약점 목록" })).getByRole("link", { name: "CVE-2024-6387" }).closest("tr")!;
    expect(within(row).getByText("실행 미확인 1개")).toBeInTheDocument();
    expect(within(row).getByText(/실행 확인 0개/)).toBeInTheDocument();
  });

  it("does not silently resolve a detail that is outside the selected scope", async () => {
    open("#security/vulnerabilities/not-present");
    expect(screen.getByText("현재 조회 범위에서 항목을 찾을 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "취약점 목록으로" })).toBeInTheDocument();
  });

  it("keeps the selected scope on browser route changes", async () => {
    const user = open();
    await user.selectOptions(screen.getByLabelText("보안 환경"), "k3s");
    act(() => {
      window.history.replaceState(null, "", "/#security/sources");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { level: 2, name: "수집 상태" })).toBeInTheDocument();
    expect(screen.getByLabelText("보안 환경")).toHaveValue("k3s");
  });
});
