import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chooseMode, initAuth, startSession } from "../data/live";
import { fakeSession, installFetch, json } from "../api/fakes";
import { useRoute } from "../router";
import { Security } from "./Security";
import { SecurityWorkspace } from "./SecurityWorkspace";
import { securityData } from "../data/security";
import type { SecurityReport } from "../api/types";
import { DEMO_SECURITY_DATA } from "../sim/securityWorkspace";

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
  return userEvent.setup({ delay: null });
}

describe("shared security workspace", () => {
  it("preserves original severity/category filtering and scopes storage keys to the environment", async () => {
    installFetch(() => json(200, liveReport));
    window.history.replaceState(null, "", "/#security/findings");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    const user = userEvent.setup({ delay: null });
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
    const noScan = screen.getAllByText("(검사 시각 미확인)")[0];
    const explanation = "이 출처는 자체 검사를 언제 했는지 알려주지 않습니다. 수집 시각은 플랫폼이 결과를 가져온 시각입니다.";
    expect(noScan.closest("small")).not.toHaveAttribute("title");
    const info = noScan.closest("small")!.querySelector(".sp-info") as HTMLElement;
    expect(info).toHaveAttribute("tabindex", "0");
    expect(info).not.toHaveAttribute("title");
    expect(info).toHaveAttribute("aria-label", "설명");
    const tip = document.getElementById(info.getAttribute("aria-describedby")!);
    expect(tip).toHaveAttribute("role", "tooltip");
    expect(tip).toHaveTextContent(explanation);
    expect(screen.getAllByText(/^수집 \d/)[0].tagName).toBe("B");
    expect(screen.getAllByText(/^수집 \d/)[0]).toHaveClass("sp-collected");
    expect(screen.queryByText("검사 미확인")).not.toBeInTheDocument();
    expect(screen.getByText("수집 실패")).toBeInTheDocument();
    expect(screen.queryByText("수집 완료")).not.toBeInTheDocument();
  });

  it("shows a scan time and no unknown-scan notice for a scanned source row", async () => {
    open("#security/sources");
    const row = (await screen.findAllByText("이미지 취약점 검사"))[0].closest("tr")!;
    expect(row.textContent).toMatch(/검사 \d/);
    expect(row.textContent).not.toContain("(검사 시각 미확인)");
  });

  it("labels an idle exploitation source as 조회 대상 없음", async () => {
    installFetch((call) => call.url.includes("/v1/security/vulnerabilities") ? json(200, {
      generatedAt: "2026-11-07T00:00:00Z", scanner: { status: "connected" }, scans: [], runningImages: [], vulnerabilities: [],
      summary: { advisories: 0, images: 0, affectedContainers: 0, occurrences: 0, notScannedContainers: 0 },
      exploitSources: [{ name: "first-epss", state: "idle", message: "no CVE" }],
    }) : call.url.includes("/v1/security/controls") ? json(503, { error: { code: "security_not_configured", message: "off" } }) : json(200, {
      generatedAt: "2026-11-07T00:00:00Z", sources: [], storageKeys: [], findings: [],
      summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
    }));
    window.history.replaceState(null, "", "/#security/sources");
    startSession(fakeSession());
    render(<RoutedSecurity />);
    const row = (await screen.findByText("FIRST EPSS")).closest("tr")!;
    expect(within(row).getByText("조회 대상 없음")).toBeInTheDocument();
  });

  it("keeps a GHSA-only row out of the KEV-unknown filter and says CVE 없음 once", async () => {
    const vuln = (id: string, advisory: string, exploitation: object) => ({
      id, scanId: "s1", digest: "sha256:a", advisory, aliases: [], fixedVersions: [], fixState: "unknown", severity: "high",
      severityBasis: { type: "vendor", issuer: "x", policy: "p1", reason: "y" }, cvss: [], urls: [], package: { name: "pkg-" + id, version: "1.0", type: "deb" }, exploitation,
    });
    installFetch((call) => call.url.includes("/v1/security/vulnerabilities") ? json(200, {
      generatedAt: "2026-11-07T00:00:00Z", scanner: { status: "connected" }, scans: [], runningImages: [{ environment: "eks", namespace: "shop", workload: "Deployment/web", container: "web", app: "shop", image: "r/web:v1", digest: "sha256:a", scanState: "scanned" }],
      summary: { advisories: 2, images: 1, affectedContainers: 0, occurrences: 2, notScannedContainers: 0 },
      vulnerabilities: [
        vuln("g1", "GHSA-aaaa-bbbb-cccc", { kev: { state: "no_cve" }, epss: { state: "no_cve" } }),
        vuln("c1", "CVE-2026-0001", { cve: "CVE-2026-0001", kev: { state: "unknown" }, epss: { state: "unknown" } }),
      ],
      exploitSources: [{ name: "cisa-kev", state: "idle", message: "no CVE" }],
    }) : call.url.includes("/v1/security/controls") ? json(503, { error: { code: "security_not_configured", message: "off" } }) : json(200, {
      generatedAt: "2026-11-07T00:00:00Z", sources: [], storageKeys: [], findings: [],
      summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} },
    }));
    window.history.replaceState(null, "", "/#security/vulnerabilities");
    startSession(fakeSession());
    const user = userEvent.setup({ delay: null });
    render(<RoutedSecurity />);
    const list = await screen.findByRole("region", { name: "취약점 목록" });
    const ghsaRow = (await within(list).findByRole("link", { name: "GHSA-aaaa-bbbb-cccc" })).closest("tr")!;
    expect(within(ghsaRow).getAllByText("CVE 없음")).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("악용 근거"), "unknown");
    expect(within(list).queryByRole("link", { name: "GHSA-aaaa-bbbb-cccc" })).not.toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "CVE-2026-0001" })).toBeInTheDocument();
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

