import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeSession } from "../api/fakes";
import { chooseMode, initAuth, startSession } from "../data/live";
import { createSim, SimProvider } from "../sim/store";
import { Onboard } from "./Onboard";

afterEach(() => { cleanup(); localStorage.clear(); initAuth(); });
function open(live = false, step: 1 | 2 | 3 | 4 = 1) {
  if (live) startSession(fakeSession()); else chooseMode("demo");
  const sim = createSim(); sim.state.onb.step = step;
  if (step === 3) sim.state.onb.t = 55;
  render(<SimProvider sim={sim} intervalMs={0}><Onboard /></SimProvider>);
  return sim;
}

it("has a self-contained four-stage layout and preserves keyboard form and target selection", async () => {
  const sim = open(), user = userEvent.setup();
  const stages = screen.getByRole("list", { name: "가져오기 단계" });
  expect(stages).toHaveClass("onboard-steps");
  expect(within(stages).getAllByRole("listitem")).toHaveLength(4);
  expect(stages.querySelector('[aria-current="step"]')).toHaveTextContent("연결 정보");
  expect(screen.getByRole("heading", { level: 2, name: "연결 정보" })).toBeInTheDocument();
  await user.tab(); expect(screen.getByLabelText("GitHub 레포")).toHaveFocus();
  await user.selectOptions(screen.getByLabelText("처음 배포할 클러스터"), "onprem");
  expect(sim.state.onb.env).toBe("onprem");
  await user.click(screen.getByRole("button", { name: "점검 시작" }));
  expect(stages.querySelector('[aria-current="step"]')).toHaveTextContent("AI 점검");
  expect(screen.getByRole("button", { name: "샌드박스 테스트 시작" })).toBeDisabled();
});

it("keeps live onboarding explicitly unavailable without credentials or fabricated progress", () => {
  open(true);
  const panel = screen.getByRole("region", { name: "실제 가져오기 연동 준비 중" });
  expect(panel).toHaveTextContent("아직 실제 API에 연결되지 않았습니다");
  expect(within(panel).getByText("미연결")).toBeInTheDocument();
  expect(screen.queryByLabelText("클라우드 읽기 전용 자격 증명")).not.toBeInTheDocument();
  expect(screen.getByRole("list", { name: "가져오기 단계" }).querySelector('[aria-current="step"]')).toBeNull();
  expect(screen.getByRole("link", { name: "앱 목록으로" })).toHaveAttribute("href", "#apps");
});

it("retains failed rehearsal evidence, a keyboard-scrollable diff and the approval gate", () => {
  open(false, 3);
  expect(screen.getByText("실패")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "PR 확인" })).toBeDisabled();
  const diff = screen.getByRole("region", { name: "코드 변경 내용" });
  expect(diff).toHaveAttribute("tabindex", "0");
  expect(diff).toHaveTextContent("DATABASE_URL");
  expect(screen.getByRole("list", { name: "가져오기 단계" }).querySelector('[aria-current="step"]')).toHaveTextContent("샌드박스 테스트");
});
