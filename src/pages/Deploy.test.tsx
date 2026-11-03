import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setToken } from "../api/client";
import { at, deploymentEventMsg, fakeDeployment, hang, installFetch, json, snapshotMsg, sse, type FakeCall, type FakeHandler } from "../api/fakes";
import type { App as ApiApp, AppSpec } from "../api/types";
import { App } from "../App";
import { connect } from "../data/live";
import { createSim, SimProvider, type Sim } from "../sim/store";

function setup(hash = "") {
  window.location.hash = hash;
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

afterEach(() => {
  setToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub deploy screens (simulation)", () => {
  it("registers a repository and follows its deployment to the public URL", async () => {
    const { sim, user } = setup("#new");
    expect(screen.getByLabelText("GitHub 레포")).toHaveValue("team-charlie/notice-board");
    expect(screen.getByRole("option", { name: "team-charlie/todo-api (등록됨)" })).toBeDisabled();
    expect(screen.getByText("배포 가능")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://notice-board.hopcharlie.dev" })).toBeInTheDocument();
    expect(screen.getByText("플랫폼 기본값을 쓰는 항목")).toBeInTheDocument();

    await user.click(screen.getByLabelText("온프레미스 k3s"));
    await user.click(screen.getByRole("button", { name: "배포 시작" }));
    expect(await screen.findByRole("heading", { level: 1, name: "notice-board 배포" })).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#deploy-dep_/);
    expect(screen.getByText("1/4 대기열")).toBeInTheDocument();

    ticks(sim, 30);
    expect(screen.getByText("2/4 빌드")).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("RUN npm ci");

    ticks(sim, 200);
    expect(screen.getByRole("status")).toHaveTextContent("배포 완료: 2분 42초");
    expect(screen.getByRole("status")).toHaveTextContent("목표 5분 안에 끝났습니다.");
    expect(within(screen.getByRole("status")).getByRole("link", { name: "https://notice-board.hopcharlie.dev" })).toHaveAttribute("href", "https://notice-board.hopcharlie.dev");
    expect(screen.getByLabelText("최종 경과 시간 2분 42초")).toHaveTextContent("02:42");
    expect(screen.getByText("4/4 완료")).toBeInTheDocument();
    expect(sim.state.deploy.apps.find((a) => a.name === "notice-board")?.deploy?.environments).toEqual(["eks", "gke"]);
  });

  it("shows what to fix in platform.yaml, with paths and hints, and keeps the button off until it passes", async () => {
    const { user } = setup("#new");
    await user.selectOptions(screen.getByLabelText("GitHub 레포"), "team-charlie/photo-album");
    expect(screen.getByText("이 레포는 바로 배포할 수 없습니다.")).toBeInTheDocument();
    const fix = screen.getByText("직접 고쳐야 하는 항목").closest(".box") as HTMLElement;
    expect(within(fix).getByText("services[1].port")).toBeInTheDocument();
    expect(within(fix).getByText("must be between 1 and 65535")).toBeInTheDocument();
    expect(within(fix).getByText("port에는 서비스가 듣는 포트를 1에서 65535 사이로 적으세요.")).toBeInTheDocument();
    expect(within(fix).getByText("services[1].env.WORKERS")).toBeInTheDocument();
    const defaults = screen.getByText("플랫폼 기본값을 쓰는 항목").closest(".box") as HTMLElement;
    expect(within(defaults).getByText("services[0].dockerfile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "배포 시작" })).toBeDisabled();

    const branch = screen.getByLabelText("배포할 브랜치");
    await user.clear(branch);
    await user.type(branch, "fix-worker");
    expect(screen.getByText("배포 가능")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "배포 시작" })).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("GitHub 레포"), "team-charlie/analytics-worker");
    expect(screen.getByLabelText("배포할 브랜치")).toHaveValue("main");
    expect(screen.getByText("레포 루트에 platform.yaml을 두세요. 서비스마다 Dockerfile도 있어야 합니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeInTheDocument();
  });

  it("points at the failed build: step counter, one-line summary and the first error line", async () => {
    const { sim, user } = setup("#new");
    await user.clear(screen.getByLabelText("배포할 브랜치"));
    await user.type(screen.getByLabelText("배포할 브랜치"), "dev");
    await user.click(screen.getByRole("button", { name: "배포 시작" }));
    await screen.findByRole("heading", { level: 1, name: "notice-board 배포" });
    ticks(sim, 60);
    expect(screen.getByText("2/4 빌드에서 실패")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("배포 실패: 이미지 빌드 단계");
    expect(screen.getByText(/^이미지 빌드 단계에서 실패했습니다: web: ERROR/)).toBeInTheDocument();
    const marked = screen.getByRole("log").querySelectorAll(".err");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent("error TS2304");

    await user.click(screen.getByRole("button", { name: "자동 스크롤 멈춤" }));
    expect(screen.getByRole("button", { name: "자동 스크롤 켜기" })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      window.location.hash = "#apps-problem";
    });
    await screen.findByRole("navigation", { name: "상태로 앱 거르기" });
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("link").map((a) => a.textContent)).toContain("notice-board");
    expect(within(table).queryByRole("link", { name: "todo-api" })).not.toBeInTheDocument();
  });

  it("deletes an app only after the in-page confirmation, never window.confirm", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { sim, user } = setup("#app-todo-api");
    expect(screen.getByRole("heading", { level: 1, name: "todo-api" })).toBeInTheDocument();
    expect(screen.getByText("push (github:charlie-dev)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "앱 삭제" }));
    const box = screen.getByRole("group", { name: "앱 삭제 확인" });
    expect(box).toHaveTextContent("데이터는 되돌릴 수 없습니다.");
    await user.click(within(box).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("group", { name: "앱 삭제 확인" })).not.toBeInTheDocument();
    expect(sim.state.deploy.apps.map((a) => a.name)).toEqual(["todo-api"]);

    await user.click(screen.getByRole("button", { name: "앱 삭제" }));
    await user.click(within(screen.getByRole("group", { name: "앱 삭제 확인" })).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(window.location.hash).toBe("#apps"));
    expect(sim.state.deploy.apps).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("deploys again from the app page and supersedes nothing that already finished", async () => {
    const { sim, user } = setup("#app-todo-api");
    await user.click(screen.getByRole("button", { name: "다시 배포" }));
    expect(await screen.findByRole("heading", { level: 1, name: "todo-api 배포" })).toBeInTheDocument();
    expect(sim.state.deploy.deployments[0]).toMatchObject({ trigger: "manual", status: "queued" });
    expect(sim.state.deploy.deployments.slice(1).every((d) => d.status === "healthy")).toBe(true);
  });

  it("filters the app list by the status tiles, kept in the hash", async () => {
    const { user } = setup("#apps");
    const tiles = screen.getByRole("navigation", { name: "상태로 앱 거르기" });
    expect(within(tiles).getByRole("link", { name: /전체/ })).toHaveAttribute("aria-current", "true");
    await user.click(within(tiles).getByRole("link", { name: /배포 중/ }));
    expect(window.location.hash).toBe("#apps-deploying");
    expect(await screen.findByText("이 상태의 앱이 없습니다.")).toBeInTheDocument();
    expect(within(tiles).getByRole("link", { name: /배포 중/ })).toHaveAttribute("aria-current", "true");
    await user.click(within(tiles).getByRole("link", { name: /정상/ }));
    expect(await screen.findByRole("link", { name: "todo-api" })).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});

describe("GitHub deploy screens (platform API)", () => {
  const spec: AppSpec = {
    name: "moimroom",
    services: [{ name: "web", path: ".", dockerfile: "Dockerfile", port: 8080, healthCheck: "/healthz", public: true, replicas: 1 }],
    resources: [{ name: "db", type: "postgres" }],
  };
  const app: ApiApp = {
    name: "moimroom",
    namespace: "moimroom",
    database: { name: "app", user: "app", schemas: [] },
    environments: [],
    deploy: {
      repo: "org/moimroom",
      branch: "main",
      environments: ["eks"],
      autoDeploy: true,
      spec,
      specCommit: "9fceb02d0ae598e95dc970b74767f19372d61af8",
      url: "https://moimroom.hopcharlie.dev",
      createdAt: at(0),
      createdBy: "operator",
      status: [{ env: "eks", status: "healthy", syncStatus: "Synced", healthStatus: "Healthy", commit: "9fceb02d0ae598e95dc970b74767f19372d61af8" }],
    },
  };
  const environment = { name: "eks", provider: "aws", displayName: "AWS EKS", kubeContext: "eks", gatewayBackend: "eks", live: true, status: { reachable: true, checkedAt: at(0) } };

  function live(extra: (c: FakeCall, u: URL) => Response | Promise<Response> | undefined): FakeCall[] {
    const route: FakeHandler = (c) => {
      const u = new URL(c.url, "http://x");
      const r = extra(c, u);
      if (r) return r;
      if (u.pathname === "/v1/github/repos") return json(200, { repos: [{ fullName: "org/moimroom", private: true, defaultBranch: "main", htmlUrl: "https://github.com/org/moimroom" }] });
      if (u.pathname === "/v1/envs") return json(200, { environments: [environment] });
      if (u.pathname === "/v1/apps" && c.method === "GET") return json(200, { apps: [] });
      if (u.pathname === "/v1/apps/validate") return json(200, { valid: true, spec, commit: "9fceb02d0ae598e95dc970b74767f19372d61af8", errors: [] });
      if (u.pathname.endsWith("/events")) return hang(c);
      return json(404, { error: { code: "not_found", message: "no" } });
    };
    const calls = installFetch(route);
    act(() => connect("test-token", false));
    return calls;
  }

  it("registers a repository with POST /v1/apps and opens its deployment", async () => {
    const { user } = setup("#new");
    const calls = live((c, u) => (u.pathname === "/v1/apps" && c.method === "POST" ? json(201, { app, deployment: fakeDeployment() }) : undefined));
    expect(await screen.findByText("배포 가능")).toBeInTheDocument();
    expect(screen.getByLabelText("GitHub 레포")).toHaveValue("org/moimroom");
    expect(screen.getByRole("option", { name: "org/moimroom (비공개)" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("push할 때마다 자동으로 배포"));
    await user.click(screen.getByRole("button", { name: "배포 시작" }));
    await waitFor(() => expect(window.location.hash).toBe("#deploy-dep_1"));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/apps"))!;
    expect(JSON.parse(post.body!)).toEqual({ repo: "org/moimroom", branch: "main", environments: ["eks"], autoDeploy: false });
    expect(post.headers.get("Authorization")).toBe("Bearer test-token");
    const check = calls.find((c) => c.url.endsWith("/v1/apps/validate"))!;
    expect(JSON.parse(check.body!)).toEqual({ repo: "org/moimroom", branch: "main" });
  });

  it("shows a 422 from the register call as the check result, not a generic error", async () => {
    const { user } = setup("#new");
    live((c, u) =>
      u.pathname === "/v1/apps" && c.method === "POST"
        ? json(422, {
            error: { code: "invalid_app_spec", message: "platform.yaml breaks 1 rule" },
            validation: { valid: false, spec, errors: [{ path: "services[0].dockerfile", message: "Dockerfile not found at 9fceb02" }] },
          })
        : undefined,
    );
    await screen.findByText("배포 가능");
    await user.click(screen.getByRole("button", { name: "배포 시작" }));
    const fix = (await screen.findByText("직접 고쳐야 하는 항목")).closest(".box") as HTMLElement;
    expect(within(fix).getByText("services[0].dockerfile")).toBeInTheDocument();
    expect(within(fix).getByText("레포 안의 상대 경로로 적고(.. 금지), 그 위치에 Dockerfile이 있는지 확인하세요.")).toBeInTheDocument();
    expect(screen.queryByText("배포를 시작하지 못했습니다.")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#new");
  });

  it("sends DELETE only after the in-page confirmation", async () => {
    const { user } = setup("#app-moimroom");
    const calls = live((c, u) => {
      if (u.pathname === "/v1/apps/moimroom" && c.method === "GET") return json(200, app);
      if (u.pathname === "/v1/apps/moimroom/deployments") return json(200, { deployments: [fakeDeployment({ app: "moimroom", status: "healthy", finishedAt: at(50) })] });
      if (u.pathname === "/v1/apps/moimroom" && c.method === "DELETE") return new Response(null, { status: 202 });
      return undefined;
    });
    await user.click(await screen.findByRole("button", { name: "앱 삭제" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(within(screen.getByRole("group", { name: "앱 삭제 확인" })).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(window.location.hash).toBe("#apps"));
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/v1/apps/moimroom"]);
  });

  it("shows a failed deployment from the stream with the summary and the marked line", async () => {
    setup("#deploy-dep_1");
    live((_c, u) => {
      if (u.pathname === "/v1/deployments/dep_1/events")
        return sse([
          snapshotMsg(fakeDeployment({ status: "failed", error: "web: exit code 1", finishedAt: at(40) })),
          deploymentEventMsg(1, "phase", { phase: "queued" }),
          deploymentEventMsg(2, "phase", { phase: "building" }),
          deploymentEventMsg(3, "log", { phase: "building", message: "#5 RUN npm ci" }),
          deploymentEventMsg(4, "log", { phase: "building", message: "#6 npm error code ELIFECYCLE" }),
          deploymentEventMsg(5, "log", { phase: "building", message: "#6 exporting" }),
          deploymentEventMsg(40, "done", { phase: "failed", message: "web: exit code 1" }),
          snapshotMsg(fakeDeployment({ status: "failed", error: "web: exit code 1", finishedAt: at(40) })),
        ])(_c);
      return undefined;
    });
    expect(await screen.findByText("2/4 빌드에서 실패")).toBeInTheDocument();
    expect(screen.getByText("이미지 빌드 단계에서 실패했습니다: web: exit code 1")).toBeInTheDocument();
    expect(screen.getByRole("log").querySelector(".err")).toHaveTextContent("npm error code ELIFECYCLE");
    expect(screen.getByLabelText("최종 경과 시간 40초")).toHaveTextContent("00:40");
  });
});
