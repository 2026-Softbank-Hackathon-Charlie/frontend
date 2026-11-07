import { render, screen, within } from "@testing-library/react";
import { fakeRun } from "../api/fakes";
import type { RunResult } from "../api/types";
import type { WriteVerificationRecord } from "../components/WriteVerification";
import { MigrationResults } from "./Routes";

const result = (writeVerification?: WriteVerificationRecord, rest: RunResult = {}): RunResult & { writeVerification?: WriteVerificationRecord } => ({ ...rest, writeVerification });

it("explains the absent write measurement without replacing it with zero", () => {
  render(<MigrationResults runs={[fakeRun({ status: "succeeded", result: result({ status: "not_configured", reason: "written_records_not_configured" }, { verified: true, missingRows: 0 }) })]} />);
  const panel = screen.getByRole("region", { name: "쓰기 기록 검증" });
  expect(within(panel).getByText("쓰기 기록 미연결")).toBeInTheDocument();
  const rows = screen.getAllByText("쓰기 누락");
  expect(rows).toHaveLength(2);
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
