import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeAgentSession, fakeSession, installFetch, json, type FakeCall } from "./api/fakes";
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
  vi.useRealTimers();
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
    expect(await screen.findByRole("heading", { level: 1, name: "moimroom 이전" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("옮겨 갈 환경"), "onprem");
    await user.click(screen.getByRole("button", { name: "AI 계획 시작" }));
    ticks(sim, AI_END);
    expect(screen.getByText(/revision 2\)을 승인할까요\?/)).toBeInTheDocument();
    expect(screen.getAllByText("kubectl get secrets -n moimroom").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));
    await user.click(screen.getByRole("tab", { name: /시작 전 검사/ }));
    expect(screen.getByText("시작 전 검사")).toBeInTheDocument();
    expect(screen.getByText("대상 최대 접속 100 (실행 중인 대상), 필요 22 (원본 접속 18 × 1.2)")).toBeInTheDocument();
    ticks(sim, SWITCH_AT);
    expect(screen.getAllByText("전환 승인 대기").length).toBeGreaterThan(0);
    // The canary ends at 100%: every read is on the target before the switch.
    expect(screen.getByRole("img", { name: /읽기: AWS EKS 0%, 온프레미스 k3s 100%/ })).toBeInTheDocument();

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
    await user.click(screen.getByRole("link", { name: /^보안/ }));
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

  it("shows moimroom's address and pods on its app page", async () => {
    const { sim } = setup();
    act(() => sim.dispatch({ type: "onb-skip" }));
    act(() => {
      window.location.hash = "#app-moimroom";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "moimroom" })).toBeInTheDocument();
    expect(screen.getByText("https://moimroom.hopcharlie.dev")).toBeInTheDocument();
    expect(screen.getByText("Pod 2/2")).toBeInTheDocument();
  });

  it("reset returns to the initial state", async () => {
    const { sim, user } = setup();
    act(() => sim.dispatch({ type: "onb-skip" }));
    expect(sim.state.apps.moimroom).toBeDefined();
    await user.click(screen.getByRole("button", { name: "처음 상태로 되돌리기" }));
    expect(sim.state.apps.moimroom).toBeUndefined();
  });
});

