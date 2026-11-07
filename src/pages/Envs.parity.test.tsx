import { fireEvent, render, screen, within } from "@testing-library/react";
import type { App, Environment, TrafficState } from "../api/types";
import { fakeRun } from "../api/fakes";
import { useEnvironments, useTraffic } from "../api/hooks";
import { createSim, SimProvider } from "../sim/store";
import { Envs } from "./Envs";

const state = vi.hoisted(() => ({
  live: false,
  envs: { data: undefined as Environment[] | undefined, error: undefined as { message: string } | undefined, loading: true, reload: vi.fn() },
  traffic: { data: undefined as TrafficState | undefined, error: undefined as { message: string } | undefined, loading: true, reload: vi.fn() },
  apps: { data: undefined as App[] | undefined, error: undefined as { message: string } | undefined, loading: true, reload: vi.fn() },
}));
vi.mock("../api/hooks", () => ({ useEnvironments: vi.fn(() => state.envs), useTraffic: vi.fn(() => state.traffic), useApps: vi.fn(() => state.apps) }));
vi.mock("../data/live", () => ({ useLive: () => state.live, useAuth: () => ({ session: { principal: { role: "operator" } } }), errorText: (error: { message: string }) => error.message }));

const environment: Environment = {
  name: "eks", provider: "aws", displayName: "API EKS", region: "api-region", kubeContext: "eks", gatewayBackend: "api-backend", live: true,
  status: { reachable: true, checkedAt: "2026-11-06T00:00:00Z", kubernetesVersion: "1.35", nodes: { ready: 2, total: 3, architectures: ["amd64"] }, databases: [] },
};
const traffic: TrafficState = {
  writeBackend: "api-backend", readWeights: { "api-backend": 100 }, writesHeld: false, heldWrites: 0, maxHold: "30s", inFlight: { reads: 0, writes: 0 },
  backends: [{ name: "api-backend", url: "https://example.invalid", healthy: true }],
  stats: { "api-backend": { windowSeconds: 60, requests: 1200, errors: 0, errorRate: 0, rps: 20, p50Millis: 10, p95Millis: 30, p99Millis: 50 } },
  totals: { "api-backend": { requests: 1200, errors: 0 } }, updatedAt: "2026-11-06T00:00:00Z",
};

function open(sim = createSim()) {
  return render(<SimProvider sim={sim} intervalMs={0}><Envs /></SimProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.live = false;
  state.envs = { data: undefined, error: undefined, loading: true, reload: vi.fn() };
  state.traffic = { data: undefined, error: undefined, loading: true, reload: vi.fn() };
  state.apps = { data: undefined, error: undefined, loading: true, reload: vi.fn() };
});

