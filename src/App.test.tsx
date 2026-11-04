import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeSession, installFetch, json, type FakeCall } from "./api/fakes";
import { App } from "./App";
import { initAuth } from "./data/live";
import { AI_END, SWITCH_AT } from "./sim/mig";
import { createSim, SimProvider, type Sim } from "./sim/store";

/** Renders the console at `hash` with `mode` stored (null: a first visit). */
function setup(hash = "", mode: "demo" | "live" | null = "demo") {
  window.location.hash = hash;
  if (mode) localStorage.setItem("hopcharlie.mode", mode);
  initAuth();
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

/** Logs in from the login screen as admin. */
async function logInAs(user: ReturnType<typeof userEvent.setup>, password = "pw") {
  await user.type(screen.getByLabelText("아이디"), "admin");
  await user.type(screen.getByLabelText("비밀번호"), password);
  await user.click(screen.getByRole("button", { name: "로그인" }));
}

const storeSession = (expiresAt?: string) => localStorage.setItem("hopcharlie.session", JSON.stringify(fakeSession(expiresAt ? { expiresAt } : {})));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  initAuth();
});

describe("HopCharlie console (simulation)", () => {
  it("shows the demo banner and overview", () => {
    setup();
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "개요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "개요" })).toHaveAttribute("aria-current", "page");
  });

  it("runs a migration end to end from the UI", async () => {
    const { sim, user } = setup();
    await user.click(screen.getByRole("link", { name: /^이전$/ }));
    await user.click(await screen.findByRole("button", { name: "가져오기 완료 상태로 건너뛰기" }));
    expect(await screen.findByRole("heading", { level: 1, name: "shop 이전" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "onprem");
    await user.click(screen.getByRole("button", { name: "AI 계획 시작" }));
    ticks(sim, AI_END);
    expect(screen.getByText(/revision 2\)을 승인할까요\?/)).toBeInTheDocument();
    expect(screen.getAllByText("kubectl get secrets -n shop").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));
    expect(screen.getByText("시작 전 검사")).toBeInTheDocument();
    expect(screen.getByText("대상 최대 접속 100 (실행 중인 대상), 필요 22 (원본 접속 18 × 1.2)")).toBeInTheDocument();
    ticks(sim, SWITCH_AT);
    expect(screen.getAllByText("전환 승인 대기").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /읽기: AWS EKS 50%, 온프레미스 k3s 50%/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "전환" }));
    ticks(sim, 68);
    expect(screen.getByText("이전 리포트")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /쓰기: AWS EKS 0%, 온프레미스 k3s 100%/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "롤백" })).toBeEnabled();

    await user.click(screen.getAllByRole("link", { name: "경로별 결과" })[0]);
    expect(screen.getByRole("heading", { level: 1, name: "경로별 결과" })).toBeInTheDocument();
    expect(screen.getByText(/6개 중 1개 경로/)).toBeInTheDocument();
  });

  it("lists the AI sessions on the AI activity page", async () => {
    const { sim, user } = setup();
    act(() => {
      sim.dispatch({ type: "onb-skip" });
      sim.dispatch({ type: "mig-plan" });
    });
    ticks(sim, AI_END);
    await user.click(screen.getByRole("link", { name: "AI 활동" }));
    expect(screen.getByRole("heading", { level: 1, name: "AI 활동" })).toBeInTheDocument();
    expect(screen.getAllByText(/샌드박스 리허설/).length).toBeGreaterThan(0);
  });

  it("shows security findings by environment and category, and filters by a cell", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("link", { name: "보안" }));
    expect(screen.getByRole("heading", { name: "환경 × 분류" })).toBeInTheDocument();
    // on-prem has no threat detection: not checked, which is not the same as clean
    expect(screen.getAllByText("점검 안 함").length).toBeGreaterThan(0);
    expect(screen.getAllByText("이상 없음").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 3 + 1 + 6 + 1 + 6); // matrix, findings, sources (with headers)

    const k3s = screen.getAllByRole("row").find((r) => within(r).queryByText("온프레미스 k3s") && within(r).queryAllByRole("button").length)!;
    const workload = within(k3s).getByRole("button", { name: /높음 1건/ });
    await user.click(workload);
    expect(workload).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/워크로드만 보는 중/)).toBeInTheDocument();
    expect(screen.getByText("privileged 컨테이너")).toBeInTheDocument();
    expect(screen.queryByText("EKS API 엔드포인트가 공개되어 있음")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(screen.getByText("EKS API 엔드포인트가 공개되어 있음")).toBeInTheDocument();
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

describe("HopCharlie console (platform API)", () => {
  const plan = {
    ref: "pln_1",
    status: "pending_approval",
    revision: 3,
    summary: {
      planId: "shop-eks-to-gke",
      source: { env: "eks", namespace: "shop", cluster: "shop-db-eks", dbHost: "shop-db-eks-rw:5432" },
      target: { env: "gke", namespace: "shop", cluster: "shop-db-gke" },
      files: true,
      gatewayMode: "http",
      fenceGate: true,
      maxDowntime: "30s",
    },
    submittedBy: "operator",
    submittedAt: "2026-11-06T01:00:00Z",
  };

  function route(calls: () => FakeCall[]) {
    return (c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/apps") return json(200, { apps: [{ name: "shop", namespace: "shop", database: { name: "app", user: "app", schemas: [] }, environments: [{ env: "eks", cnpgCluster: "shop-db-eks", dbHost: "a" }, { env: "gke", cnpgCluster: "shop-db-gke", dbHost: "b" }] }] });
      if (u.pathname === "/v1/plans") return json(200, { plans: calls().some((x) => x.url.includes("/approve")) ? [{ ...plan, status: "started" }] : [plan] });
      if (u.pathname === "/v1/migrations" && c.method === "GET") return json(200, { runs: [] });
      if (u.pathname === "/v1/agent/sessions") return json(200, { sessions: [] });
      if (u.pathname === "/v1/plans/pln_1/approve") return json(200, { ...plan, status: "approved" });
      if (u.pathname === "/v1/migrations" && c.method === "POST") return json(202, { runId: "run_1", planRef: "pln_1", links: { self: "", events: "" } });
      if (u.pathname.startsWith("/v1/migrations/run_1/events")) return new Promise<Response>(() => {});
      if (u.pathname === "/v1/auth/login") return json(200, fakeSession());
      return json(404, { error: { code: "not_found", message: "no" } });
    };
  }

  it("approves the revision on screen and starts with a read canary", async () => {
    let calls: FakeCall[] = [];
    calls = installFetch(route(() => calls));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "일반 모드로 전환" }));
    await logInAs(user);
    expect(await screen.findByText(/실제 플랫폼 API/)).toBeInTheDocument();

    window.location.hash = "#migrate-shop";
    expect(await screen.findByText(/Plan pln_1 \(revision 3\)을 승인할까요\?/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/migrations"))).toBe(true));
    const approve = calls.find((c) => c.url.includes("/v1/plans/pln_1/approve"))!;
    expect(JSON.parse(approve.body!)).toEqual({ revision: 3 });
    const start = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/migrations"))!;
    expect(JSON.parse(start.body!)).toMatchObject({ planRef: "pln_1", canary: { weights: [10, 50] } });
    expect(start.headers.get("Idempotency-Key")).toBeTruthy();
    expect(approve.headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("shows why a start was refused and lets the operator start again", async () => {
    let started = 0;
    const calls = installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/plans") return json(200, { plans: [{ ...plan, status: started ? "approved" : "pending_approval" }] });
      if (u.pathname === "/v1/migrations" && c.method === "POST") {
        started++;
        return json(409, { error: { code: "residency_denied", message: "residency policy denies this migration: country_not_allowed app.public.customers" } });
      }
      if (u.pathname === "/v1/audit")
        return json(200, {
          entries: started
            ? [
                {
                  id: 9,
                  time: "2026-11-06T01:05:00Z",
                  actor: "op",
                  role: "operator",
                  action: "POST /v1/migrations",
                  target: "/v1/migrations",
                  status: 409,
                  detail: { planRef: "pln_1", error: "residency_denied", residencyDigest: "0123456789abcdef", residencyReasons: ["country_not_allowed app.public.customers"] },
                },
              ]
            : [],
        });
      return route(() => [])(c);
    });
    storeSession();
    const { user } = setup("", "live");
    window.location.hash = "#migrate-shop";
    await user.click(await screen.findByRole("button", { name: "승인하고 시작" }));

    expect(await screen.findByText(/데이터 레지던시 정책에 걸려 이전을 시작하지 않았습니다/)).toBeInTheDocument();
    expect(await screen.findByText("시작 전 검사")).toBeInTheDocument();
    expect(screen.getByText("시작 막힘")).toBeInTheDocument();
    expect(screen.getByText("목적지 국가로 보낼 수 없는 데이터")).toBeInTheDocument();
    expect(screen.getByText("app.public.customers")).toBeInTheDocument();
    expect(screen.getByText("0123456789ab")).toBeInTheDocument();
    // the plan stays approved and on screen instead of falling back to the setup form
    expect(await screen.findByText(/은 승인됐지만 시작하지 않았습니다/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다시 시작" }));
    await waitFor(() => expect(started).toBe(2));
    expect(calls.filter((c) => c.url.includes("/approve"))).toHaveLength(2);
  });

  it("makes no API calls in simulation mode", () => {
    const calls = installFetch(() => json(500, {}));
    setup();
    expect(calls).toHaveLength(0);
  });
});

describe("mode choice and login", () => {
  const notFound = () => json(404, { error: { code: "not_found", message: "no" } });
  const error = (status: number, code: string, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { code, message: code } }), { status, headers: { "Content-Type": "application/json", ...headers } });

  it("asks for a mode on the first visit", () => {
    setup("", null);
    expect(screen.getByRole("heading", { level: 1, name: "어떤 화면으로 시작할까요?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "데모 모드로 시작" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일반 모드로 시작" })).toBeInTheDocument();
    expect(screen.queryByText(/시연용 화면입니다/)).not.toBeInTheDocument();
  });

  it("shows the simulation after choosing demo mode and remembers it", async () => {
    const calls = installFetch(notFound);
    const { user } = setup("", null);
    await user.click(screen.getByRole("button", { name: "데모 모드로 시작" }));
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "개요" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일반 모드로 전환" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "CLI 연결" })).not.toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("demo");
    expect(calls).toHaveLength(0);
  });

  it("asks for a login after choosing live mode", async () => {
    const { user } = setup("", null);
    await user.click(screen.getByRole("button", { name: "일반 모드로 시작" }));
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.getByLabelText("아이디")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("live");

    // the way back to demo mode
    await user.click(screen.getByRole("button", { name: "로그인하지 않고 데모 모드로 보기" }));
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
  });

  it("logs in, shows the admin's name and keeps the session", async () => {
    const calls = installFetch((c) => (c.url.endsWith("/v1/auth/login") ? json(200, fakeSession()) : notFound()));
    const { user } = setup("", "live");
    await logInAs(user, "s3cret");

    expect(await screen.findByText(/실제 플랫폼 API/)).toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).getByText("admin")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "데모 모드로 전환" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CLI 연결" })).toHaveAttribute("href", "#device");

    const req = calls.find((c) => c.url.endsWith("/v1/auth/login"))!;
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body!)).toEqual({ username: "admin", password: "s3cret" });
    expect(req.headers.has("Authorization")).toBe(false);
    expect(JSON.parse(localStorage.getItem("hopcharlie.session")!)).toMatchObject({ token: "test-token", principal: { name: "admin" } });
    // the pages now call the API with the session token
    await waitFor(() => expect(calls.some((c) => c.headers.get("Authorization") === "Bearer test-token")).toBe(true));
  });

  it("explains a wrong password, too many attempts, a server without administrators and a network error", async () => {
    let answer = () => error(401, "invalid_credentials");
    installFetch(() => answer());
    const { user } = setup("", "live");

    await logInAs(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("아이디 또는 비밀번호가 맞지 않습니다");
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();

    answer = () => error(429, "too_many_attempts", { "Retry-After": "120" });
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("로그인 시도가 너무 많습니다. 120초 뒤에 다시 시도하세요"));

    answer = () => error(503, "login_not_configured");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("서버에 관리자 계정이 설정되어 있지 않습니다"));

    answer = () => {
      throw new TypeError("Failed to fetch");
    };
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결할 수 없습니다"));
    expect(localStorage.getItem("hopcharlie.session")).toBeNull();
  });

  it("returns to the login screen when a later API call gets 401", async () => {
    installFetch((c) => (c.url.endsWith("/v1/auth/login") ? json(200, fakeSession()) : error(401, "unauthorized")));
    const { user } = setup("", "live");
    await logInAs(user);

    expect(await screen.findByText("세션이 만료되었습니다. 다시 로그인하세요")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.session")).toBeNull();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("live");
  });

  it("logs out on the server and forgets the session even if that fails", async () => {
    storeSession();
    let logoutAnswer = () => new Response(null, { status: 204 });
    const calls = installFetch((c) => (c.url.endsWith("/v1/auth/logout") ? logoutAnswer() : notFound()));
    const { user } = setup("", "live");
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "로그아웃" }));

    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.queryByText(/세션이 만료되었습니다/)).not.toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.session")).toBeNull();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("live");
    const out = calls.find((c) => c.url.endsWith("/v1/auth/logout"))!;
    expect(out.method).toBe("POST");
    expect(out.headers.get("Authorization")).toBe("Bearer test-token");

    // a server that cannot be reached does not keep anyone logged in
    cleanup();
    storeSession();
    logoutAnswer = () => {
      throw new TypeError("Failed to fetch");
    };
    const second = setup("", "live");
    await second.user.click(within(screen.getByRole("banner")).getByRole("button", { name: "로그아웃" }));
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.session")).toBeNull();
  });

  it("switches modes without logging out", async () => {
    storeSession();
    installFetch(notFound);
    const { user } = setup("", "live");
    await user.click(screen.getByRole("button", { name: "데모 모드로 전환" }));
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("demo");
    expect(localStorage.getItem("hopcharlie.session")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "일반 모드로 전환" }));
    expect(screen.getByText(/실제 플랫폼 API/)).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("admin")).toBeInTheDocument();
  });

  it("keeps a stored session across a reload and drops an expired one", () => {
    installFetch(notFound);
    storeSession();
    setup("", "live");
    expect(screen.getByText(/실제 플랫폼 API/)).toBeInTheDocument();
    cleanup();

    storeSession(new Date(Date.now() - 1000).toISOString());
    setup("", "live");
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.session")).toBeNull();
  });

  it("works when storage throws", async () => {
    for (const m of ["getItem", "setItem", "removeItem"] as const)
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new DOMException("storage is disabled", "SecurityError");
      });
    expect(() => localStorage.getItem("hopcharlie.mode")).toThrow();
    installFetch((c) => (c.url.endsWith("/v1/auth/login") ? json(200, fakeSession()) : notFound()));
    const { user } = setup("", null);
    await user.click(screen.getByRole("button", { name: "데모 모드로 시작" }));
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "일반 모드로 전환" }));
    await logInAs(user);
    expect(await screen.findByText(/실제 플랫폼 API/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
  });
});

