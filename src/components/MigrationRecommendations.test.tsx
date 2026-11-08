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
  Object.assign(response.recommendations[0], { action: "move", estimatedMonthlySavingsUsd: 105.5 });
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText("입력 총비용 견적 기준 월 약 $105.5 차이")).toBeInTheDocument();
  expect(screen.queryByText(/공시 요금 기준 월 약/)).not.toBeInTheDocument();
});

it("leads with a deferred decision and missing app evidence, keeping a reference unit price in closed details", async () => {
  const response = report();
  Object.assign(response.recommendations[0], {
    app: "docker-doom", source: "gke", target: "eks", title: "docker-doom 이전 조건 비교",
    reasons: ["약정·스토리지·데이터 반출을 포함한 총비용 견적을 확인합니다.", "AWS m7i.large 참고 단가는 시간당 $0.1239이며 별도 비용은 포함하지 않습니다."],
    missing: ["comparable_total_cost_estimates", "capacity_preflight_required", "data_policy_preflight_required"],
  });
  const calls = installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByRole("region", { name: "AI 이전 판단" })).toBeInTheDocument();
  expect(screen.getByText("판단 보류")).toBeInTheDocument();
  const summary = screen.getByText(/총비용 견적 · 대상 자원 여유 · 데이터 반출 정책 미확인으로 판단을 보류합니다/);
  expect(summary.closest("details")).toBeNull();
  expect(screen.getByText(/AWS m7i.large 참고 단가는/).closest("details")).not.toHaveAttribute("open");
  expect(screen.queryByText("docker-doom 이전 조건 비교")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "docker-doom 이전 조건 확인" })).toHaveAttribute("href", "#migrate-app?app=docker-doom&source=gke&target=eks");
  expect(calls).toHaveLength(1);
});

it.each(["move", "stay"])("leads with the verified source/target comparison for %s", async action => {
  const response = report();
  Object.assign(response.recommendations[0], { action, missing: [], reasons: [action === "move" ? "같은 앱·운영시간의 입력 총비용은 현재 월 $100.00 → 대상 월 $40.00로, 월 $60.00 낮습니다." : "같은 앱·운영시간의 입력 총비용은 현재 월 $40.00 ≤ 대상 월 $100.00로, 비용상 이전 이점이 없습니다."] });
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText(/같은 앱·운영시간의 입력 총비용은/).closest("details")).toBeNull();
  if (action === "stay") expect(screen.queryByRole("link", { name: /moimroom-mig 이전/ })).not.toBeInTheDocument();
  else expect(screen.getByRole("link", { name: "moimroom-mig 이전하기" })).toHaveAttribute("href", "#migrate-app?app=moimroom-mig&source=eks&target=onprem");
});

it.each([
  ["destination_country_restricted", "대상 국가가 등록 데이터 보관 정책을 벗어납니다."],
  ["migration_in_progress", "진행 중인 이전이 끝날 때까지 다음 판단을 보류합니다."],
  ["current_environment_unobserved", "현재 실행 위치가 미확인이라 이전 출발지를 정할 수 없습니다."],
  ["target_environment_unregistered", "등록된 다른 환경이 없어 이전 대상을 비교할 수 없습니다."],
])("does not obscure the actual %s blocker behind a generic cost checklist", async (code, text) => {
  const response = report(); response.recommendations[0].missing = [code, "comparable_total_cost_estimates"];
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText(text).closest("details")).toBeNull();
});

it("keeps a model-deferred complete comparison distinct from a move and hides any non-move saving", async () => {
  const response = report(); Object.assign(response.recommendations[0], { missing: [], estimatedMonthlySavingsUsd: 50, reasons: ["같은 앱·운영시간의 입력 총비용은 현재 월 $100.00 → 대상 월 $40.00로, 월 $60.00 낮습니다."] });
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText("판단 보류")).toBeInTheDocument();
  expect(screen.getByText(/같은 앱·운영시간의 입력 총비용은/).closest("details")).toBeNull();
  expect(screen.queryByText(/월 약 \$50/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /이전하기/ })).not.toBeInTheDocument();
});

it("labels a deferred result without reasons or missing fields without inventing a comparison", async () => {
  const response = report(); Object.assign(response.recommendations[0], { missing: [], reasons: [] });
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText("AI가 이전 판단을 보류했습니다.")).toBeInTheDocument();
});

it("does not equate an empty AI selection with having no registered apps", async () => {
  const response = report(); response.recommendations = [];
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  expect(screen.getByText("지금 표시할 추천이 없습니다.")).toBeInTheDocument();
  expect(screen.queryByText("추천할 등록 앱이 없습니다.")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /이전/ })).not.toBeInTheDocument();
});

it("renders missing evidence as concise product labels and keeps unknown codes out of the UI", async () => {
  const response = report();
  const codes = ["comparable_total_cost_estimates", "capacity_preflight_required", "data_policy_preflight_required", "current_environment_unobserved", "target_environment_unregistered", "environment_readiness_unknown", "migration_in_progress", "destination_country_restricted", "future_internal_code", "toString"];
  response.recommendations[0].missing = codes;
  installFetch(() => json(200, response));
  render(<MigrationRecommendations />); await flush();
  const evidence = screen.getByText("판단 근거·참고 자료").closest("details")!;
  for (const label of ["총비용 견적", "대상 자원 여유", "데이터 반출 정책", "현재 실행 위치", "등록 이전 대상", "환경 준비 상태", "진행 중인 이전", "대상 국가 보관 제한", "추가 확인 필요"]) expect(evidence).toHaveTextContent(label);
  for (const code of codes) expect(evidence).not.toHaveTextContent(code);
  expect(evidence.textContent!.match(/추가 확인 필요/g)).toHaveLength(1);
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
