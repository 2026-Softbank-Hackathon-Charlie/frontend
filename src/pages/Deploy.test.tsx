import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setToken } from "../api/client";
import { at, deploymentEventMsg, fakeDeployment, hang, installFetch, json, snapshotMsg, sse, type FakeCall, type FakeHandler } from "../api/fakes";
import type { App as ApiApp, AppInstance, AppSpec } from "../api/types";
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

  const board = { repo: "team-charlie/notice-board", branch: "main", environments: ["eks", "gke"], autoDeploy: true };

  /** Opens the app page of `name`; returns its instances section. */
  async function appPage(name: string) {
    act(() => {
      window.location.hash = "#app-" + name;
    });
    await screen.findByRole("heading", { level: 1, name });
    return screen.getByRole("heading", { name: "브랜치별 인스턴스" }).closest("section") as HTMLElement;
  }

  it("adds a branch as its own instance, shows its failed build next to a healthy main, and removes it after typing its name", async () => {
    const { sim, user } = setup("#apps");
    act(() => sim.dispatch({ type: "app-create", req: board }));
    ticks(sim, 300);
    let section = await appPage("notice-board");
    expect(screen.getByText("기본 브랜치")).toBeInTheDocument();
    expect(within(section).getByText("기본")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "notice-board 삭제" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("추가할 브랜치"), "dev");
    await user.click(screen.getByRole("button", { name: "브랜치 추가" }));
    expect(await screen.findByRole("heading", { level: 1, name: "notice-board--dev 배포" })).toBeInTheDocument();
    expect(screen.getByText(/^dev 브랜치, 등록 배포, dev/)).toBeInTheDocument();
    const id = window.location.hash.slice("#deploy-".length);
    ticks(sim, 60);
    expect(screen.getByText("2/4 빌드에서 실패")).toBeInTheDocument();

    section = await appPage("notice-board");
    const dev = within(section).getByText("notice-board--dev").closest("tr") as HTMLElement;
    const main = within(section).getAllByText("notice-board")[0].closest("tr") as HTMLElement;
    expect(within(dev).getByRole("link", { name: "https://notice-board--dev.hopcharlie.dev" })).toBeInTheDocument();
    expect(within(dev).getByRole("link", { name: "notice-board--dev 마지막 배포" })).toHaveAttribute("href", "#deploy-" + id);
    expect(dev).toHaveTextContent("실패");
    expect(main).toHaveTextContent("AWS EKS 정상");
    const history = screen.getByRole("heading", { name: "배포 이력" }).closest("section") as HTMLElement;
    expect(within(history).getByRole("columnheader", { name: "브랜치" })).toBeInTheDocument();
    expect(within(history).getAllByRole("row")[1]).toHaveTextContent(id + "dev실패");

    await user.click(within(section).getByRole("button", { name: "notice-board--dev 삭제" }));
    const box = screen.getByRole("group", { name: "인스턴스 삭제 확인" });
    expect(box).toHaveTextContent("apps/notice-board--dev/을 지우고");
    const del = within(box).getByRole("button", { name: "삭제" });
    await user.type(within(box).getByLabelText("확인하려면 인스턴스 이름 notice-board--dev을(를) 입력하세요"), "notice-board--de");
    expect(del).toBeDisabled();
    await user.type(within(box).getByRole("textbox"), "v");
    await user.click(del);
    expect(screen.queryByRole("group", { name: "인스턴스 삭제 확인" })).not.toBeInTheDocument();
    expect(sim.state.deploy.apps.find((a) => a.name === "notice-board")?.deploy?.instances.map((i) => i.name)).toEqual(["notice-board"]);
    expect(window.location.hash).toBe("#app-notice-board");
  });

  it("keeps an app to three instances, says why a branch was refused, and marks the app in the list", async () => {
    const { sim, user } = setup("#apps");
    act(() => {
      sim.dispatch({ type: "app-create", req: board });
      sim.dispatch({ type: "instance-create", name: "notice-board", branch: "dev", autoDeploy: true });
    });
    ticks(sim, 300);
    await appPage("notice-board");
    await user.type(screen.getByLabelText("추가할 브랜치"), "dev");
    await user.click(screen.getByRole("button", { name: "브랜치 추가" }));
    expect(screen.getByRole("alert")).toHaveTextContent("브랜치를 추가하지 못했습니다.브랜치 dev은(는) 이미 배포하고 있습니다");

    await user.clear(screen.getByLabelText("추가할 브랜치"));
    await user.type(screen.getByLabelText("추가할 브랜치"), "feature/search");
    await user.click(screen.getByRole("button", { name: "브랜치 추가" }));
    expect(await screen.findByRole("heading", { level: 1, name: "notice-board--feature-search 배포" })).toBeInTheDocument();
    ticks(sim, 300);
    expect(screen.getByRole("status")).toHaveTextContent("https://notice-board--feature-search.hopcharlie.dev");

    await appPage("notice-board");
    expect(screen.getByText(/^인스턴스가 3개라 브랜치를 더 추가할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText("추가할 브랜치")).toBeDisabled();
    expect(screen.getByRole("button", { name: "브랜치 추가" })).toBeDisabled();

    act(() => {
      window.location.hash = "#apps-problem";
    });
    const row = (await screen.findByRole("link", { name: "notice-board" })).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("브랜치 3");
    expect(row).toHaveTextContent("dev 브랜치 문제 있음");
    expect(row).not.toHaveTextContent("feature/search 브랜치");
  });

  it("shows what to fix when the added branch's platform.yaml breaks a rule", async () => {
    const { sim, user } = setup("#apps");
    act(() => sim.dispatch({ type: "app-create", req: { ...board, repo: "team-charlie/photo-album", branch: "fix-worker" } }));
    await appPage("photo-album");
    await user.type(screen.getByLabelText("추가할 브랜치"), "main");
    await user.click(screen.getByRole("button", { name: "브랜치 추가" }));
    const fix = screen.getByText("직접 고쳐야 하는 항목").closest(".box") as HTMLElement;
    expect(within(fix).getByText("services[1].port")).toBeInTheDocument();
    expect(window.location.hash).toBe("#app-photo-album");
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
  const commit = "9fceb02d0ae598e95dc970b74767f19372d61af8";
  const main: AppInstance = {
    name: "moimroom",
    branch: "main",
    default: true,
    autoDeploy: true,
    spec,
    specCommit: commit,
    url: "https://moimroom.hopcharlie.dev",
    createdAt: at(0),
    createdBy: "operator",
    status: [{ env: "eks", status: "healthy", syncStatus: "Synced", healthStatus: "Healthy", commit }],
  };
  const devDeployment = fakeDeployment({ id: "dep_7", branch: "dev", instance: "moimroom--dev", ref: "dev", status: "failed", error: "web: exit code 1", finishedAt: at(40) });
  const dev: AppInstance = {
    name: "moimroom--dev",
    branch: "dev",
    default: false,
    autoDeploy: false,
    spec,
    specCommit: commit,
    url: "https://moimroom--dev.hopcharlie.dev",
    createdAt: at(1),
    createdBy: "operator",
    lastDeployment: devDeployment,
    status: [{ env: "eks", status: "pending" }],
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
      specCommit: commit,
      url: "https://moimroom.hopcharlie.dev",
      createdAt: at(0),
      createdBy: "operator",
      status: main.status,
      instances: [main, dev],
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

  /** The app page, with the app and two deployments (main healthy, dev failed). */
  function appRoutes(extra: (c: FakeCall, u: URL) => Response | undefined = () => undefined) {
    return live((c, u) => {
      const r = extra(c, u);
      if (r) return r;
      if (u.pathname === "/v1/apps/moimroom" && c.method === "GET") return json(200, app);
      if (u.pathname === "/v1/apps/moimroom/deployments" && c.method === "GET")
        return json(200, { deployments: [devDeployment, fakeDeployment({ status: "healthy", finishedAt: at(50) })] });
      return undefined;
    });
  }

  it("lists the instances and adds a branch with POST /v1/apps/{name}/instances, then opens its deployment", async () => {
    const { user } = setup("#app-moimroom");
    const calls = appRoutes((c, u) =>
      u.pathname === "/v1/apps/moimroom/instances" && c.method === "POST"
        ? json(201, { instance: { ...dev, name: "moimroom--feature-x", branch: "feature/x" }, deployment: fakeDeployment({ id: "dep_9", branch: "feature/x", instance: "moimroom--feature-x" }) })
        : undefined,
    );
    const section = (await screen.findByRole("heading", { name: "브랜치별 인스턴스" })).closest("section") as HTMLElement;
    const row = within(section).getByText("moimroom--dev").closest("tr") as HTMLElement;
    expect(within(row).getByRole("link", { name: "https://moimroom--dev.hopcharlie.dev" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "moimroom--dev 마지막 배포" })).toHaveAttribute("href", "#deploy-dep_7");
    expect(row).toHaveTextContent("꺼짐");
    expect(within(section).getByRole("button", { name: "moimroom--dev 삭제" })).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "moimroom 삭제" })).not.toBeInTheDocument();
    expect(screen.getByText("인스턴스 2/3개")).toBeInTheDocument();
    const history = screen.getByRole("heading", { name: "배포 이력" }).closest("section") as HTMLElement;
    expect(within(history).getAllByRole("row")[1]).toHaveTextContent("dep_7dev실패");

    await user.type(screen.getByLabelText("추가할 브랜치"), "feature/x");
    await user.click(screen.getByLabelText("push할 때마다 자동으로 배포"));
    await user.click(screen.getByRole("button", { name: "브랜치 추가" }));
    await waitFor(() => expect(window.location.hash).toBe("#deploy-dep_9"));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/apps/moimroom/instances"))!;
    expect(JSON.parse(post.body!)).toEqual({ branch: "feature/x", autoDeploy: false });
  });

  it("says why a branch was refused: a 409 as a message, a 422 as the check result", async () => {
    const { user } = setup("#app-moimroom");
    let n = 0;
    appRoutes((c, u) => {
      if (u.pathname !== "/v1/apps/moimroom/instances" || c.method !== "POST") return undefined;
      if (n++ === 0) return json(409, { error: { code: "instance_exists", message: "moimroom--dev is taken by branch Dev" } });
      return json(422, {
        error: { code: "invalid_app_spec", message: "platform.yaml breaks 1 rule" },
        validation: { valid: false, spec, errors: [{ path: "name", message: "must be moimroom, the app's name" }] },
      });
    });
    await user.type(await screen.findByLabelText("추가할 브랜치"), "Dev");
    await user.click(screen.getByRole("button", { name: "브랜치 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("다른 브랜치가 같은 인스턴스 이름을 쓰고 있습니다. 슬러그가 같은 브랜치는 하나만 추가할 수 있습니다: moimroom--dev is taken by branch Dev");
    await user.click(screen.getByRole("button", { name: "브랜치 추가" }));
    const fix = (await screen.findByText("직접 고쳐야 하는 항목")).closest(".box") as HTMLElement;
    expect(within(fix).getByText("must be moimroom, the app's name")).toBeInTheDocument();
    expect(window.location.hash).toBe("#app-moimroom");
  });

  it("deletes an added instance only after its name is typed, and deploys one instance from its row", async () => {
    const { user } = setup("#app-moimroom");
    const calls = appRoutes((c, u) => {
      if (u.pathname === "/v1/apps/moimroom/instances/moimroom--dev" && c.method === "DELETE") return new Response(null, { status: 202 });
      if (u.pathname === "/v1/apps/moimroom/deployments" && c.method === "POST") return json(202, fakeDeployment({ id: "dep_8", branch: "dev", instance: "moimroom--dev", trigger: "manual" }));
      return undefined;
    });
    const section = (await screen.findByRole("heading", { name: "브랜치별 인스턴스" })).closest("section") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "moimroom--dev 삭제" }));
    const box = screen.getByRole("group", { name: "인스턴스 삭제 확인" });
    expect(within(box).getByRole("button", { name: "삭제" })).toBeDisabled();
    await user.type(within(box).getByRole("textbox"), "moimroom--dev");
    await user.click(within(box).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "인스턴스 삭제 확인" })).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/v1/apps/moimroom/instances/moimroom--dev"]);

    await user.click(within(section).getByRole("button", { name: "moimroom--dev 배포" }));
    await waitFor(() => expect(window.location.hash).toBe("#deploy-dep_8"));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/apps/moimroom/deployments"))!;
    expect(JSON.parse(post.body!)).toEqual({ branch: "dev" });
  });

  it("shows the instance's own public URL on its deployment page", async () => {
    setup("#deploy-dep_7");
    const healthy = fakeDeployment({ id: "dep_7", branch: "dev", instance: "moimroom--dev", ref: "dev", status: "healthy", environments: [{ env: "eks", status: "healthy" }], finishedAt: at(50) });
    live((c, u) => {
      if (u.pathname === "/v1/deployments/dep_7/events") return sse([snapshotMsg(healthy)])(c);
      if (u.pathname === "/v1/apps/moimroom") return json(200, app);
      return undefined;
    });
    expect(await screen.findByRole("heading", { level: 1, name: "moimroom--dev 배포" })).toBeInTheDocument();
    expect(screen.getByText(/^dev 브랜치, 등록 배포, dev/)).toBeInTheDocument();
    expect(screen.getByText("gitops 저장소에 apps/moimroom--dev/<환경>.yaml을 씁니다")).toBeInTheDocument();
    const done = screen.getByRole("status");
    await waitFor(() => expect(within(done).getByRole("link", { name: "https://moimroom--dev.hopcharlie.dev" })).toBeInTheDocument());
    expect(done).toHaveTextContent("AWS EKS에서 moimroom--dev이(가) 실행 중입니다.");
    expect(screen.queryByRole("link", { name: "https://moimroom.hopcharlie.dev" })).not.toBeInTheDocument();
  });

  it("marks an app with a failing added instance in the list", async () => {
    setup("#apps");
    live((c, u) => (u.pathname === "/v1/apps" && c.method === "GET" ? json(200, { apps: [app] }) : undefined));
    const row = (await screen.findByRole("link", { name: "moimroom" })).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("브랜치 2");
    expect(row).toHaveTextContent("dev 브랜치 문제 있음");
    const tiles = screen.getByRole("navigation", { name: "상태로 앱 거르기" });
    expect(within(tiles).getByRole("link", { name: /문제 있음/ })).toHaveTextContent("1");
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