describe("environment mode parity", () => {
  it("keeps compact per-DB readiness and backup fields, distinguishing unknown from no CNPG", () => {
    state.live = true;
    const db = { namespace: "room", name: "room-db", instances: 2, readyInstances: 1, replica: true,
      backup: { objectStore: "room", walArchiving: true, lastSuccessfulBackup: new Date().toISOString(), firstRecoverabilityPoint: "2026-11-05T00:00:00Z" } };
    state.envs = { ...state.envs, data: [{ ...environment, status: { ...environment.status, databases: [db] } },
      { ...environment, name: "unknown", displayName: "조회 실패", status: { ...environment.status, databases: undefined } },
      { ...environment, name: "empty", displayName: "빈 CNPG", status: { ...environment.status, databases: [] } }], loading: false };
    state.traffic = { ...state.traffic, data: traffic, loading: false };
    open();
    const dbList = screen.getByRole("list", { name: "DB 현황" });
    expect(dbList).toHaveTextContent("room-db");
    expect(dbList).toHaveTextContent("1/2 준비 · 복제본");
    expect(within(dbList).getByText("room-db")).toHaveAttribute("title", "room/room-db");
    const backups = screen.getByRole("list", { name: "DB 백업 현황" });
    expect(backups).toHaveTextContent("백업 정상");
    expect(backups).toHaveTextContent("최근");
    expect(backups).toHaveTextContent("복구 가능");
    expect(backups).not.toHaveTextContent("마지막 백업");
    const unknown = screen.getByRole("row", { name: /조회 실패/ });
    expect(within(unknown).getAllByText("미확인")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /빈 CNPG/ })).toHaveTextContent("CNPG 없음");
  });
  it("uses the same cluster and gateway fields in demo and live modes", () => {
    const demo = open();
    const demoColumns = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(screen.queryByRole("button", { name: "온프렘 연결" })).not.toBeInTheDocument();
    expect(demoColumns).toEqual(["환경", "위치", "Kubernetes", "노드", "DB (CNPG)", "DB 백업", "게이트웨이 백엔드", "상태", "백엔드", "상태", "요청 (1분)", "오류율", "p95"]);
    expect(screen.getByRole("heading", { name: "트래픽 게이트웨이" })).toBeInTheDocument();
    expect(useEnvironments).not.toHaveBeenCalled();
    expect(useTraffic).not.toHaveBeenCalled();
    demo.unmount();

    state.live = true;
    state.envs = { ...state.envs, data: [environment], loading: false };
    state.traffic = { ...state.traffic, data: traffic, loading: false };
    open();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(demoColumns);
    expect(screen.getByText("API EKS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "온프렘 연결" })).toBeInTheDocument();
    expect(useEnvironments).toHaveBeenCalledWith(10_000);
    expect(useTraffic).toHaveBeenCalledWith(5_000, "1m", undefined, false);
  });

  it("shows partial, unreachable and backup states as labelled demo observations", () => {
    open();
    expect(screen.getByText(/시연용 데이터입니다/)).toBeInTheDocument();
    expect(screen.getByText(/일부를 읽지 못함/)).toBeInTheDocument();
    expect(screen.getByText("연결 안 됨")).toBeInTheDocument();
    expect(screen.getByText("백업 정상")).toBeInTheDocument();
    expect(screen.getByText("마지막 백업 실패")).toBeInTheDocument();
    expect(screen.getByText("비정상")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "StorageClass" })).not.toBeInTheDocument();
  });

  it("keeps real API values separate from demo fixtures", () => {
    state.live = true;
    state.envs = { ...state.envs, data: [environment], loading: false };
    state.traffic = { ...state.traffic, data: traffic, loading: false };
    open();
    expect(screen.getByText("api-region")).toBeInTheDocument();
    expect(screen.getByText("2/3대")).toBeInTheDocument();
    expect(screen.getByText("30ms")).toBeInTheDocument();
    expect(screen.queryByText(/시연용 데이터입니다/)).not.toBeInTheDocument();
    expect(screen.queryByText("AWS EKS")).not.toBeInTheDocument();
  });

  it("passes real environment names to the enrollment form and prevents replacing the existing onprem", () => {
    state.live = true;
    state.envs = { ...state.envs, data: [environment, { ...environment, name: "onprem", provider: "onprem", displayName: "내 노트북" }], loading: false };
    state.traffic = { ...state.traffic, data: traffic, loading: false };
    open();
    fireEvent.click(screen.getByRole("button", { name: "온프렘 연결" }));
    const panel = screen.getByRole("region", { name: "온프렘 연결 마법사" });
    expect(within(panel).getByLabelText("환경 이름")).toHaveValue("");
    fireEvent.change(within(panel).getByLabelText("환경 이름"), { target: { value: "onprem" } });
    expect(within(panel).getByRole("alert")).toHaveTextContent("이미 등록된 환경 이름");
    expect(within(panel).getByRole("button", { name: "등록 코드 발급" })).toBeDisabled();
  });

  it("keeps writes on the source until the engine completes cutover", () => {
    const sim = createSim();
    sim.state.mig.src = "aws";
    sim.state.mig.tgt = "gcp";
    sim.state.mig.switched = true;
    sim.state.mig.held = 10;
    sim.state.mig.heldDone = 6;
    const run = fakeRun();
    run.engine.writesHeld = true;
    run.engine.trafficOnTarget = false;
    run.canary = { options: { weights: [100], stepDuration: "20s" }, steps: [{ weight: 100, startedAt: run.startedAt }] };
    sim.state.mig.run = run;
    const view = open(sim);
    expect(screen.getByText("쓰기 대상").nextElementSibling).toHaveTextContent("eks");
    expect(screen.getByText("gke 100%")).toBeInTheDocument();
    expect(screen.getByText("보류 중 (10건, 상한 30s)")).toBeInTheDocument();

    run.engine.trafficOnTarget = true;
    run.engine.writesHeld = false;
    sim.state.mig.held = 0;
    sim.state.mig.heldDone = 16;
    view.rerender(<SimProvider sim={sim} intervalMs={0}><Envs /></SimProvider>);
    expect(screen.getByText("쓰기 대상").nextElementSibling).toHaveTextContent("gke");
    expect(screen.getByText("gke 100%")).toBeInTheDocument();
    expect(screen.getByText("쓰기 보류").nextElementSibling).toHaveTextContent("없음");
    expect(useTraffic).not.toHaveBeenCalled();
  });

  it("shows canary read weights while writes remain on the source", () => {
    const sim = createSim();
    sim.state.mig.src = "aws";
    sim.state.mig.tgt = "gcp";
    const run = fakeRun();
    run.canary = { options: { weights: [10, 30, 100], stepDuration: "20s" }, steps: [{ weight: 30, startedAt: run.startedAt }] };
    sim.state.mig.run = run;
    open(sim);
    expect(screen.getByText("쓰기 대상").nextElementSibling).toHaveTextContent("eks");
    expect(screen.getByText("읽기 비율").nextElementSibling).toHaveTextContent("eks 70%, gke 30%");
    expect(screen.getByText("쓰기 보류").nextElementSibling).toHaveTextContent("없음");
  });

  it("preserves independent error and retry states for each live resource", () => {
    state.live = true;
    state.envs.error = { message: "환경 조회 권한 없음" };
    state.traffic.error = { message: "게이트웨이 응답 없음" };
    open();
    const envError = screen.getByText("클러스터 상태를 불러오지 못했습니다.").closest<HTMLElement>(".loaderr")!;
    const trafficError = screen.getByText("트래픽 게이트웨이 상태를 불러오지 못했습니다.").closest<HTMLElement>(".loaderr")!;
    fireEvent.click(within(envError).getByRole("button"));
    fireEvent.click(within(trafficError).getByRole("button"));
    expect(state.envs.reload).toHaveBeenCalledOnce();
    expect(state.traffic.reload).toHaveBeenCalledOnce();
    expect(screen.queryByText("AWS EKS")).not.toBeInTheDocument();
  });
  describe("live traffic gateway of the registered apps", () => {
    // an app of the apps file has a gateway of its own; a registered one with no database pair has none
    const app = (name: string, gateway = true) =>
      ({ name, namespace: name, database: { name: "app", user: "app", schemas: [] }, environments: gateway ? [{ env: "eks", cnpgCluster: name + "-db", dbHost: "h" }] : [] }) as App;
    const live = () => {
      state.live = true;
      state.envs = { ...state.envs, data: [environment], loading: false };
      state.traffic = { ...state.traffic, data: traffic, loading: false };
    };

    it("reads nothing from the gateway until the app list has answered", () => {
      live();
      open();
      expect(useTraffic).toHaveBeenLastCalledWith(5_000, "1m", undefined, false);
    });

    it("reads the first registered app's gateway, not the one without an app, and lets the user pick another app", () => {
      live();
      // docker-doom comes first but has no gateway (the platform answers 400 for it), so it is neither read nor offered
      state.apps = { ...state.apps, data: [app("docker-doom", false), app("moimroom-mig"), app("pxls"), app("board")], loading: false };
      open();
      expect(useTraffic).toHaveBeenLastCalledWith(5_000, "1m", "moimroom-mig", true);
      const pick = screen.getByRole("combobox", { name: "트래픽을 볼 앱" });
      expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["moimroom-mig", "pxls", "board"]);
      fireEvent.change(pick, { target: { value: "pxls" } });
      expect(useTraffic).toHaveBeenLastCalledWith(5_000, "1m", "pxls", true);
      expect(screen.getByRole("combobox", { name: "트래픽을 볼 앱" })).toHaveValue("pxls");
    });

    it("falls back to the gateway without an app when no app is registered, or none has a gateway", () => {
      live();
      state.apps = { ...state.apps, data: [], loading: false };
      open();
      expect(useTraffic).toHaveBeenLastCalledWith(5_000, "1m", undefined, true);
      expect(screen.queryByRole("combobox", { name: "트래픽을 볼 앱" })).not.toBeInTheDocument();
      state.apps = { ...state.apps, data: [app("docker-doom", false)], loading: false };
      open();
      expect(useTraffic).toHaveBeenLastCalledWith(5_000, "1m", undefined, true);
    });

    it("says so when the app list cannot be read, and shows the gateway without an app", () => {
      live();
      state.apps = { ...state.apps, error: { message: "boom" }, loading: false };
      open();
      expect(useTraffic).toHaveBeenLastCalledWith(5_000, "1m", undefined, true);
      expect(screen.getByText(/앱 목록을 읽지 못해/)).toBeInTheDocument();
    });
  });
});