describe("CLI login approval (#device)", () => {
  const pending = {
    userCode: "BCDF-GHJK",
    client: "charlie v0.5.0 on rin-sbx-12",
    status: "pending",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
  };
  const reviewed = (action: string) => json(200, { ...pending, status: action === "approve" ? "approved" : "denied", reviewedBy: "admin" });

  function route(review: (action: string) => Response = reviewed) {
    return (c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/auth/login") return json(200, fakeSession());
      if (u.pathname === "/v1/auth/device/BCDF-GHJK" && c.method === "GET") return json(200, pending);
      const m = /^\/v1\/auth\/device\/BCDF-GHJK\/(approve|deny)$/.exec(u.pathname);
      if (m && c.method === "POST") return review(m[1]);
      if (u.pathname.startsWith("/v1/auth/device/")) return json(404, { error: { code: "device_login_not_found", message: "no such device login" } });
      return json(404, { error: { code: "not_found", message: "no" } });
    };
  }

  async function lookUp(user: ReturnType<typeof userEvent.setup>, code: string) {
    const input = screen.getByLabelText("CLI가 보여 준 코드");
    await user.clear(input);
    await user.type(input, code);
    await user.click(screen.getByRole("button", { name: "확인" }));
  }

  it("looks up a lowercase dashed code, shows who asks and approves it", async () => {
    storeSession();
    const calls = installFetch(route());
    const { user } = setup("#device", "live");
    expect(screen.getByRole("heading", { level: 1, name: "CLI 연결" })).toBeInTheDocument();
    expect(screen.getByText("charlie login")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CLI 연결" })).toHaveAttribute("aria-current", "page");

    const input = screen.getByLabelText("CLI가 보여 준 코드");
    await user.type(input, "bcdf-ghjk");
    expect(input).toHaveValue("BCDF-GHJK");
    await user.click(screen.getByRole("button", { name: "확인" }));

    const req = await screen.findByRole("region", { name: "CLI 로그인 요청" });
    expect(within(req).getByText("charlie v0.5.0 on rin-sbx-12")).toBeInTheDocument();
    expect(within(req).getByText(/1분 전/)).toBeInTheDocument();
    expect(within(req).getByText("9분")).toBeInTheDocument();
    expect(within(req).getByText(/승인하면 그 CLI가 30일 동안 내 이름과 관리자 권한으로 동작합니다/)).toBeInTheDocument();
    await user.click(within(req).getByRole("button", { name: "승인" }));

    expect(await screen.findByText("CLI 로그인을 승인했습니다. CLI가 곧 로그인을 마칩니다.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "CLI 로그인 요청" })).not.toBeInTheDocument();
    expect(calls.map((c) => c.method + " " + c.url)).toEqual(["GET /v1/auth/device/BCDF-GHJK", "POST /v1/auth/device/BCDF-GHJK/approve"]);
    expect(calls[1].headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("denies a code typed with a space", async () => {
    storeSession();
    const calls = installFetch(route());
    const { user } = setup("#device", "live");
    await lookUp(user, "bcdf ghjk");
    await user.click(within(await screen.findByRole("region", { name: "CLI 로그인 요청" })).getByRole("button", { name: "거절" }));
    expect(await screen.findByText("거절했습니다.")).toBeInTheDocument();
    expect(calls.map((c) => c.method + " " + c.url)).toEqual(["GET /v1/auth/device/BCDF-GHJK", "POST /v1/auth/device/BCDF-GHJK/deny"]);
  });

  it("explains an unknown code and a request someone already reviewed", async () => {
    storeSession();
    installFetch(route(() => json(409, { error: { code: "device_login_state_conflict", message: "device login is approved" } })));
    const { user } = setup("#device", "live");

    await lookUp(user, "zzzz-zzzz");
    expect(await screen.findByRole("alert")).toHaveTextContent("코드가 없거나 만료되었습니다");

    await lookUp(user, "BCDF-GHJK");
    await user.click(within(await screen.findByRole("region", { name: "CLI 로그인 요청" })).getByRole("button", { name: "승인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 승인 또는 거절된 요청입니다");
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  it("asks for a login first when opened logged out, then stays on #device", async () => {
    installFetch(route());
    const { user } = setup("#device", null);
    expect(screen.getByText("CLI 로그인을 승인하려면 관리자로 로그인해야 합니다.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "어떤 화면으로 시작할까요?" })).not.toBeInTheDocument();

    await logInAs(user);
    expect(await screen.findByRole("heading", { level: 1, name: "CLI 연결" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#device");
    expect(localStorage.getItem("hopcharlie.mode")).toBe("live");
  });

  it("switches to live mode when opened in demo mode with a session", async () => {
    storeSession();
    installFetch(route());
    setup("#device", "demo");
    expect(await screen.findByRole("heading", { level: 1, name: "CLI 연결" })).toBeInTheDocument();
    expect(screen.getByText(/실제 플랫폼 API/)).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("live");
  });
});
