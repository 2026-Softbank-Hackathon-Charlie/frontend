import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createSim, SimProvider, type Sim } from "./sim/store";

function setup() {
  window.location.hash = "";
  const sim = createSim();
  const user = userEvent.setup();
  render(
    <SimProvider sim={sim} intervalMs={0}>
      <App />
    </SimProvider>,
  );
  return { sim, user };
}

function ticks(sim: Sim, n: number) {
  act(() => {
    for (let i = 0; i < n; i++) sim.tick();
  });
}

describe("Charlie console", () => {
  it("shows the demo banner and overview", () => {
    setup();
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "개요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "개요" })).toHaveAttribute("aria-current", "page");
  });

  it("runs a migration end to end from the UI", async () => {
    const { sim, user } = setup();
    await user.click(screen.getByRole("link", { name: /^이전/ }));
    await user.click(await screen.findByRole("button", { name: "가져오기 완료 상태로 건너뛰기" }));
    expect(await screen.findByRole("heading", { level: 1, name: "shop 이전" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "onprem");
    await user.click(screen.getByRole("button", { name: "이전 시작" }));
    ticks(sim, 151);
    expect(screen.getByText("전환 준비가 끝났습니다.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "전환" }));
    await user.click(screen.getByRole("button", { name: "전환 실행" }));
    ticks(sim, 70);
    expect(screen.getByText("전환 완료: 13.6초, 실패 요청 0건")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /온프레미스 k3s 100%/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "정리 실행" }));
    ticks(sim, 67);
    expect(screen.getByText("이전 리포트")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제 승인" }));
    expect(screen.getByText("삭제 예약됨")).toBeInTheDocument();
  });

  it("disables deploy when no environment is selected", async () => {
    const { user } = setup();
    await user.click(screen.getAllByRole("link", { name: "새 앱 배포" })[0]);
    const start = await screen.findByRole("button", { name: "배포 시작" });
    expect(start).toBeEnabled();
    for (const name of ["AWS EKS", "GCP GKE", "온프레미스 k3s"]) await user.click(screen.getByLabelText(name));
    expect(start).toBeDisabled();
  });

  it("reset returns to the initial state", async () => {
    const { sim, user } = setup();
    act(() => sim.dispatch({ type: "onb-skip" }));
    expect(sim.state.apps.shop).toBeDefined();
    await user.click(screen.getByRole("button", { name: "처음 상태로 되돌리기" }));
    expect(sim.state.apps.shop).toBeUndefined();
  });
});
