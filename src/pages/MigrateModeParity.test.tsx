import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chooseMode, initAuth } from "../data/live";
import { AI_END, iso } from "../sim/mig";
import { createSim, SimProvider } from "../sim/store";
import { fakeRun } from "../api/fakes";
import { Migrate, MigrateList } from "./Migrate";

function setup(review = false, writtenConfigured?: boolean) {
  chooseMode("demo");
  const sim = createSim();
  sim.dispatch({ type: "onb-skip" });
  if (review) {
    sim.dispatch({ type: "mig-plan" });
    for (let i = 0; i < AI_END; i++) sim.tick();
    if (sim.state.mig.plan && writtenConfigured !== undefined) sim.state.mig.plan.summary.writtenRecordsConfigured = writtenConfigured;
  }
  render(<SimProvider sim={sim} intervalMs={0}><Migrate /></SimProvider>);
  return { sim, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  initAuth();
});

describe("migration demo follows the live controls", () => {
  it("warns about unmeasured write loss before the approval action", () => {
    setup(true, false);
    const warning = screen.getByRole("region", { name: "실행 전 쓰기 검증" });
    const approve = screen.getByRole("button", { name: "승인하고 시작" });
    expect(warning).toHaveTextContent("이대로 시작하면 쓰기 누락은 미측정");
    expect(warning.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(approve).toBeEnabled();
  });

  it("shows the shared AI action and runs only the local rehearsal scenario", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { sim, user } = setup();
    await user.click(screen.getByRole("button", { name: "AI 계획·리허설 실행" }));
    expect(sim.state.mig.stage).toBe("ai");
    expect(fetch).not.toHaveBeenCalled();
    act(() => { for (let i = 0; i < AI_END; i++) sim.tick(); });
    expect(sim.state.mig.stage).toBe("review");
    expect(screen.getByRole("button", { name: "승인하고 시작" })).toBeEnabled();
  });

  it("does not disguise the AI simulation as the manual Plan action", async () => {
    const { sim, user } = setup();
    const manual = screen.getByRole("button", { name: "AI 없이 Plan 작성" });
    expect(manual).toBeDisabled();
    expect(manual).toHaveAccessibleDescription(/데모.*지원하지 않습니다/);
    await user.click(manual);
    expect(sim.state.mig.stage).toBe("setup");
  });

  it("shows the same start controls with explicit unsupported demo options", () => {
    setup(true);
    const canary = screen.getByLabelText("읽기 카나리");
    expect(canary).toHaveValue("quick");
    expect(canary).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /전환 뒤에도/ })).toBeDisabled();
    expect(screen.getByLabelText("관찰 시간")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "게이트를 어기면 바로 롤백" })).toBeDisabled();
    expect(screen.getByText(/데모는 빠른 카나리.*관찰과 자동 롤백.*지원하지 않습니다/)).toBeInTheDocument();
  });
});

describe("migration list", () => {
  // `ago(s)` is the demo clock s seconds ago, the clock the demo stamps its runs with
  function list(history: (ago: (s: number) => string) => ReturnType<typeof fakeRun>[]) {
    chooseMode("demo");
    const sim = createSim();
    sim.dispatch({ type: "onb-skip" });
    sim.state.mig.history = history((s) => iso(sim.state.mig.now - s));
    render(<SimProvider sim={sim} intervalMs={0}><MigrateList /></SimProvider>);
  }

  it("shows the app's latest finished run instead of before migration", () => {
    list((ago) => [fakeRun({ status: "succeeded", phase: "done", source: { env: "eks", namespace: "shop", cluster: "shop-db" }, target: { env: "gke", namespace: "shop", cluster: "shop-db" }, endedAt: ago(180) })]);
    expect(screen.getByText("최근 이전 성공, AWS EKS → GCP GKE, 3분 전")).toBeInTheDocument();
    expect(screen.queryByText("이전 전")).not.toBeInTheDocument();
  });

  it("tells a halted latest run from a succeeded one", () => {
    list((ago) => [fakeRun({ status: "halted", phase: "done", endedAt: ago(0) })]);
    expect(screen.getByText(/^최근 이전 정지, /)).toBeInTheDocument();
  });

  it("reads a run the demo finished against the demo's clock", () => {
    const sim = setup(true).sim;
    cleanup();
    act(() => {
      sim.dispatch({ type: "mig-approve", revision: sim.state.mig.plan!.revision });
      for (let i = 0; i < 2000 && !sim.state.mig.history.length; i++) {
        if (sim.state.mig.run?.status === "awaiting_switch") sim.dispatch({ type: "mig-switch" });
        sim.tick();
      }
      sim.dispatch({ type: "mig-new" });
    });
    expect(sim.state.mig.history[0]?.status).toBe("succeeded");
    render(<SimProvider sim={sim} intervalMs={0}><MigrateList /></SimProvider>);
    expect(screen.getByText(/^최근 이전 성공, .+ → .+, 방금$/)).toBeInTheDocument();
  });

  it("shows before migration only without any run", () => {
    list(() => []);
    expect(screen.getByText("이전 전")).toBeInTheDocument();
  });
});
