import { render, screen } from "@testing-library/react";
import { at, fakeRun } from "../api/fakes";
import type { Run, RunEvent } from "../api/types";
import ja from "../i18n/ja.json";
import { makeTranslator } from "../i18n/translate";
import { CanaryBox, groupsOf, heroText, VerifyBox } from "./Migrate";

const ev = (seq: number, kind: string, p: Partial<RunEvent> = {}): RunEvent => ({ seq, time: at(seq), runId: "run_1", kind, ...p });
const status = (seq: number, s: string, phase: string) => ev(seq, "status_changed", { data: { status: s, phase, reason: "" } });
const ended = (p: Partial<Run>, engine: Partial<Run["engine"]> = {}) => fakeRun({ phase: "done", endedAt: at(13), ...p, engine: { ...fakeRun().engine, ...engine } });

// Up to the switch: sync, the canary, the wait for /switch and its approval.
const synced = [
  status(1, "running", "sync"),
  ...["precheck", "prepare", "presync", "delta"].map((step, i) => ev(2 + i, "step_succeeded", { step })),
  status(6, "running", "canary"),
  status(7, "awaiting_switch", "awaiting_switch"),
  status(8, "running", "cutover"),
];

describe("migration progress groups", () => {
  it("shows an unrecorded canary verdict neutrally while waiting for switch approval", () => {
    const r = fakeRun({
      status: "awaiting_switch", phase: "awaiting_switch",
      canary: { options: { weights: [10] }, passed: true, steps: [{ weight: 10, startedAt: at(6), endedAt: at(7) }] },
    });
    expect(groupsOf(r, synced.slice(0, -1))[1].items).toEqual([{ label: "10% 게이트 판정 기록 부족", st: "neu" }]);
  });

  it("puts the stop of a halted run where it halted, though the platform ends every run in phase done", () => {
    const events = [
      ...synced,
      ev(9, "step_succeeded", { step: "fence" }),
      ev(10, "step_started", { step: "switchover" }),
      ev(11, "step_failed", { step: "switchover" }),
      status(12, "halted", "cutover"),
      status(13, "halted", "done"),
    ];
    const g = groupsOf(ended({ status: "halted" }, { outcome: "halted", promoteRequested: true, failureStep: "switchover" }), events);
    expect(g.map((x) => x.st)).toEqual(["done", "done", "bad", "todo"]);
    expect(g[2].items.map((x) => x.st)).toEqual(["ok", "bad", "wait", "wait"]);
    // the stopped part ends when the run did instead of staying open
    expect(g[2].range).toBe("00:08 ~ 00:13");
  });

  it("takes the stop from the engine's failure step when there are no events", () => {
    const g = groupsOf(ended({ status: "failed" }, { outcome: "failed", failureStep: "presync" }), []);
    expect(g.map((x) => x.st)).toEqual(["bad", "todo", "todo", "todo"]);
  });

  it("does not show a succeeded run as all good when its observation broke the gate", () => {
    const events = [
      ...synced,
      ...["fence", "switchover", "cutover", "verify", "finalize"].map((step, i) => ev(9 + i, "step_succeeded", { step })),
      status(12, "running", "observe"),
      status(13, "succeeded", "done"),
    ];
    const observe = { options: { autoRollback: true }, steps: [], passed: false, violation: "error rate 3.10% > 1.00%" };
    const g = groupsOf(ended({ status: "succeeded", observe }, { outcome: "succeeded", promoteRequested: true, trafficOnTarget: true }), events);
    expect(g.map((x) => x.st)).toEqual(["done", "done", "done", "bad"]);
    expect(g[3].items.at(-1)).toMatchObject({ label: "전환 후 관찰 위반", st: "bad" });
  });

  it("gives an observation that ended without a verdict no check mark", () => {
    const events = [...synced, ...["fence", "switchover", "cutover", "verify", "finalize"].map((step, i) => ev(9 + i, "step_succeeded", { step })), status(12, "running", "observe")];
    const observe = { options: {}, steps: [], stoppedReason: "the platform is shutting down" };
    const g = groupsOf(ended({ status: "succeeded", observe }, { outcome: "succeeded" }), events);
    expect(g[3].items.at(-1)).toMatchObject({ label: "전환 후 관찰 (판정 없이 끝남)", st: "neu" });
  });

  it("shows start-target without a check mark on a run from before the step existed", () => {
    const steps = Object.fromEntries(["fence", "switchover", "cutover", "verify", "finalize"].map((k) => [k, { status: "succeeded" as const }]));
    const g = groupsOf(ended({ status: "succeeded" }, { outcome: "succeeded", steps }), []);
    expect(g[2].items.map((x) => x.st)).toEqual(["ok", "ok", "neu", "ok"]);
    expect(g.map((x) => x.st)).toEqual(["done", "done", "done", "done"]);
  });
});

