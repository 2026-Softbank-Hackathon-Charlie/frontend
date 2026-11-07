import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeDeployment, installFetch, json } from "../api/fakes";
import type { App, AppObservation } from "../api/types";
import { AppsList } from "./deploy";
import { AppObservationDialog } from "./AppObservation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const obs = (p: Partial<AppObservation> = {}): AppObservation => ({
  since: ago(60),
  total: 1200,
  errors: 3,
  warnings: 12,
  buckets: [
    { time: ago(30), total: 600, errors: 1, warnings: 5 },
    { time: ago(25), total: 600, errors: 2, warnings: 7 },
  ],
  services: [{ name: "pxls-web", total: 900, errors: 3, warnings: 10, lastSeen: ago(1) }],
  patterns: [{ severity: "error", service: "pxls-web", text: "db error password=«가림» order # failed", count: 2, lastSeen: ago(2) }],
  ...p,
});

function route(o: () => Response) {
  return installFetch((c) => (c.url.startsWith("/v1/apps/pxls/observability") ? o() : c.url.startsWith("/v1/apps/pxls/deployments") ? json(200, { deployments: [fakeDeployment({ id: "d1", commit: "abcdef1234567", createdAt: ago(20) })] }) : json(200, {})));
}

it("reads the app's summary aloud, with the services, the repeated errors and what happened", async () => {
  const calls = route(() => json(200, obs()));
  render(<AppObservationDialog app="pxls" onClose={() => {}} />);
  const dlg = await screen.findByRole("dialog", { name: "pxls 관측" });
  expect(await within(dlg).findByText("최근 1시간 동안 오류가 3건 있었습니다")).toBeInTheDocument();
  expect(within(dlg).getByText("확인 필요")).toBeInTheDocument();
  expect(within(dlg).getByText("로그 1,200건 중 오류 3건, 경고 12건입니다.")).toBeInTheDocument();
  // the services table and the folded error pattern
  expect(within(dlg).getByRole("cell", { name: "pxls-web" })).toBeInTheDocument();
  expect(within(dlg).getByText("db error password=«가림» order # failed")).toBeInTheDocument();
  expect(within(dlg).getByText(/2번/)).toBeInTheDocument();
  // the timeline has the deployment next to what the logs mark
  const steps = within(within(dlg).getByRole("region", { name: "지금까지의 진행" })).getAllByRole("listitem");
  expect(steps.map((s) => s.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("배포 abcdef1"), expect.stringContaining("오류가 처음 나타났습니다 (1건)")]));
  // it asks the server for the hour, and shows no raw log line anywhere
  expect(calls.some((c) => c.url === "/v1/apps/pxls/observability?minutes=60")).toBe(true);
  expect(dlg.textContent).toContain("로그 원문은 보이지 않고");
});

it("changes the window and asks again", async () => {
  const calls = route(() => json(200, obs()));
  render(<AppObservationDialog app="pxls" onClose={() => {}} />);
  await screen.findByText("최근 1시간 동안 오류가 3건 있었습니다");
  await userEvent.click(screen.getByRole("button", { name: "최근 6시간" }));
  expect(await screen.findByText("최근 6시간 동안 오류가 3건 있었습니다")).toBeInTheDocument();
  expect(calls.some((c) => c.url === "/v1/apps/pxls/observability?minutes=360")).toBe(true);
});

it("does not call a silent app healthy", async () => {
  route(() => json(200, obs({ total: 0, errors: 0, warnings: 0, buckets: [], services: [], patterns: [] })));
  render(<AppObservationDialog app="pxls" onClose={() => {}} />);
  expect(await screen.findByText("최근 1시간 동안 이 앱의 로그가 없습니다")).toBeInTheDocument();
  expect(screen.getByText("로그 없음")).toBeInTheDocument();
  expect(screen.queryByText("정상")).not.toBeInTheDocument();
});

it("says plainly when the log store is not connected or cannot be read", async () => {
  route(() => json(503, { error: { code: "observability_not_configured", message: "x" } }));
  const { unmount } = render(<AppObservationDialog app="pxls" onClose={() => {}} />);
  expect(await screen.findByText("이 서버는 로그 저장소에 연결되어 있지 않습니다.")).toBeInTheDocument();
  unmount();
  route(() => json(502, { error: { code: "observability_unavailable", message: "x" } }));
  render(<AppObservationDialog app="pxls" onClose={() => {}} />);
  expect(await screen.findByText(/로그 저장소\(HyperDX\)를 읽지 못했습니다/)).toBeInTheDocument();
});

it("closes with the button, Escape and a click outside", async () => {
  route(() => json(200, obs()));
  const onClose = vi.fn();
  render(<AppObservationDialog app="pxls" onClose={onClose} />);
  await screen.findByText("최근 1시간 동안 오류가 3건 있었습니다");
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  await userEvent.keyboard("{Escape}");
  await userEvent.click(document.querySelector(".obs-overlay")!);
  expect(onClose).toHaveBeenCalledTimes(3);
});

describe("the 관측 button of the apps list", () => {
  const app = { name: "pxls", environments: [{ name: "eks" }] } as unknown as App;

  it("is there in live mode and opens the app's observation", async () => {
    const open = vi.fn();
    render(<AppsList apps={[app]} now={Date.now()} full onObserve={open} />);
    await userEvent.click(screen.getByRole("button", { name: "pxls 관측" }));
    expect(open).toHaveBeenCalledWith("pxls");
  });

  it("is not there without a handler (demo mode has no logs) or in the short list", () => {
    const { unmount } = render(<AppsList apps={[app]} now={Date.now()} full />);
    expect(screen.queryByRole("button", { name: "pxls 관측" })).not.toBeInTheDocument();
    unmount();
    render(<AppsList apps={[app]} now={Date.now()} full={false} onObserve={() => {}} />);
    expect(screen.queryByRole("button", { name: "pxls 관측" })).not.toBeInTheDocument();
  });
});
