import { fireEvent, render, screen, within } from "@testing-library/react";
import { fakeRun } from "../api/fakes";
import type { RunResult } from "../api/types";
import type { WriteVerificationRecord } from "../components/WriteVerification";
import { MigrationResults } from "./Routes";

const result = (writeVerification?: WriteVerificationRecord, rest: RunResult = {}): RunResult & { writeVerification?: WriteVerificationRecord } => ({ ...rest, writeVerification });

it("explains the absent write measurement without replacing it with zero", () => {
  render(<MigrationResults runs={[fakeRun({ status: "succeeded", result: result({ status: "not_configured", reason: "written_records_not_configured" }, { verified: true, missingRows: 0 }) })]} />);
  const panel = screen.getByRole("region", { name: "쓰기 기록 검증" });
  expect(within(panel).getByText("쓰기 기록 미연결")).toBeInTheDocument();
  expect(within(panel).getByText(/쓰기 누락을 측정하지 않았습니다/)).toBeInTheDocument();
  expect(within(panel).queryByText("미측정")).not.toBeInTheDocument();
  const rows = screen.getAllByText("쓰기 누락");
  expect(rows).toHaveLength(1);
  for (const label of rows) expect(label.nextElementSibling).toHaveTextContent("미측정");
  expect(within(panel).queryByText("쓰기 검증 완료")).not.toBeInTheDocument();
});

it("updates the same run from unverified collection to measured evidence", () => {
  const run = fakeRun({ status: "succeeded", result: result({ status: "not_reached", collectedRecords: 4, scope: "application_commits", coverage: "reservation_inserts" }) });
  const { rerender } = render(<MigrationResults runs={[run]} />);
  expect(screen.getByText("쓰기 검증 미실행")).toBeInTheDocument();
  rerender(<MigrationResults runs={[{ ...run, result: result({ status: "measured", collectedRecords: 4, checked: 4, missing: 0, scope: "application_commits", coverage: "reservation_inserts", latestAt: "2026-11-07T06:00:00Z" }, { missingWrites: 0 }) }]} />);
  expect(screen.getByText("쓰기 검증 완료")).toBeInTheDocument();
  expect(screen.getAllByRole("region", { name: "쓰기 기록 검증" })).toHaveLength(1);
  expect(screen.getAllByText("0건")).toHaveLength(2);
  expect(screen.getByText(/검사 범위는 예약 생성 기록/)).toBeInTheDocument();
});

it("retains old measured results and does not show partial failures as success", () => {
  const { rerender } = render(<MigrationResults runs={[fakeRun({ status: "succeeded", result: { missingWrites: 0 } })]} />);
  expect(screen.getByText("쓰기 검증 결과 있음")).toBeInTheDocument();
  rerender(<MigrationResults runs={[fakeRun({ status: "failed", result: result({ status: "failed", checked: 2, missing: 0, collectedRecords: 6, reason: "written_verification_incomplete" }, { missingWrites: 0 }) })]} />);
  expect(screen.getByText("쓰기 검증 오류")).toBeInTheDocument();
  expect(screen.getByText("쓰기 누락").nextElementSibling).toHaveTextContent("미측정");
  expect(screen.getByText("확인된 누락 (부분 결과)").nextElementSibling).toHaveTextContent("0건");
  expect(screen.queryByText("쓰기 검증 완료")).not.toBeInTheDocument();
});

it("shows confirmed cutover evidence at the top of a successful run's details", () => {
  const base = fakeRun();
  const run = fakeRun({
    status: "succeeded",
    target: { ...base.target, env: "gke" },
    engine: { ...base.engine, trafficOnTarget: true, writesHeld: false },
    result: result({ status: "not_configured" }, { requests: 529, failedRequests: 0, downtimeMillis: 20733, missingRows: 0, missingFiles: 0 }),
  });
  render(<MigrationResults runs={[run]} />);
  fireEvent.click(screen.getByText("실행 상세", { selector: "summary" }));
  const panel = within(screen.getByRole("region", { name: "전환 판단" }));
  expect(panel.getByText("GCP GKE 쓰기 전환 완료")).toBeInTheDocument();
  expect(panel.getByText("0 / 529")).toBeInTheDocument();
  expect(panel.getByText("20.7초")).toBeInTheDocument();
  expect(panel.getByText("미설정")).toBeInTheDocument();
  expect(panel.queryByText("재개·원복 전 확인")).not.toBeInTheDocument();
});

it("shows the recovery checklist and suppresses invalid counters in a halted switchover", () => {
  const base = fakeRun();
  const reason = "waiting for demotion token: context deadline exceeded";
  const run = fakeRun({
    status: "halted",
    statusReason: reason,
    engine: { ...base.engine, writesHeld: true, sourceDemoted: true, promoteRequested: true, trafficOnTarget: false,
      failureStep: "switchover", steps: { fence: { status: "succeeded" }, switchover: { status: "failed" }, cutover: { status: "pending" } } },
    result: { requests: -721, failedRequests: 0 },
  });
  render(<MigrationResults runs={[run]} />);
  fireEvent.click(screen.getByText("실행 상세", { selector: "summary" }));
  const panel = within(screen.getByRole("region", { name: "전환 판단" }));
  expect(panel.getByText("DB 역할 전환에서 중단")).toBeInTheDocument();
  expect(panel.getByText(reason)).toBeInTheDocument();
  expect(panel.getByText("쓰기 보류 유지")).toBeInTheDocument();
  expect(panel.getByText("실시간 확인 필요")).toBeInTheDocument();
  expect(panel.getByText("재개·원복 전 확인")).toBeInTheDocument();
  expect(panel.getByText(/양쪽 CNPG/)).toBeInTheDocument();
  expect(panel.getByText(/Gateway 쓰기 대상/)).toBeInTheDocument();
  expect(panel.getByText(/WAL 재생 위치/)).toBeInTheDocument();
  expect(screen.queryByText(/-721|0건/)).not.toBeInTheDocument();
});

it("keeps a post-cutover observation violation visible on a succeeded run", () => {
  const base = fakeRun();
  render(<MigrationResults runs={[fakeRun({
    status: "succeeded",
    engine: { ...base.engine, trafficOnTarget: true, writesHeld: false },
    observe: { options: {}, steps: [], passed: false },
  })]} />);
  fireEvent.click(screen.getByText("실행 상세", { selector: "summary" }));
  const panel = within(screen.getByRole("region", { name: "전환 판단" }));
  expect(panel.getByText("전환 후 관찰 위반")).toBeInTheDocument();
  expect(panel.queryByText(/쓰기 전환 완료/)).not.toBeInTheDocument();
});
