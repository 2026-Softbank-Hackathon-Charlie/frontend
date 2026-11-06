import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chooseMode, initAuth, startSession } from "../data/live";
import { fakeSession, installFetch, json } from "../api/fakes";
import type { SecurityOCSFExport } from "../api/types";
import { useRoute } from "../router";
import { Security } from "../pages/Security";
import { ocsfFileName, statusBreakdown } from "./SecurityOCSF";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  initAuth();
});

const ev = (cls: number, uid: string, title: string | undefined, status: string, extra: Record<string, unknown> = {}) =>
  ({ class_uid: cls, status, severity: "High", time: 1793000000000, finding_info: title ? { uid, title } : { uid }, ...extra });

const exportBody: SecurityOCSFExport = {
  ocsfVersion: "1.9.0",
  generatedAt: "2026-11-06T15:05:00Z",
  findings: [ev(2004, "f-1", "실시간 탐지 신호", "New"), ev(2003, "f-2", "설정 점검 실패", "New")],
  vulnerabilities: [
    ev(2002, "v-1", "CVE-2021-44228 · log4j-core", "Suppressed", { status_detail: "배치 이미지, 교체 예정" }),
    ev(2002, "v-2", "CVE-2024-6387 · openssh", "New"),
    ev(2002, "v-3", undefined, "New"),
  ],
  controls: [
    ev(2003, "c-1", "기본 암호화", "New", { compliance: { control: "AWS EC2.7", status_id: 1, status: "Pass" } }),
    ev(2003, "c-2", "CloudTrail", "New", { compliance: { control: "AWS CloudTrail.1", status_id: 3, status: "Fail" } }),
    ev(2003, "c-3", "키 권한", "New", { compliance: { control: "KEY-01", status_id: 3, status: "Fail" } }),
  ],
};

const emptyReport = { generatedAt: "2026-11-06T15:05:00Z", summary: { bySeverity: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byEnvironment: {} }, sources: [], findings: [] };

function RoutedSecurity() {
  return <Security route={useRoute()} />;
}

function live(ocsf: () => Response) {
  const calls = installFetch((c) => c.url.startsWith("/v1/security/ocsf") ? ocsf() : c.url === "/v1/security" ? json(200, emptyReport) : json(503, { error: { code: "security_not_configured", message: "off" } }));
  window.history.replaceState(null, "", "/#security/ocsf");
  startSession(fakeSession());
  render(<RoutedSecurity />);
  return { calls, user: userEvent.setup({ delay: null }) };
}

const summaryRow = (label: string) => screen.getByRole("cell", { name: label }).closest("tr") as HTMLElement;