describe("security exceptions (SEC-08)", () => {
  const NOW = new Date("2026-11-07T01:00:00Z"); // 11/07 10:00 KST
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  const exception = { id: "sx_1", reason: "보완 통제 적용", expiresAt: "2026-11-20T14:59:59Z", createdBy: "admin", createdAt: "2026-11-07T00:00:00Z" };
  const vuln = (id: string, advisory: string, extra: object = {}) => ({
    id, scanId: "s1", digest: "sha256:a", advisory, aliases: [], fixedVersions: [], fixState: "unknown", severity: "critical",
    severityBasis: { type: "vendor", issuer: "x", policy: "p1" }, cvss: [], urls: [], package: { name: "pkg-" + id, version: "1.0", type: "deb" }, ...extra,
  });
  const data = () => securityData({
    ...liveReport,
    findings: [
      { ...liveReport.findings[0], exception: { ...exception, targetType: "finding", targetId: "high-item" } },
      liveReport.findings[1],
    ],
  } as SecurityReport, { vulnerabilities: {
    generatedAt: "2026-11-07T00:00:00Z", scanner: { status: "connected" }, scans: [],
    runningImages: [{ environment: "eks", namespace: "shop", workload: "Deployment/web", container: "web", app: "shop", image: "r/web:v1", digest: "sha256:a", scanState: "scanned" }],
    summary: { advisories: 2, images: 1, affectedContainers: 1, occurrences: 2, notScannedContainers: 0 },
    vulnerabilities: [
      vuln("v-ex", "CVE-2026-0001", { exception: { ...exception, targetType: "vulnerability", targetId: "v-ex" } }),
      vuln("v-kev", "CVE-2026-0002", { severity: "low", exploitation: { cve: "CVE-2026-0002", kev: { state: "listed" }, epss: { state: "unknown" } } }),
    ],
  } as never });
  const user = () => userEvent.setup({ delay: null });

  it("hides excepted rows by default, shows them muted and last with 포함, and only them with 예외만", async () => {
    const u = user();
    render(<SecurityWorkspace route="security/vulnerabilities" data={data()} reload={vi.fn()} />);
    const list = screen.getByRole("region", { name: "취약점 목록" });
    const filter = screen.getByLabelText("예외");
    expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual(["제외", "포함", "예외만"]);
    expect(filter).toHaveValue("exclude");
    expect(within(list).queryByRole("link", { name: "CVE-2026-0001" })).not.toBeInTheDocument();
    await u.selectOptions(filter, "include");
    const links = within(list).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["CVE-2026-0002", "CVE-2026-0001"]);
    const row = within(list).getByRole("link", { name: "CVE-2026-0001" }).closest("tr")!;
    expect(row).toHaveClass("sp-excepted");
    expect(within(row).getByText("예외 · 11/20까지")).toBeInTheDocument();
    await u.selectOptions(filter, "only");
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual(["CVE-2026-0001"]);
  });

  it("filters and marks excepted findings", async () => {
    const u = user();
    render(<SecurityWorkspace route="security/findings" data={data()} reload={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "실제 높은 등급 신호" })).not.toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText("예외"), "only");
    const row = screen.getByRole("link", { name: "실제 높은 등급 신호" }).closest("tr")!;
    expect(row).toHaveClass("sp-excepted");
    expect(within(row).getByText("예외 · 11/20까지")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "실제 낮은 등급 신호" })).not.toBeInTheDocument();
  });

  it("registers an exception for a KEV vulnerability with at most 7 days and reloads", async () => {
    const calls = installFetch(() => json(201, { ...exception, targetType: "vulnerability", targetId: "v-kev" }));
    const reload = vi.fn();
    const u = user();
    render(<SecurityWorkspace route="security/vulnerabilities/v-kev" data={data()} reload={reload} />);
    await u.click(screen.getByRole("button", { name: "예외 등록" }));
    const date = screen.getByLabelText("만료일");
    expect(date).toHaveAttribute("max", "2026-11-14");
    expect(date).toHaveValue("2026-11-14");
    expect(screen.getByText("예외는 심각도를 바꾸지 않습니다. 만료일이 지나면 다시 미처리로 보입니다. KEV 등재 취약점은 최대 7일입니다.")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "등록" });
    expect(submit).toBeDisabled();
    await u.type(screen.getByLabelText("사유"), "   ");
    expect(submit).toBeDisabled();
    await u.type(screen.getByLabelText("사유"), "보완 통제 적용");
    fireEvent.change(date, { target: { value: "2026-11-10" } });
    await u.click(submit);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /v1/security/exceptions"]);
    expect(JSON.parse(calls[0].body!)).toEqual({ targetType: "vulnerability", targetId: "v-kev", reason: "보완 통제 적용", expiresAt: "2026-11-10T14:59:59.000Z" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows 30 days for a finding and cancels the form", async () => {
    const u = user();
    render(<SecurityWorkspace route="security/findings/low-item" data={data()} reload={vi.fn()} />);
    await u.click(screen.getByRole("button", { name: "예외 등록" }));
    expect(screen.getByLabelText("만료일")).toHaveAttribute("max", "2026-12-07");
    expect(screen.getByText("예외는 심각도를 바꾸지 않습니다. 만료일이 지나면 다시 미처리로 보입니다.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText("사유")).not.toBeInTheDocument();
  });

  it("revokes an exception and reloads", async () => {
    const calls = installFetch(() => json(200, { ...exception, targetType: "finding", targetId: "high-item", revokedAt: "2026-11-07T01:00:00Z", revokedBy: "admin" }));
    const reload = vi.fn();
    const u = user();
    render(<SecurityWorkspace route="security/findings/high-item" data={data()} reload={reload} />);
    expect(screen.getByText("예외 · 11/20까지 · admin")).toBeInTheDocument();
    expect(screen.getByText("보완 통제 적용")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "예외 해제" }));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["DELETE /v1/security/exceptions/sx_1"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message when a request is refused", async () => {
    installFetch(() => json(403, { error: { code: "forbidden", message: "operator 권한이 필요합니다." } }));
    const reload = vi.fn();
    const u = user();
    render(<SecurityWorkspace route="security/findings/high-item" data={data()} reload={reload} />);
    await u.click(screen.getByRole("button", { name: "예외 해제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("operator 권한이 필요합니다.");
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows no exception buttons in demo mode", () => {
    open("#security/vulnerabilities/" + DEMO_SECURITY_DATA.vulnerabilities![0].id);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "예외 등록" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "예외 해제" })).not.toBeInTheDocument();
  });
});
