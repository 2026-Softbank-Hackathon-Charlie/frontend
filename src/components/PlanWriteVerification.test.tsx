import { render, screen } from "@testing-library/react";
import { PlanWriteVerification } from "./WriteVerification";

it("warns before approval when this plan would leave write loss unmeasured", () => {
  render(<PlanWriteVerification configured={false} />);
  expect(screen.getByRole("region", { name: "실행 전 쓰기 검증" })).toBeInTheDocument();
  expect(screen.getByText("쓰기 기록 미연결")).toBeInTheDocument();
  expect(screen.getByText(/이대로 시작하면 쓰기 누락은 미측정/)).toBeInTheDocument();
  expect(screen.getByText(/기록을 받은 뒤 새 Plan을 작성/)).toBeInTheDocument();
  expect(screen.queryByText("0건")).not.toBeInTheDocument();
});

it("keeps an older server's unknown configuration separate from false", () => {
  render(<PlanWriteVerification />);
  expect(screen.getByText("쓰기 검증 설정 미확인")).toBeInTheDocument();
  expect(screen.queryByText("쓰기 기록 미연결")).not.toBeInTheDocument();
});

it("does not claim measured zero just because a record input is configured", () => {
  render(<PlanWriteVerification configured />);
  expect(screen.getByText("쓰기 기록 연결됨")).toBeInTheDocument();
  expect(screen.getByText(/실제 검사 기록 수와 누락 결과는 실행 후/)).toBeInTheDocument();
  expect(screen.queryByText("쓰기 검증 완료")).not.toBeInTheDocument();
  expect(screen.queryByText("0건")).not.toBeInTheDocument();
});