describe("OCSF 내보내기 tab (SEC-09)", () => {
  it("is the last security tab and routes to #security/ocsf", async () => {
    window.history.replaceState(null, "", "/#security");
    chooseMode("demo");
    render(<RoutedSecurity />);
    const tabs = within(screen.getByRole("navigation", { name: "보안 메뉴" })).getAllByRole("link");
    expect(tabs.at(-1)).toHaveTextContent("OCSF 내보내기");
    expect(tabs.at(-1)).toHaveAttribute("href", "#security/ocsf");
    await userEvent.setup({ delay: null }).click(tabs.at(-1)!);
    expect(await screen.findByRole("heading", { name: "OCSF 내보내기" })).toBeInTheDocument();
  });

  it("summarizes counts and statuses of the live export and defaults to the first vulnerability", async () => {
    const { calls } = live(() => json(200, exportBody));
    expect(await screen.findByText("OCSF 1.9.0 · 생성 11/07 00:05 KST")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/v1/security/ocsf")).toBe(true);
    expect(within(summaryRow("발견 항목")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["발견 항목", "2004 / 2003", "2", "New 2"]);
    expect(within(summaryRow("취약점")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["취약점", "2002", "3", "New 2 · Suppressed 1"]);
    expect(within(summaryRow("통제 평가")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["통제 평가", "2003", "3", "Pass 1 · Fail 2"]);
    expect(screen.getByLabelText("종류")).toHaveValue("vulnerabilities");
    expect(JSON.parse(screen.getByLabelText("OCSF 이벤트 JSON").textContent!)).toEqual(exportBody.vulnerabilities[0]);
  });

  it("shows the JSON of the selected event, labelled by title or uid", async () => {
    const { user } = live(() => json(200, exportBody));
    const events = await screen.findByLabelText("이벤트");
    expect(within(events).getAllByRole("option").map((o) => o.textContent)).toEqual(["CVE-2021-44228 · log4j-core", "CVE-2024-6387 · openssh", "v-3"]);
    await user.selectOptions(events, "CVE-2024-6387 · openssh");
    expect(JSON.parse(screen.getByLabelText("OCSF 이벤트 JSON").textContent!)).toEqual(exportBody.vulnerabilities[1]);
    await user.selectOptions(screen.getByLabelText("종류"), "controls");
    expect(JSON.parse(screen.getByLabelText("OCSF 이벤트 JSON").textContent!)).toEqual(exportBody.controls[0]);
    await user.selectOptions(screen.getByLabelText("이벤트"), "CloudTrail");
    expect(screen.getByLabelText("OCSF 이벤트 JSON")).toHaveTextContent('"status": "Fail"');
  });

  it("downloads the whole response as a JSON blob named by the KST generation time", async () => {
    const { user } = live(() => json(200, exportBody));
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => { blobs.push(b); return "blob:ocsf"; });
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    await user.click(await screen.findByRole("button", { name: "JSON 내려받기" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(blobs[0].type).toBe("application/json");
    expect(JSON.parse(await blobs[0].text())).toEqual(exportBody);
    expect(name).toBe("hopcharlie-ocsf-20261107-0005.json");
    expect(revoke).toHaveBeenCalledWith("blob:ocsf");
  });

  it("says a kind without events has nothing to export", async () => {
    const { user } = live(() => json(200, { ...exportBody, vulnerabilities: [], controls: [] }));
    expect(await screen.findByLabelText("종류")).toHaveValue("findings");
    expect(within(summaryRow("통제 평가")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["통제 평가", "2003", "0", "—"]);
    await user.selectOptions(screen.getByLabelText("종류"), "controls");
    expect(screen.getByText("내보낼 이벤트가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("OCSF 이벤트 JSON")).not.toBeInTheDocument();
    expect(screen.getByLabelText("이벤트")).toBeDisabled();
  });

  it("shows the server's message as an alert when the export fails", async () => {
    live(() => json(503, { error: { code: "security_not_configured", message: "보안 수집기가 설정되지 않았습니다" } }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("OCSF 내보내기를 불러오지 못했습니다.");
    expect(alert).toHaveTextContent("보안 수집기가 설정되지 않았습니다");
    expect(screen.queryByRole("button", { name: "JSON 내려받기" })).not.toBeInTheDocument();
  });

  it("renders the same screen from demo data in demo mode without calling the API", async () => {
    const calls = installFetch(() => json(500, {}));
    window.history.replaceState(null, "", "/#security/ocsf");
    chooseMode("demo");
    render(<RoutedSecurity />);
    expect(screen.getByText(/^OCSF 1\.9\.0 · 생성 \d\d\/\d\d \d\d:\d\d KST$/)).toBeInTheDocument();
    expect(within(summaryRow("발견 항목")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["발견 항목", "2004 / 2003", "2", "New 2"]);
    expect(within(summaryRow("취약점")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["취약점", "2002", "2", "New 1 · Suppressed 1"]);
    expect(within(summaryRow("통제 평가")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["통제 평가", "2003", "3", "Pass 1 · Fail 1 · Unknown 1"]);
    expect(screen.getByLabelText("OCSF 이벤트 JSON")).toHaveTextContent('"is_exploit_available": true');
    expect(calls).toEqual([]);
  });
});

describe("OCSF helpers", () => {
  it("orders statuses as the spec does and stamps the file name in KST", () => {
    expect(statusBreakdown("vulnerabilities", [{ status: "Suppressed" }, { status: "New" }, {}])).toBe("New 1 · Suppressed 1 · Unknown 1");
    expect(statusBreakdown("controls", [{ compliance: { status: "Unknown" } }, { compliance: { status: "Pass" } }])).toBe("Pass 1 · Unknown 1");
    expect(ocsfFileName("2026-12-31T15:30:00Z")).toBe("hopcharlie-ocsf-20270101-0030.json");
  });
});