describe("data verification on the result", () => {
  const verified = (report: unknown) => ended({ status: "succeeded" }, { outcome: "succeeded", steps: { verify: { status: "succeeded", evidence: { report } } } });
  const files = { differences: 0, matching: 634, missingOnTarget: 0, ok: true, output: "" };

  it("shows each table's checked and missing rows, a skip and an error, and the file counts", () => {
    render(
      <VerifyBox
        r={verified({
          ok: true,
          missingRows: 0,
          files,
          tables: [
            { table: "app.reservations", checked: 3120, missing: 0 },
            { table: "app.audit", checked: 0, missing: 0, skipped: "no primary key" },
            { table: "app.reviews", checked: 0, missing: 0, error: "permission denied" },
          ],
        })}
      />,
    );
    const rows = screen.getAllByRole("row").map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent));
    expect(rows).toEqual([
      ["테이블", "원본에서 확인한 행", "대상에서 빠진 행", "결과"],
      ["app.reservations", "3,120행", "0행", "일치"],
      ["app.audit", "-", "-", "건너뜀: no primary key"],
      ["app.reviews", "-", "-", "오류: permission denied"],
    ]);
    // a table the engine could not check is not a clean result
    expect(screen.getByText("차이 있음")).toBeInTheDocument();
    expect(screen.getByText("일치하는 파일").nextSibling).toHaveTextContent("634개");
    expect(screen.getByText("내용이 다른 파일").nextSibling).toHaveTextContent("0개");
    expect(screen.getByText("대상에 없는 파일").nextSibling).toHaveTextContent("0개");
  });

  it("says nothing was lost when every table and file matches", () => {
    render(<VerifyBox r={verified({ ok: true, missingRows: 0, files, tables: [{ table: "app.spaces", checked: 48, missing: 0 }] })} />);
    expect(screen.getByText("손실 없음")).toBeInTheDocument();
  });

  it("flags rows missing on the target", () => {
    render(<VerifyBox r={verified({ ok: false, missingRows: 2, tables: [{ table: "app.spaces", checked: 48, missing: 2, samples: ["1", "2"] }] })} />);
    expect(screen.getByText("누락 있음")).toBeInTheDocument();
    expect(screen.getByText("차이 있음")).toBeInTheDocument();
  });

  it("hides the table while the engine reports no tables, and keeps the files", () => {
    render(<VerifyBox r={verified({ ok: true, missingRows: 0, files, tables: [] })} />);
    expect(screen.getByText("데이터 검증")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("일치하는 파일")).toBeInTheDocument();
  });

  it("does not claim nothing was lost from the live report with no tables counted", () => {
    // the shape the platform returns today (moimroom-mig-gke-to-eks-20261107-115247)
    render(<VerifyBox r={verified({ durability: "asynchronous", files, missingRows: 0, ok: true, tables: [] })} />);
    expect(screen.getByText("데이터 검증")).toBeInTheDocument();
    expect(screen.queryByText("손실 없음")).not.toBeInTheDocument();
    expect(screen.queryByText("차이 있음")).not.toBeInTheDocument();
  });

  it("does not claim nothing was lost when every table was skipped or has no count", () => {
    render(<VerifyBox r={verified({ ok: true, files, tables: [{ table: "app.audit", checked: 0, missing: 0, skipped: "no primary key" }, { table: "app.spaces", checked: 48 }] })} />);
    expect(screen.queryByText("손실 없음")).not.toBeInTheDocument();
  });

  it("says rows are missing when the report has no tables but a missing total", () => {
    render(<VerifyBox r={verified({ ok: false, missingRows: 3, tables: [] })} />);
    expect(screen.getByText("차이 있음")).toBeInTheDocument();
    expect(screen.getByText("원본에 있고 대상에 없는 행 3행이 보고되었습니다. 테이블별 내역은 없습니다.")).toBeInTheDocument();
  });

  it("hides the evidence of a rolled back run and of a verify step that did not succeed", () => {
    const report = { ok: true, missingRows: 0, files, tables: [{ table: "app.spaces", checked: 48, missing: 0 }] };
    const rolledBack = ended({ status: "rolled_back" }, { outcome: "rolled_back", steps: { verify: { status: "succeeded", evidence: { report } } } });
    const failed = ended({ status: "failed" }, { outcome: "failed", steps: { verify: { status: "failed", evidence: { report } } } });
    expect(render(<VerifyBox r={rolledBack} />).container).toBeEmptyDOMElement();
    expect(render(<VerifyBox r={failed} />).container).toBeEmptyDOMElement();
  });

  it("shows nothing without a verify report", () => {
    const { container } = render(<VerifyBox r={ended({ status: "succeeded" })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("read canary table", () => {
  const gate = { passed: true, reason: "", requests: 120, errorRate: 0, p95Millis: 45 };
  const inconclusive = { weight: 10, startedAt: at(1), verdict: "inconclusive" as const, gate: { ...gate, passed: false, requests: 15 } };
  const legacyPass = { weight: 50, startedAt: at(2), gate };
  const pass = { weight: 100, startedAt: at(3), verdict: "ok" as const, gate };
  const v = { srcLabel: "GKE", tgtLabel: "EKS" };

  it("shares the inconclusive count with the write switchover guidance", () => {
    const r = fakeRun({
      status: "awaiting_switch", phase: "awaiting_switch",
      canary: { options: { weights: [10, 50, 100] }, passed: true, steps: [inconclusive, legacyPass, pass] },
    });
    render(<CanaryBox r={r} />);
    const summary = "통과 2단계 · 판단 보류 1단계";
    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(screen.getByText("전환 승인 가능")).toBeInTheDocument();
    expect(screen.getByText("판단 보류: 요청 부족, 다음 단계로")).toBeInTheDocument();
    const [headline, guidance] = heroText(v, r, 0);
    expect(headline).toBe("데이터가 맞춰졌습니다. 전환할 수 있습니다.");
    expect(guidance).toContain(summary);
    expect(makeTranslator(ja)(guidance)).toContain("読み取りカナリア：通過 2 段階 · 判断保留 1 段階。");
  });

  it("reports all stages passed only with evidence for every planned stage", () => {
    const r = fakeRun({
      status: "awaiting_switch", phase: "awaiting_switch",
      canary: { options: { weights: [50, 100] }, passed: true, steps: [legacyPass, pass] },
    });
    const { rerender } = render(<CanaryBox r={r} />);
    expect(screen.getByText("게이트 모두 통과")).toBeInTheDocument();
    expect(heroText(v, r, 0)[1]).toContain("게이트 모두 통과");
    rerender(<CanaryBox r={{ ...r, canary: { ...r.canary!, steps: [legacyPass] } }} />);
    expect(screen.queryByText("게이트 모두 통과")).not.toBeInTheDocument();
  });

  it("uses the failed gate verdict and reason in the table and guidance", () => {
    const r = fakeRun({
      status: "rolled_back", phase: "done", statusReason: "error rate 5.00%",
      canary: { options: { weights: [50] }, passed: false, steps: [{ ...legacyPass, gate: { ...gate, passed: false, reason: "error rate 5.00%" } }] },
    });
    render(<CanaryBox r={r} />);
    expect(screen.getByText("게이트 실패")).toBeInTheDocument();
    expect(screen.queryByText("전환 승인 가능")).not.toBeInTheDocument();
    expect(screen.getByText("실패: error rate 5.00%")).toBeInTheDocument();
    expect(heroText(v, r, 0)[1]).toBe("읽기 카나리 게이트 실패: error rate 5.00%. 원본이 다시 트래픽을 받고, 잃은 데이터는 없습니다.");
  });

  it("rounds p95 to whole milliseconds like the gate's reason", () => {
    const r = fakeRun({
      canary: {
        options: { weights: [50] },
        passed: true,
        steps: [{ weight: 50, startedAt: at(1), endedAt: at(2), verdict: "ok", gate: { passed: true, reason: "120 requests, error rate 0.00%, p95 45ms", requests: 120, errorRate: 0, p95Millis: 44.545456 } }],
      },
    });
    render(<CanaryBox r={r} />);
    expect(screen.getByText("45ms")).toBeInTheDocument();
    expect(screen.queryByText("44.545456ms")).not.toBeInTheDocument();
  });
});
