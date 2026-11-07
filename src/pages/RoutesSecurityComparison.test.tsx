import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeRun, fakeSession, installFetch, json } from "../api/fakes";
import { chooseMode, initAuth, startSession } from "../data/live";
import { SimProvider } from "../sim/store";
import { Routes } from "./Routes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  initAuth();
});

it("shows distinct policy outcomes on the same opt-in demo execution", async () => {
  chooseMode("demo");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<SimProvider intervalMs={0}><Routes /></SimProvider>);

  expect(screen.queryByRole("region", { name: "보안 비교" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "moimroom-mig 보안 비교 예시" }));

  expect(screen.getByRole("heading", { name: "moimroom-mig" })).toBeInTheDocument();
  const comparison = within(screen.getByRole("region", { name: "보안 비교" }));
  expect(comparison.getByText("HC-POL-02")).toBeInTheDocument();
  expect(comparison.getByText("시연 데이터")).toBeInTheDocument();
  expect(comparison.getByText("통과", { exact: true })).toBeInTheDocument();
  expect(comparison.getByText("실패", { exact: true })).toBeInTheDocument();
  expect(comparison.getByRole("status")).toHaveTextContent("새 위반");
  expect(comparison.getByText("securityContext.privileged: true")).toBeInTheDocument();

  const unknown = comparison.getByRole("button", { name: "통과 → 미확인" });
  await user.click(unknown);
  expect(unknown).toHaveAttribute("aria-pressed", "true");
  expect(comparison.getByText("미확인", { exact: true })).toBeInTheDocument();
  expect(comparison.getByText("대상 Pod 조회 권한이 없어 증거를 수집하지 못했습니다.")).toBeInTheDocument();
  expect(comparison.getByRole("status")).toHaveTextContent("확인 필요");
  expect(comparison.queryByText("실패", { exact: true })).not.toBeInTheDocument();
  expect(comparison.queryByText("securityContext.privileged: true")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps synthetic evidence out of a live execution with the same ID", async () => {
  startSession(fakeSession());
  const run = fakeRun({
    runId: "demo-moimroom-mig-security",
    status: "succeeded",
    source: { env: "eks", namespace: "moimroom-mig", cluster: "moimroom-mig-db" },
    target: { env: "gke", namespace: "moimroom-mig", cluster: "moimroom-mig-db" },
  });
  installFetch(({ url }) => new URL(url, window.location.origin).pathname === "/v1/migrations" ? json(200, { runs: [run] }) : json(404, {}));
  const user = userEvent.setup();
  render(<Routes />);

  expect(await screen.findByRole("heading", { name: "moimroom-mig" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /실행 상세$/ }));
  expect(screen.getByRole("region", { name: "전환 판단" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /보안 비교 예시/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "보안 비교" })).not.toBeInTheDocument();
});

const sourceAssessment = {
  assessedAt: "2026-11-08T04:05:06Z",
  policyVersion: "test-policy/2",
  result: "pass",
  workload: "moimroom-mig / Deployment/source-web",
  reason: "clear",
  evidence: "2 Pods checked",
} as const;

const failedTarget = {
  assessedAt: "2026-11-08T04:08:09Z",
  policyVersion: "test-policy/2",
  result: "fail",
  workload: "moimroom-mig / Deployment/target-web",
  reason: "privileged",
  evidence: "Pod target-web-p9, container app: securityContext.privileged=true",
} as const;

it.each([
  {
    scenario: "a new violation",
    target: failedTarget,
    label: "실패",
    verdict: "새 위반",
  },
  {
    scenario: "a forbidden target read",
    target: { ...failedTarget, result: "unknown", reason: "forbidden", evidence: "Kubernetes API · 403 Forbidden" },
    label: "미확인",
    verdict: "확인 필요",
  },
  {
    scenario: "a target assessment that was never recorded",
    target: undefined,
    label: "기록 없음",
    verdict: "확인 필요",
  },
  {
    scenario: "two observations made under different policy versions",
    target: { ...failedTarget, policyVersion: "test-policy/3" },
    label: "실패",
    verdict: "확인 필요",
  },
])("shows saved run evidence for $scenario", async ({ target, label, verdict }) => {
  startSession(fakeSession());
  const run = {
    ...fakeRun({
      status: target ? "succeeded" : "failed",
      source: { env: "eks", namespace: "moimroom-mig", cluster: "moimroom-mig-db" },
      target: { env: "gke", namespace: "moimroom-mig", cluster: "moimroom-mig-db" },
    }),
    securityComparison: { controlId: "HC-POL-02", source: sourceAssessment, target },
  };
  installFetch(({ url }) => new URL(url, window.location.origin).pathname === "/v1/migrations" ? json(200, { runs: [run] }) : json(404, {}));
  render(<Routes />);

  expect(await screen.findByRole("heading", { name: "moimroom-mig" })).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: /실행 상세$/ });
  expect(screen.queryByRole("region", { name: "보안 비교" })).not.toBeInTheDocument();
  await userEvent.click(toggle);
  const card = screen.getByRole("region", { name: "보안 비교" });
  const comparison = within(card);

  expect(comparison.getByText("HC-POL-02")).toBeInTheDocument();
  expect(comparison.getByText("통과", { exact: true })).toBeInTheDocument();
  expect(comparison.getByText(label, { exact: true })).toBeInTheDocument();
  expect(comparison.getByRole("status")).toHaveTextContent(verdict);
  expect(comparison.getByText(sourceAssessment.workload)).toBeInTheDocument();
  expect(comparison.getByText(sourceAssessment.evidence)).toBeInTheDocument();
  expect(comparison.getAllByText(sourceAssessment.policyVersion).length).toBeGreaterThan(0);
  expect(card.querySelector(`time[datetime="${sourceAssessment.assessedAt}"]`)).toBeInTheDocument();
  if (target) {
    expect(comparison.getByText(target.workload)).toBeInTheDocument();
    expect(comparison.getByText(target.evidence)).toBeInTheDocument();
    expect(comparison.getAllByText(target.policyVersion).length).toBeGreaterThan(0);
    expect(card.querySelector(`time[datetime="${target.assessedAt}"]`)).toBeInTheDocument();
  } else {
    expect(card.querySelectorAll("time")).toHaveLength(1);
  }
  expect(comparison.queryByText("시연 데이터")).not.toBeInTheDocument();
  expect(comparison.queryByRole("button", { name: "통과 → 미확인" })).not.toBeInTheDocument();
  await userEvent.click(toggle);
  expect(screen.queryByRole("region", { name: "보안 비교" })).not.toBeInTheDocument();
});
