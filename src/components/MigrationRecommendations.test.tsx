import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fakeSession, installFetch, json } from "../api/fakes";
import { initAuth, startSession } from "../data/live";
import { MigrationRecommendations } from "./MigrationRecommendations";

const start = Date.parse("2026-11-08T03:00:00Z");
function report(status = "ready") {
  return { generatedAt: new Date(start).toISOString(), nextRefreshAt: new Date(start + 900000).toISOString(), nextCheckAt: status === "generating" ? new Date(start + 5000).toISOString() : null,
    ttlSeconds: 900, cacheStatus: "fresh", status, ai: { status, model: "sandbox-model", sessionId: "ags_one" }, recommendations: status === "ready" ? [{ id: "rec-one", app: "moimroom-mig", source: "eks", target: "onprem", action: "insufficient", title: "온프레미스 이전 조건 확인", reasons: ["데이터 반출 조건을 확인하세요"], missing: ["온프레미스 운영비"], sources: [{ title: "AWS 공시 요금", url: "https://aws.amazon.com/ec2/pricing/on-demand/", observedAt: null }], estimatedMonthlySavingsUsd: null }] : [] };
}
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); startSession(fakeSession()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); initAuth(); });

it("shows concise evidence and the exact app/target link while leaving unknown savings unpriced", async () => {
  const calls = installFetch(() => json(200, report()));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText("데이터 반출 조건을 확인하세요")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "moimroom-mig 이전 조건 확인" })).toHaveAttribute("href", "#migrate-app?app=moimroom-mig&source=eks&target=onprem");
  expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "AWS 공시 요금 ↗" })).toHaveAttribute("rel", "noreferrer");
  expect(screen.getByRole("button", { name: "추천 새로고침" })).toBeDisabled();
  expect(calls).toHaveLength(1);
});

it("labels measured savings as an entered total-cost estimate", async () => {
  const response = report();
  Object.assign(response.recommendations[0], { estimatedMonthlySavingsUsd: 105.5 });
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText("입력 총비용 견적 기준 월 약 $105.5 차이")).toBeInTheDocument();
  expect(screen.queryByText(/공시 요금 기준 월 약/)).not.toBeInTheDocument();
});

it("reuses the same session cache on reentry and unlocks refresh without polling", async () => {
  const calls = installFetch(() => json(200, report()));
  const first = render(<MigrationRecommendations />); await flush(); first.unmount();
  render(<MigrationRecommendations />); await flush();
  expect(calls).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(900001); });
  expect(calls).toHaveLength(1);
  expect(screen.getByRole("button", { name: "추천 새로고침" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "moimroom-mig 이전 조건 확인" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "추천 새로고침" })); await flush();
  expect(calls).toHaveLength(2);
});

it("checks a generating result only on demand and never starts another job from the status endpoint", async () => {
  const calls = installFetch(c => json(200, c.url.endsWith("/status") ? report() : report("generating")));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText("AI가 이전 조건을 비교하고 있습니다.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /이전 조건 확인/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "추천 결과 확인" })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
  expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "추천 결과 확인" })); await flush();
  expect(calls.map(c => c.url)).toEqual(["/v1/migration-recommendations", "/v1/migration-recommendations/status"]);
});

it("aborts the last subscriber's pending request on leaving the screen", async () => {
  const calls = installFetch(() => new Promise<Response>(() => {}));
  const view = render(<MigrationRecommendations />); await flush(); view.unmount(); await flush();
  expect(calls).toHaveLength(1);
  expect(calls[0].signal?.aborted).toBe(true);
});

it("keeps cached evidence read-only when a refresh fails and backs off retries", async () => {
  let failed = false;
  const calls = installFetch(() => failed ? json(503, { error: { code: "unavailable", message: "unavailable" } }) : json(200, report()));
  render(<MigrationRecommendations />); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(900001); }); failed = true;
  fireEvent.click(screen.getByRole("button", { name: "추천 새로고침" })); await flush();
  expect(screen.getByText("마지막 수신 결과")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /이전 조건 확인/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "추천 새로고침" })).toBeDisabled();
  expect(calls).toHaveLength(2);
});

it("coalesces concurrent mounts and rapid manual refresh clicks", async () => {
  const calls = installFetch(() => json(200, report()));
  render(<><MigrationRecommendations /><MigrationRecommendations /></>); await flush();
  expect(calls).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(900001); });
  for (const button of screen.getAllByRole("button", { name: "추천 새로고침" })) { fireEvent.click(button); fireEvent.click(button); }
  await flush();
  expect(calls).toHaveLength(2);
});

it("never reuses another signed-in session's cached evidence", async () => {
  const calls = installFetch(() => json(200, report()));
  render(<MigrationRecommendations />); await flush();
  await act(async () => { startSession(fakeSession({ token: "another-session" })); }); await flush();
  expect(calls).toHaveLength(2);
});

it.each(["not_configured", "unavailable"])("shows %s without fabricated results or migration actions", async status => {
  const calls = installFetch(() => json(200, report(status)));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByRole("status")).toHaveTextContent(status === "not_configured" ? "아직 연결되지 않았습니다" : "완료하지 못했습니다");
  expect(screen.queryByRole("link", { name: /이전/ })).not.toBeInTheDocument();
  expect(calls).toHaveLength(1);
});

it("tolerates an API rollout that has not reached this endpoint and does not retry on a timer", async () => {
  const calls = installFetch(() => json(404, { error: { code: "not_found", message: "not found" } }));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByRole("status")).toHaveTextContent("추천을 읽지 못했습니다");
  expect(screen.queryByRole("link", { name: /이전/ })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60001); });
  expect(calls).toHaveLength(1);
  expect(screen.getByRole("button", { name: "추천 새로고침" })).toBeEnabled();
});
