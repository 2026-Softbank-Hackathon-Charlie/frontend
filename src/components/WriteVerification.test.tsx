import { render, screen, within } from "@testing-library/react";
import { measuredWriteMissing, WriteVerification, type WriteVerificationRecord } from "./WriteVerification";

describe("write verification evidence", () => {
  it("keeps missing collection separate from a measured zero", () => {
    const { rerender } = render(<WriteVerification />);
    expect(screen.getByText("쓰기 검증 정보 없음")).toBeInTheDocument();
    expect(screen.queryByText("0건")).not.toBeInTheDocument();
    rerender(<WriteVerification verification={{ status: "not_configured" }} />);
    expect(screen.getByText("쓰기 기록 미연결")).toBeInTheDocument();
    expect(screen.queryByText("0건")).not.toBeInTheDocument();
    rerender(<WriteVerification verification={{ status: "no_records", collectedRecords: 0, scope: "application_commits", coverage: "reservation_inserts" }} />);
    expect(screen.getByText("수집 기록 없음")).toBeInTheDocument();
    expect(screen.getByText("0건")).toBeInTheDocument();
    expect(screen.getByText(/누락 0건으로 판단할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/클라이언트의 성공 응답 수신을 증명하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/수정·삭제와 다른 종류의 쓰기는 포함하지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByText("쓰기 검증 완료")).not.toBeInTheDocument();
  });

  it("shows measured evidence and the latest input write timestamp without inventing a stream count", () => {
    const latestAt = "2026-11-07T06:00:00Z";
    render(<WriteVerification verification={{ status: "measured", stream: "shop-writes", collectedRecords: 7, checked: 7, missing: 0, latestAt, scope: "client_acknowledged" }} />);
    expect(screen.getByText("쓰기 검증 완료")).toBeInTheDocument();
    expect(screen.getByText("0건")).toBeInTheDocument();
    expect(screen.getAllByText("7건")).toHaveLength(2);
    expect(screen.getByText("shop-writes")).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("datetime", latestAt);
    expect(screen.getByText("입력의 마지막 쓰기 기록")).toBeInTheDocument();
    expect(screen.getByText(/플랫폼 도착 시각은 제공되지 않습니다/)).toBeInTheDocument();
  });

  it("does not present incomplete or failed verification as a zero result", () => {
    const { rerender } = render(<WriteVerification verification={{ status: "not_reached", collectedRecords: 5 }} legacyMissing={0} />);
    expect(screen.getByText("쓰기 검증 미실행")).toBeInTheDocument();
    expect(screen.queryByText("0건")).not.toBeInTheDocument();
    rerender(<WriteVerification verification={{ status: "failed", checked: 3, missing: 1, reason: "provider-secret-must-not-display" }} />);
    expect(screen.getByText("쓰기 검증 오류")).toBeInTheDocument();
    expect(screen.getByText("확인된 누락 (부분 결과)")).toBeInTheDocument();
    expect(screen.getByText("1건")).toBeInTheDocument();
    expect(screen.queryByText("provider-secret-must-not-display")).not.toBeInTheDocument();
  });

  it("accepts a positive checked count before displaying a measured zero", () => {
    for (const checked of [undefined, 0, -1, Number.NaN]) {
      const v: WriteVerificationRecord = { status: "measured", checked, missing: 0 };
      expect(measuredWriteMissing(v, 0)).toBeUndefined();
    }
    expect(measuredWriteMissing({ status: "measured", checked: 4, missing: 0 })).toBe(0);
    expect(measuredWriteMissing(undefined, 0)).toBe(0);
    expect(measuredWriteMissing(undefined, undefined)).toBeUndefined();
  });

  it("keeps legacy measured results visible without claiming collection details", () => {
    render(<WriteVerification legacyMissing={0} />);
    const panel = screen.getByRole("region", { name: "쓰기 기록 검증" });
    expect(within(panel).getByText("쓰기 검증 결과 있음")).toBeInTheDocument();
    expect(within(panel).getByText(/검사 기록 수와 수집 정보는 제공되지 않았습니다/)).toBeInTheDocument();
    expect(within(panel).queryByText("검증 입력 기록")).not.toBeInTheDocument();
  });
});
