import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeSession } from "../api/fakes";
import { chooseMode, startSession } from "../data/live";
import { createSim, SimProvider } from "../sim/store";
import { Onboard } from "./Onboard";

describe("onboarding mode boundary", () => {
  it("does not run a simulated import or collect credentials in live mode", () => {
    startSession(fakeSession());
    const sim = createSim();
    const before = JSON.stringify(sim.state);
    render(<SimProvider sim={sim} intervalMs={0}><Onboard /></SimProvider>);
    expect(screen.getByRole("heading", { name: "실제 가져오기 연동 준비 중" })).toBeInTheDocument();
    expect(screen.queryByLabelText("DB 관리자 비밀번호")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "점검 시작" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "가져오기 완료 상태로 건너뛰기" })).not.toBeInTheDocument();
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it("requires an explicit switch to demo before showing the simulated workflow", async () => {
    startSession(fakeSession());
    const sim = createSim();
    render(<SimProvider sim={sim} intervalMs={0}><Onboard /></SimProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "데모에서 가져오기 흐름 보기" }));
    expect(screen.getByRole("button", { name: "점검 시작" })).toBeInTheDocument();
    expect(screen.getByLabelText("DB 관리자 비밀번호")).toBeInTheDocument();
    expect(sim.state.onb.run).toBe(false);
  });

  it("retains the existing demonstration workflow", async () => {
    act(() => chooseMode("demo"));
    const sim = createSim();
    render(<SimProvider sim={sim} intervalMs={0}><Onboard /></SimProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "점검 시작" }));
    expect(sim.state.onb.run).toBe(true);
  });
});