describe("HopCharlie console (platform API)", () => {
  const basePlan = {
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

  function route(calls: () => FakeCall[], plan = basePlan) {
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

  async function openApproval(plan = basePlan) {
    let calls: FakeCall[] = [];
    calls = installFetch(route(() => calls, plan));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "일반 모드로 전환" }));
    await logInAs(user);
    expect(await screen.findByText(/실제 플랫폼 API/)).toBeInTheDocument();
    window.location.hash = "#migrate-shop";
    expect(await screen.findByText(/Plan pln_1 \(revision 3\)을 승인할까요\?/)).toBeInTheDocument();
    const startCall = async () => {
      await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/migrations"))).toBe(true));
      return calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/migrations"))!;
    };
    const started = async () => JSON.parse((await startCall()).body!);
    return { user, started, startCall, calls: () => calls };
  }

  it("approves the revision on screen and starts with a read canary", async () => {
    const { user, startCall, calls } = await openApproval();
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));

    const start = await startCall();
    const approve = calls().find((c) => c.url.includes("/v1/plans/pln_1/approve"))!;
    expect(JSON.parse(approve.body!)).toEqual({ revision: 3 });
    expect(JSON.parse(start.body!)).toMatchObject({ planRef: "pln_1", canary: { weights: [10, 50, 100], stepDuration: "5s" } });
    expect(JSON.parse(start.body!).observe).toBeUndefined(); // observe stays off unless the operator turns it on
    expect(start.headers.get("Idempotency-Key")).toBeTruthy();
    expect(approve.headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("starts with the observe options the operator picked", async () => {
    const { user, started } = await openApproval();
    // auto rollback is offered only once observe is on
    expect(screen.queryByRole("checkbox", { name: /바로 롤백/ })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /전환 뒤에도 대상을 게이트로 계속 판정/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "관찰 시간" }), "5m");
    await user.click(screen.getByRole("checkbox", { name: /바로 롤백/ }));
    expect(screen.getByText(/플랫폼이 바로 롤백 run을 시작합니다/)).toBeInTheDocument();
    // the rollback row says the same, instead of "the operator decides" only
    expect(screen.getByText(/관찰 중에 게이트를 어기면 플랫폼이 롤백 run을 시작합니다\(자동 롤백\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));
    expect(await started()).toMatchObject({
      planRef: "pln_1",
      canary: { weights: [10, 50, 100], stepDuration: "5s" },
      observe: { duration: "5m", stepDuration: "20s", autoRollback: true },
    });
  });

  it("starts with the gradual canary when the operator picks it", async () => {
    const { user, started } = await openApproval();
    const canary = screen.getByRole("combobox", { name: "읽기 카나리" });
    expect(canary).toHaveValue("quick");
    expect(screen.getByText(/읽기 요청 10%, 50%, 100%를 대상으로/)).toBeInTheDocument();
    await user.selectOptions(canary, "gradual");
    // the approval text follows the steps that will be sent
    expect(screen.getByText(/읽기 요청 1%, 10%, 25%, 50%, 75%, 90%, 100%를 대상으로/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));
    expect((await started()).canary).toEqual({ weights: [1, 10, 25, 50, 75, 90, 100], stepDuration: "10s" });
  });

  it("drops auto rollback when observe is turned off again", async () => {
    const { user, started } = await openApproval();
    const observe = screen.getByRole("checkbox", { name: /전환 뒤에도 대상을 게이트로 계속 판정/ });
    await user.click(observe);
    await user.click(screen.getByRole("checkbox", { name: /바로 롤백/ }));
    await user.click(observe);
    await user.click(observe);
    expect(screen.getByRole("checkbox", { name: /바로 롤백/ })).not.toBeChecked();
    await user.click(observe);
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));
    const body = await started();
    expect(body.observe).toBeUndefined();
  });

  it("starts a plan without the platform gateway with neither canary nor observe", async () => {
    const { user, started } = await openApproval({ ...basePlan, summary: { ...basePlan.summary, gatewayMode: "none" } });
    expect(screen.getByText(/전환 후 관찰과 자동 롤백을 쓸 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /전환 뒤에도/ })).toBeNull();
    expect(screen.getByText(/카나리 없이 동기화 뒤 바로 전환 승인을 기다립니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));
    expect(await started()).toEqual({ planRef: "pln_1" });
  });

  it("shows why a start was refused and lets the operator start again", async () => {
    let started = 0;
    const calls = installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/plans") return json(200, { plans: [{ ...basePlan, status: started ? "approved" : "pending_approval" }] });
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

    // a refused start stored no Idempotency-Key, so the options may change before starting again
    expect(screen.getByRole("checkbox", { name: /전환 뒤에도/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "다시 시작" }));
    await waitFor(() => expect(started).toBe(2));
    expect(calls.filter((c) => c.url.includes("/approve"))).toHaveLength(2);
  });

  it("locks the options when it resends a start that did not finish", async () => {
    let started = 0;
    installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/plans") return json(200, { plans: [{ ...basePlan, status: started ? "approved" : "pending_approval" }] });
      if (u.pathname === "/v1/migrations" && c.method === "POST") {
        started++;
        return json(502, { error: { code: "bad_gateway", message: "upstream closed" } });
      }
      if (u.pathname === "/v1/audit") return json(200, { entries: [] });
      return route(() => [])(c);
    });
    storeSession();
    const { user } = setup("", "live");
    window.location.hash = "#migrate-shop";
    await user.click(await screen.findByRole("checkbox", { name: /전환 뒤에도/ }));
    await user.click(screen.getByRole("button", { name: "승인하고 시작" }));

    expect(await screen.findByText(/은 승인됐지만 시작하지 않았습니다/)).toBeInTheDocument();
    // the platform may have started it under the same key and would answer with that run
    expect(screen.getByRole("checkbox", { name: /전환 뒤에도/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /전환 뒤에도/ })).toBeChecked();
    expect(screen.getByText(/끝나지 않은 시작 요청을 같은 옵션으로 다시 보냅니다/)).toBeInTheDocument();
  });

  it("starts the next plan from the default options after a reject", async () => {
    let rejected = false;
    let submitted = false;
    const next = { ...basePlan, ref: "pln_2", revision: 1 };
    installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/plans" && c.method === "GET") return json(200, { plans: rejected ? [{ ...basePlan, status: "rejected" }, ...(submitted ? [next] : [])] : [basePlan] });
      if (u.pathname === "/v1/plans/pln_1/reject") {
        rejected = true;
        return json(200, { ...basePlan, status: "rejected" });
      }
      if (u.pathname === "/v1/plans/draft") return json(200, { id: "shop-eks-to-gke" });
      if (u.pathname === "/v1/plans" && c.method === "POST") {
        submitted = true;
        return json(201, next);
      }
      return route(() => [])(c);
    });
    storeSession();
    const { user } = setup("", "live");
    window.location.hash = "#migrate-shop";
    await user.click(await screen.findByRole("checkbox", { name: /전환 뒤에도/ }));
    await user.click(screen.getByRole("checkbox", { name: /바로 롤백/ }));
    await user.click(screen.getByRole("button", { name: "반려" }));
    await user.click(await screen.findByRole("button", { name: "Plan 작성" }));

    expect(await screen.findByText(/Plan pln_2 \(revision 1\)을 승인할까요\?/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /전환 뒤에도/ })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /바로 롤백/ })).toBeNull();
  });

  it("shows the plan the AI runner is writing before a Plan exists", async () => {
    const writing = fakeAgentSession({ id: "ags_3", kind: "plan", title: "shop 이전 계획 (eks → gke)" });
    installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/plans") return json(200, { plans: [] });
      if (u.pathname === "/v1/agent/sessions") return json(200, { sessions: [fakeAgentSession({ id: "ags_9", title: "other 이전 계획 (eks → gke)" }), writing] });
      if (u.pathname.startsWith("/v1/agent/sessions/")) return new Promise<Response>(() => {});
      return route(() => [])(c);
    });
    storeSession();
    setup("", "live");
    window.location.hash = "#migrate-app";
    // the AI step with the running plan session, instead of the setup form
    expect(await screen.findByText(/계획: shop 이전 계획 \(eks → gke\)/)).toBeInTheDocument();
    expect(screen.getByText("AI 작성 중")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan 작성" })).toBeNull();
  });

  it("shows a newer AI plan ahead of an older Plan still waiting for approval", async () => {
    // pln_1 was submitted at 01:00 and left pending; hopai started planning again at 02:00
    const writing = fakeAgentSession({ id: "ags_5", kind: "plan", title: "shop 이전 계획 (eks → gke)", createdAt: "2026-11-06T02:00:00Z" });
    installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/agent/sessions") return json(200, { sessions: u.searchParams.get("planRef") ? [] : [writing] });
      if (u.pathname.startsWith("/v1/agent/sessions/")) return new Promise<Response>(() => {});
      return route(() => [])(c);
    });
    storeSession();
    setup("", "live");
    window.location.hash = "#migrate-app";
    expect(await screen.findByText(/계획: shop 이전 계획 \(eks → gke\)/)).toBeInTheDocument();
    expect(screen.getByText("AI 작성 중")).toBeInTheDocument();
    expect(screen.queryByText(/Plan pln_1 \(revision 3\)을 승인할까요\?/)).toBeNull();
  });

  it("keeps a failed AI plan on screen with its reason and lets the operator go back", async () => {
    let failed = false;
    const base = { id: "ags_6", kind: "plan" as const, title: "shop 이전 계획 (eks → gke)", createdAt: "2026-11-06T02:00:00Z" };
    installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/plans") return json(200, { plans: [] });
      if (u.pathname === "/v1/agent/sessions") {
        // running at first, then failed before any Plan arrives
        const s = failed ? fakeAgentSession({ ...base, status: "failed", summary: "AI 응답이 3번 모두 검사에 걸림" }) : fakeAgentSession(base);
        return json(200, { sessions: [s] });
      }
      if (u.pathname.startsWith("/v1/agent/sessions/")) return new Promise<Response>(() => {});
      return route(() => [])(c);
    });
    storeSession();
    const { user } = setup("", "live");
    window.location.hash = "#migrate-app";
    expect(await screen.findByText("AI 작성 중")).toBeInTheDocument();
    failed = true;
    expect(await screen.findByText("AI 계획 실패", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/AI가 Plan을 내지 못하고 끝났습니다: AI 응답이 3번 모두 검사에 걸림/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "설정으로 돌아가기" }));
    expect(await screen.findByRole("button", { name: "Plan 작성" })).toBeInTheDocument();
  });

  it("moves from the AI plan to the Plan it submits", async () => {
    let done = false;
    const base = { id: "ags_7", kind: "plan" as const, title: "shop 이전 계획 (eks → gke)", createdAt: "2026-11-06T02:00:00Z" };
    const submitted = { ...basePlan, ref: "pln_2", revision: 1, submittedAt: "2026-11-06T02:01:00Z" };
    installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      // the old pln_1 stays pending; pln_2 appears once the plan session has finished
      if (u.pathname === "/v1/plans") return json(200, { plans: done ? [basePlan, submitted] : [basePlan] });
      if (u.pathname === "/v1/agent/sessions") {
        if (u.searchParams.get("planRef")) return json(200, { sessions: [] });
        return json(200, { sessions: [fakeAgentSession(done ? { ...base, status: "succeeded" } : base)] });
      }
      if (u.pathname.startsWith("/v1/agent/sessions/")) return new Promise<Response>(() => {});
      return route(() => [])(c);
    });
    storeSession();
    setup("", "live");
    window.location.hash = "#migrate-app";
    expect(await screen.findByText("AI 작성 중")).toBeInTheDocument();
    done = true;
    expect(await screen.findByText(/Plan pln_2 \(revision 1\)을 승인할까요\?/, undefined, { timeout: 8000 })).toBeInTheDocument();
  }, 15000);

  it("lists the plan session behind a submitted Plan through its rehearsal", async () => {
    const rehearsal = fakeAgentSession({ id: "ags_4", kind: "rehearsal", title: "샌드박스 리허설 (shop-eks-to-gke)", planRef: "pln_1", status: "succeeded" });
    const planned = fakeAgentSession({ id: "ags_3", kind: "plan", title: "shop 이전 계획 (eks → gke)", status: "succeeded" });
    installFetch((c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/agent/sessions") return json(200, { sessions: u.searchParams.get("planRef") === "pln_1" ? [rehearsal] : [] });
      if (u.pathname === "/v1/agent/sessions/ags_4/events" && u.searchParams.get("format") === "json")
        return json(200, { events: [{ seq: 1, sessionId: "ags_4", time: "2026-11-04T00:00:00Z", type: "message", tool: "plan", output: { planRef: "pln_1", planSession: "ags_3", planId: "shop-eks-to-gke" } }] });
      if (u.pathname === "/v1/agent/sessions/ags_3") return json(200, planned);
      if (u.pathname.startsWith("/v1/agent/sessions/")) return new Promise<Response>(() => {});
      return route(() => [])(c);
    });
    storeSession();
    setup("", "live");
    window.location.hash = "#migrate-app";
    expect(await screen.findByText(/Plan pln_1 \(revision 3\)을 승인할까요\?/)).toBeInTheDocument();
    // the plan session has no planRef: it comes in through the rehearsal that names it
    expect(await screen.findByText("shop 이전 계획 (eks → gke)")).toBeInTheDocument();
    expect(screen.getByText("샌드박스 리허설 (shop-eks-to-gke)")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { level: 1, name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.getByLabelText("아이디")).toHaveFocus();
    expect(screen.getByLabelText("아이디")).toHaveAttribute("maxLength", "64");
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute("maxLength", "256");
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

    answer = () => error(400, "invalid_request");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("아이디나 비밀번호 형식이 맞지 않습니다"));

    answer = () => error(500, "internal");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("서버 오류로 로그인하지 못했습니다. 잠시 뒤에 다시 시도하세요"));

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
    expect(out.keepalive).toBe(true);

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

  it("does not log in when the operator goes to demo mode while the login is in flight", async () => {
    let answer!: (r: Response) => void;
    const held = new Promise<Response>((r) => (answer = r));
    const calls = installFetch(() => held);
    const { user } = setup("", "live");
    await logInAs(user);
    expect(screen.getByRole("button", { name: "로그인하는 중" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "로그인하지 않고 데모 모드로 보기" }));
    expect(calls[0].signal?.aborted).toBe(true);
    answer(json(200, fakeSession()));
    await act(async () => {});
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("demo");
    expect(localStorage.getItem("hopcharlie.session")).toBeNull();
  });

  it("drops the session when it expires while the console is open", async () => {
    installFetch(notFound);
    storeSession(new Date(Date.now() + 300).toISOString());
    setup("", "live");
    expect(screen.getByText(/실제 플랫폼 API/)).toBeInTheDocument();
    expect(await screen.findByText("세션이 만료되었습니다. 다시 로그인하세요", undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.session")).toBeNull();
  });

  it("checks the expiry again when the page shows after a sleep and before switching to live", async () => {
    installFetch(notFound);
    storeSession();
    setup("", "live");
    // the timer has not fired yet, as after a laptop slept past expiresAt
    const later = Date.now() + 2 * 3_600_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("세션이 만료되었습니다. 다시 로그인하세요")).toBeInTheDocument();
    vi.restoreAllMocks();

    cleanup();
    storeSession();
    const { user } = setup("", "demo");
    vi.spyOn(Date, "now").mockReturnValue(later);
    await user.click(screen.getByRole("button", { name: "일반 모드로 전환" }));
    expect(screen.queryByText(/실제 플랫폼 API/)).not.toBeInTheDocument();
    expect(screen.getByText("세션이 만료되었습니다. 다시 로그인하세요")).toBeInTheDocument();
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
  // an approval answers with the role it got and, as the server does, 10 more minutes to pick the token up
  const reviewed = (action: string, c: FakeCall) =>
    json(
      200,
      action === "approve"
        ? { ...pending, status: "approved", reviewedBy: "admin", role: JSON.parse(c.body!).role, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }
        : { ...pending, status: "denied", reviewedBy: "admin" },
    );

  function route(review: (action: string, c: FakeCall) => Response = reviewed) {
    return (c: FakeCall) => {
      const u = new URL(c.url, "http://x");
      if (u.pathname === "/v1/auth/login") return json(200, fakeSession());
      if (u.pathname === "/v1/auth/device/BCDF-GHJK" && c.method === "GET") return json(200, pending);
      const m = /^\/v1\/auth\/device\/BCDF-GHJK\/(approve|deny)$/.exec(u.pathname);
      if (m && c.method === "POST") return review(m[1], c);
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
    expect(within(req).getByText(/승인하면 그 CLI가 30일 동안 내 이름과 고른 역할로 동작합니다/)).toBeInTheDocument();
    expect(within(req).getByText("봇(Rin 등)에게는 꼭 필요한 역할만 주세요. 배포를 맡길 때만 관리자를 고릅니다.")).toBeInTheDocument();

    // no role is picked for the administrator, and approving waits for one
    const roles = within(req).getAllByRole("radio");
    expect(roles.map((r) => (r as HTMLInputElement).value)).toEqual(["operator", "agent", "viewer"]);
    expect(roles.some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(within(req).getByRole("radio", { name: "관리자 (배포, 앱 등록과 삭제, Plan 승인까지 모두)" })).toBeInTheDocument();
    expect(within(req).getByRole("radio", { name: "조회만" })).toBeInTheDocument();
    const approve = within(req).getByRole("button", { name: "승인" });
    expect(approve).toBeDisabled();
    await user.click(within(req).getByRole("radio", { name: "조회와 Plan 제출 (승인과 배포는 못 함)" }));
    expect(approve).toBeEnabled();
    await user.click(approve);

    expect(await screen.findByText("CLI 로그인을 승인했습니다 (역할: 조회와 Plan 제출 (agent)). CLI가 곧 로그인을 마칩니다.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "CLI 로그인 요청" })).not.toBeInTheDocument();
    expect(calls.map((c) => c.method + " " + c.url)).toEqual(["GET /v1/auth/device/BCDF-GHJK", "POST /v1/auth/device/BCDF-GHJK/approve"]);
    expect(JSON.parse(calls[1].body!)).toEqual({ role: "agent" });
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
    const req = await screen.findByRole("region", { name: "CLI 로그인 요청" });
    await user.click(within(req).getByRole("radio", { name: "조회만" }));
    await user.click(within(req).getByRole("button", { name: "승인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 승인 또는 거절된 요청입니다");
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  it("explains a session that is not a console login and a role the server refused", async () => {
    storeSession();
    let lookupAnswer = () => json(403, { error: { code: "console_session_required", message: "only a console session may approve" } });
    installFetch((c) => {
      if (c.method === "GET") return lookupAnswer();
      return json(400, { error: { code: "invalid_request", message: "unknown role" } });
    });
    const { user } = setup("#device", "live");
    await lookUp(user, "BCDF-GHJK");
    expect(await screen.findByRole("alert")).toHaveTextContent("CLI 로그인 승인은 콘솔에 비밀번호로 로그인한 세션에서만 할 수 있습니다");

    lookupAnswer = () => json(200, pending);
    await lookUp(user, "BCDF-GHJK");
    const req = await screen.findByRole("region", { name: "CLI 로그인 요청" });
    await user.click(within(req).getByRole("radio", { name: /^관리자/ }));
    await user.click(within(req).getByRole("button", { name: "승인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("역할을 고르지 않았거나 서버가 모르는 역할입니다");
  });

  it("shows who approved an already approved request and the role it got", async () => {
    storeSession();
    installFetch(() => json(200, { ...pending, status: "approved", reviewedBy: "admin", role: "operator" }));
    const { user } = setup("#device", "live");
    await lookUp(user, "BCDF-GHJK");
    const req = await screen.findByRole("region", { name: "CLI 로그인 요청" });
    expect(within(req).getByText("이미 승인된 요청입니다 (admin, 역할: 관리자 (operator)).")).toBeInTheDocument();
    expect(within(req).queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(within(req).queryByRole("radio")).not.toBeInTheDocument();
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

  it("keeps the code fixed while a lookup is in flight", async () => {
    storeSession();
    let answer!: (r: Response) => void;
    const held = new Promise<Response>((r) => (answer = r));
    installFetch(() => held);
    const { user } = setup("#device", "live");
    await lookUp(user, "bcdf-ghjk");
    const input = screen.getByLabelText("CLI가 보여 준 코드");
    expect(input).toHaveAttribute("readonly");
    await user.type(input, "x");
    expect(input).toHaveValue("BCDF-GHJK");
    answer(json(200, pending));
    expect(await screen.findByRole("region", { name: "CLI 로그인 요청" })).toBeInTheDocument();
    expect(input).not.toHaveAttribute("readonly");
  });

  it("counts the remaining minutes down", async () => {
    // only the interval and the clock: React and Testing Library keep their real timers
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    storeSession();
    installFetch(route());
    setup("#device", "live");
    fireEvent.change(screen.getByLabelText("CLI가 보여 준 코드"), { target: { value: "bcdf-ghjk" } });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    const req = await screen.findByRole("region", { name: "CLI 로그인 요청" });
    expect(within(req).getByText("9분")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(within(req).getByText("7분")).toBeInTheDocument();
    expect(within(req).getByText(/3분 전/)).toBeInTheDocument();
  });

  it("leaves #device when switching to demo mode from the header", async () => {
    storeSession();
    installFetch(route());
    const { user } = setup("#device", "live");
    await user.click(screen.getByRole("button", { name: "데모 모드로 전환" }));
    await waitFor(() => expect(window.location.hash).toBe("#overview"));
    expect(screen.getByText(/시연용 화면입니다/)).toBeInTheDocument();
    expect(localStorage.getItem("hopcharlie.mode")).toBe("demo");
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

describe("several tabs", () => {
  const notFound = () => json(404, { error: { code: "not_found", message: "no" } });
  const s1 = fakeSession({ token: "s1" });
  const s2 = fakeSession({ token: "s2", principal: { name: "admin2", role: "operator" } });
  const KEY = "hopcharlie.session";

  /** Another tab writes `value` (null removes it); only this tab gets the storage event, as in a browser. */
  function otherTab(value: string | null) {
    const oldValue = localStorage.getItem(KEY);
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, oldValue, newValue: value }));
    });
  }

  it("goes back to the login screen without the expired message after a logout in another tab", () => {
    localStorage.setItem(KEY, JSON.stringify(s1));
    installFetch(notFound);
    setup("", "live");
    expect(screen.getByText(/실제 플랫폼 API/)).toBeInTheDocument();
    otherTab(null);
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.queryByText(/세션이 만료되었습니다/)).not.toBeInTheDocument();
  });

  it("picks up a login made in another tab", () => {
    installFetch(notFound);
    setup("", "live");
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    otherTab(JSON.stringify(s2));
    expect(screen.getByText(/실제 플랫폼 API/)).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("admin2")).toBeInTheDocument();
  });

  it("takes over a newer session stored by another tab instead of wiping it on a 401", async () => {
    localStorage.setItem(KEY, JSON.stringify(s1));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = installFetch(async (c) => {
      if (c.headers.get("Authorization") === "Bearer s1") {
        await gate;
        return json(401, { error: { code: "unauthorized", message: "missing or invalid token" } });
      }
      return notFound();
    });
    const { user } = setup("", "live");
    // meanwhile another tab logged out and in again, and this tab missed the event
    localStorage.setItem(KEY, JSON.stringify(s2));
    release();
    await waitFor(() => expect(within(screen.getByRole("banner")).getByText("admin2")).toBeInTheDocument());
    expect(screen.queryByRole("form", { name: "관리자 로그인" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY)!).token).toBe("s2");

    await user.click(screen.getByRole("link", { name: "환경" }));
    await waitFor(() => expect(calls.some((c) => c.headers.get("Authorization") === "Bearer s2")).toBe(true));
  });

  it("does not remove another tab's newer session when logging out", async () => {
    localStorage.setItem(KEY, JSON.stringify(s1));
    const calls = installFetch((c) => (c.url.endsWith("/v1/auth/logout") ? new Response(null, { status: 204 }) : notFound()));
    const { user } = setup("", "live");
    localStorage.setItem(KEY, JSON.stringify(s2)); // no event: this tab still holds s1
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "로그아웃" }));
    expect(screen.getByRole("form", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/v1/auth/logout"))!.headers.get("Authorization")).toBe("Bearer s1");
    expect(JSON.parse(localStorage.getItem(KEY)!).token).toBe("s2");
  });

  it("ends a session on 401 when no other tab stored a newer one", async () => {
    localStorage.setItem(KEY, JSON.stringify(s1));
    installFetch(() => json(401, { error: { code: "unauthorized", message: "missing or invalid token" } }));
    setup("", "live");
    expect(await screen.findByText("세션이 만료되었습니다. 다시 로그인하세요")).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
