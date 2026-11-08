import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeSession, hang, installFetch, json, sse, type FakeCall, type FakeHandler } from "../api/fakes";
import type { Onboarding, OnboardingEvent } from "../api/types";
import { chooseMode, initAuth, startSession } from "../data/live";
import { createSim, SimProvider, type Sim } from "../sim/store";
import { deleteText, FINDING_TEXT, Onboard, repoProblem, urlCheck } from "./Onboard";

afterEach(() => {
  localStorage.clear();
  initAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

const T = "2026-11-07T03:00:00Z";
const HEAD = "c07e4b8a1d2e3f405162738495a6b7c8d9e0f1a2";

function onb(p: Partial<Onboarding> = {}): Onboarding {
  return {
    id: "onb-3f9a1c2b7d4e",
    repo: "2026-Softbank-Hackathon-Charlie/moimroom-legacy",
    serviceUrl: "https://moimroom-legacy.hopcharlie.dev",
    app: "moimroom-legacy",
    targetEnv: "eks",
    state: "discovering",
    deleting: false,
    legacyDeployStopped: false,
    humanActions: [],
    report: { blockers: [], warnings: [] },
    legacyChanges: [],
    createdBy: "admin",
    createdAt: T,
    updatedAt: T,
    ...p,
  };
}

const awaiting = (p: Partial<Onboarding> = {}) =>
  onb({
    state: "awaiting_approval",
    facts: { cloud: "aws", region: "ap-northeast-2", instanceId: "i-0abc1234def567890", deployWorkflows: [".github/workflows/deploy.yml"], dbImage: "postgres:17.11-alpine" },
    report: {
      blockers: [],
      warnings: [{ code: "reindex_required", message: "text index", subject: "app.members_name_idx" }],
      drift: { head: "9d2b71f3c0a4", lastDeployCommit: "5be0c31d9a8f" },
      holdSeconds: 18,
      holdBudgetSeconds: 40,
    },
    pr: { number: 12, url: "https://github.com/2026-Softbank-Hackathon-Charlie/moimroom-legacy/pull/12", headSha: HEAD },
    check: { app: "onb-3f9a1c2b7d4e", result: "passed", attempts: 1, startSeconds: 14.2 },
    plannedLegacyChanges: [{ kind: "hba_line_added", target: "pg_hba.conf", detail: "host replication hopcharlie_replicator 172.18.0.0/16 scram-sha-256" }],
    ...p,
  });

const snap = (o: Onboarding) => `event: snapshot\ndata: ${JSON.stringify(o)}\n\n`;
const evMsg = (e: Partial<OnboardingEvent> & { seq: number }) => {
  const ev: OnboardingEvent = { onboardingId: "onb-3f9a1c2b7d4e", time: T, state: "discovering", kind: "step", ...e };
  return `id: ${ev.seq}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`;
};

/** GET events answers the snapshot (and events), then stays open; `routes` answers the rest by "METHOD path". */
function live(o: Onboarding, routes: Record<string, FakeHandler> = {}, events: string[] = [], role: "operator" | "viewer" = "operator"): FakeCall[] {
  startSession(fakeSession({ principal: { name: "admin", role } }));
  return installFetch((call) => {
    const path = new URL(call.url, "http://x").pathname;
    const key = call.method + " " + path;
    if (routes[key]) return routes[key](call);
    if (key === "GET /v1/onboardings/" + o.id + "/events") return sse([snap(o), ...events], "hang")(call);
    return hang(call);
  });
}

function show(id?: string, sim: Sim = createSim()) {
  const user = userEvent.setup();
  render(
    <SimProvider sim={sim} intervalMs={0}>
      <Onboard id={id} />
    </SimProvider>,
  );
  return { user, sim };
}

const posted = (calls: FakeCall[], path: string) => calls.filter((c) => c.method !== "GET" && c.url.endsWith(path));

describe("form checks", () => {
  it("explains a repo or service URL it would not send", () => {
    expect(repoProblem("owner/name")).toBe("");
    expect(repoProblem("owner/name.git")).toBe("");
    expect(repoProblem("https://github.com/o/n")).toMatch(/owner\/name만/);
    expect(urlCheck("https://moimroom-legacy.hopcharlie.dev")).toEqual({ app: "moimroom-legacy", problem: "" });
    expect(urlCheck("http://a.hopcharlie.dev").problem).toMatch(/https/);
    expect(urlCheck("https://a.example.com").problem).toMatch(/형식이어야/);
    expect(urlCheck("https://a.hopcharlie.dev/path").problem).toMatch(/형식이어야/);
  });

  it("has a Korean text for every finding code", () => {
    for (const v of Object.values(FINDING_TEXT)) expect(v).toMatch(/[가-힣]/);
  });

  it("says what DELETE undoes, by state", () => {
    expect(deleteText(awaiting())).toMatch(/PR #12을 닫고/);
    expect(deleteText(onb({ state: "syncing", legacyChanges: [{ kind: "hba_line_added", target: "pg_hba.conf", at: T }] }))).toMatch(/1개.*거꾸로 되돌리고.*머지한 PR은 되돌리지 않습니다/);
    expect(deleteText(onb({ state: "failed", failedState: "connecting" }))).toMatch(/거꾸로/);
  });
});

describe("live: list and start", () => {
  it("lists onboardings and starts one, then opens it", async () => {
    startSession(fakeSession());
    const calls = installFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/v1/onboardings")) return json(200, { onboardings: [onb({ state: "syncing" })] });
      if (call.method === "POST" && call.url.endsWith("/v1/onboardings")) return json(202, onb({ id: "onb-aaaaaaaaaaaa" }));
      if (call.url.endsWith("/v1/envs")) return json(200, { environments: [] });
      return hang(call);
    });
    const { user } = show();
    const list = await screen.findByRole("region", { name: "가져오기 목록" });
    expect(await within(list).findByText("moimroom-legacy")).toBeInTheDocument();
    expect(within(list).getByText("동기화")).toBeInTheDocument();

    await user.type(screen.getByLabelText("GitHub 레포"), "https://github.com/x/y");
    await user.type(screen.getByLabelText("서비스 주소"), "https://moimroom-legacy.hopcharlie.dev");
    expect(screen.getByText("앱 이름: moimroom-legacy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "조사 시작" }));
    expect(screen.getByText(/owner\/name만 적으세요/)).toBeInTheDocument();
    expect(posted(calls, "/v1/onboardings")).toHaveLength(0);

    await user.clear(screen.getByLabelText("GitHub 레포"));
    await user.type(screen.getByLabelText("GitHub 레포"), "2026-Softbank-Hackathon-Charlie/moimroom-legacy");
    await user.click(screen.getByRole("button", { name: "조사 시작" }));
    await waitFor(() => expect(window.location.hash).toBe("#onboard-onb-aaaaaaaaaaaa"));
    expect(JSON.parse(posted(calls, "/v1/onboardings")[0].body!)).toEqual({ repo: "2026-Softbank-Hackathon-Charlie/moimroom-legacy", serviceUrl: "https://moimroom-legacy.hopcharlie.dev" });
  });

  it("says the server is still building it on 501", async () => {
    startSession(fakeSession());
    installFetch((call) => {
      if (call.url.endsWith("/v1/onboardings")) return json(501, { error: { code: "not_implemented", message: "onboarding is not implemented yet" } });
      return hang(call);
    });
    show();
    expect(await screen.findByText(/실행기가 설정되어 있지 않습니다 \(501\)/)).toBeInTheDocument();
  });

  it("hides the start form when the feature is off", async () => {
    startSession(fakeSession());
    installFetch((call) => (call.url.endsWith("/v1/onboardings") ? json(501, { error: { code: "not_implemented", message: "no runner" } }) : hang(call)));
    show();
    await screen.findByText(/실행기가 설정되어 있지 않습니다/);
    expect(screen.queryByRole("button", { name: "조사 시작" })).not.toBeInTheDocument();
  });

  it("shows a viewer the list without the start form", async () => {
    startSession(fakeSession({ principal: { name: "viewer", role: "viewer" } }));
    installFetch((call) => (call.url.endsWith("/v1/onboardings") ? json(200, { onboardings: [] }) : hang(call)));
    show();
    expect(screen.getByText(/operator 역할만 할 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "조사 시작" })).not.toBeInTheDocument();
  });
});

describe("live: detail by state", () => {
  it("discovering shows the stepper, the GitHub App link and checks again on 다시 확인", async () => {
    const calls = live(
      onb({ humanActions: [{ kind: "install_github_app", url: "https://github.com/apps/hopcharlie-platform/installations/new", done: false }] }),
      { "POST /v1/onboardings/onb-3f9a1c2b7d4e/resume": () => json(202, onb()) },
      [evMsg({ seq: 1, kind: "human", message: "GitHub App이 레포를 읽지 못합니다" })],
    );
    const { user } = show("onb-3f9a1c2b7d4e");
    const steps = await screen.findByRole("list", { name: "가져오기 단계" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent)).toEqual(["조사", "계약 PR", "시험", "승인", "원본 연결", "등록", "동기화", "전환 준비", "전환", "정리", "완료"]);
    expect(within(steps).getByText("조사").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "GitHub App 설치하기" })).toHaveAttribute("href", "https://github.com/apps/hopcharlie-platform/installations/new");
    expect(await screen.findByText(/GitHub App이 레포를 읽지 못합니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() => expect(posted(calls, "/resume")).toHaveLength(1));
  });

  it("awaiting_approval shows the report, drift, PR, check and plan, and approves with the visible head", async () => {
    let n = 0;
    const calls = live(awaiting(), {
      "POST /v1/onboardings/onb-3f9a1c2b7d4e/approve": () =>
        n++ === 0 ? json(409, { error: { code: "pr_head_mismatch", message: "head moved" } }) : json(202, onb({ state: "connecting", legacyDeployStopped: true })),
    });
    const { user } = show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText(FINDING_TEXT.reindex_required)).toBeInTheDocument();
    expect(screen.getByText("지금 도는 코드가 기본 브랜치와 다를 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #12" })).toHaveAttribute("href", expect.stringMatching(/\/pull\/12$/));
    expect(screen.getByRole("link", { name: "변경 보기" })).toHaveAttribute("href", expect.stringMatching(/\/pull\/12\/files$/));
    expect(screen.getByText("14.2초 (보류 예산 40초 안)")).toBeInTheDocument();
    const appr = screen.getByRole("region", { name: "승인" });
    expect(within(appr).getByText("host replication hopcharlie_replicator 172.18.0.0/16 scram-sha-256")).toBeInTheDocument();
    expect(within(appr).getByText(/배포 workflow를 끕니다/)).toBeInTheDocument();

    await user.click(within(appr).getByRole("button", { name: "PR head c07e4b8로 승인" }));
    const confirm = within(appr).getByRole("group", { name: "승인 확인" });
    expect(confirm).toHaveTextContent("꺼지는 배포 workflow: .github/workflows/deploy.yml");
    expect(confirm).toHaveTextContent("원본 VM과 DB에 할 일: pg_hba 줄 추가 pg_hba.conf");
    await user.click(within(confirm).getByRole("button", { name: "승인" }));
    expect(await screen.findByText(/PR이 화면의 head와 다릅니다\(push했거나 닫힘\).*: head moved/)).toBeInTheDocument();
    expect(JSON.parse(posted(calls, "/approve")[0].body!)).toEqual({ headSha: HEAD });

    await user.click(within(appr).getByRole("button", { name: "PR head c07e4b8로 승인" }));
    await user.click(within(appr).getByRole("button", { name: "승인" }));
    expect(await screen.findByRole("status", { name: "원본 배포 멈춤" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "승인" })).not.toBeInTheDocument();
  });

  it("syncing shows the DNS record to delete, the metrics and the legacy changes", async () => {
    const o = onb({
      state: "syncing",
      legacyDeployStopped: true,
      humanActions: [{ kind: "delete_dns_record", record: { name: "moimroom-legacy.hopcharlie.dev", type: "A", value: "203.0.113.10" }, done: false }],
      legacyChanges: [{ kind: "workflow_disabled", target: ".github/workflows/deploy.yml", at: T }],
    });
    const calls = live(o, { "POST /v1/onboardings/onb-3f9a1c2b7d4e/resume": () => json(202, o) }, [evMsg({ seq: 1, state: "syncing", message: "동기화 확인", data: { lagSeconds: 0.4, filesPending: 3 } })]);
    const { user } = show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText("moimroom-legacy.hopcharlie.dev A 203.0.113.10")).toBeInTheDocument();
    expect(await screen.findByText("0.4초 (기준 2초)")).toBeInTheDocument();
    expect(screen.getByText("남은 파일")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "원본에 더한 것" })).getByText(".github/workflows/deploy.yml")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "원본 배포 멈춤" })).toHaveTextContent(".github/workflows/deploy.yml");
    await user.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() => expect(posted(calls, "/resume")).toHaveLength(1));

    // delete from syncing undoes the legacy changes
    await user.click(screen.getByRole("button", { name: "가져오기 삭제" }));
    const box = screen.getByRole("group", { name: "가져오기 삭제 확인" });
    expect(box).toHaveTextContent("원본에 더한 1개");
    await user.click(within(box).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
  });

  it("ready cuts over and then links the migration run", async () => {
    const calls = live(onb({ state: "ready", report: { blockers: [], warnings: [], holdSeconds: 18 } }), {
      "POST /v1/onboardings/onb-3f9a1c2b7d4e/cutover": () => json(202, onb({ state: "cutting_over", runId: "run_42" })),
    });
    const { user } = show("onb-3f9a1c2b7d4e");
    await user.click(await screen.findByRole("button", { name: "전환" }));
    const confirm = screen.getByRole("group", { name: "전환 확인" });
    expect(confirm).toHaveTextContent("쓰기를 약 18초 보류합니다(예상).");
    expect(confirm).toHaveTextContent("원본으로 되돌리지 않습니다");
    expect(posted(calls, "/cutover")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "전환 시작" }));
    await waitFor(() => expect(posted(calls, "/cutover")).toHaveLength(1));
    const run = await screen.findByRole("region", { name: "전환 run" });
    expect(within(run).getByText("run_42")).toBeInTheDocument();
    expect(within(run).getByRole("link", { name: "이전 화면에서 보기" })).toHaveAttribute("href", "#migrate-app?app=moimroom-legacy");
    expect(screen.queryByRole("button", { name: "가져오기 삭제" })).not.toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/v1/migrations/run_42/events"))).toBe(true));
  });

  it("decommissioning asks before stopping the instance", async () => {
    const calls = live(onb({ state: "decommissioning", runId: "run_42", facts: { instanceId: "i-0abc" } }), {
      "POST /v1/onboardings/onb-3f9a1c2b7d4e/decommission": () => json(202, onb({ state: "done" })),
    }, [evMsg({ seq: 1, state: "decommissioning", kind: "human", message: "confirm stopping the instance" })]);
    const { user } = show("onb-3f9a1c2b7d4e");
    await user.click(await screen.findByRole("button", { name: "원본 중지" }));
    const box = screen.getByRole("group", { name: "원본 중지 확인" });
    expect(box).toHaveTextContent("i-0abc을(를) 중지할까요?");
    await user.click(within(box).getByRole("button", { name: "중지" }));
    expect(await screen.findByText("moimroom-legacy을(를) 가져왔습니다.")).toBeInTheDocument();
    expect(posted(calls, "/decommission")).toHaveLength(1);
  });

  it("failed shows why and retries with resume; blockers are listed", async () => {
    const calls = live(onb({ state: "failed", failedState: "checking", failure: "test deploy unhealthy twice" }), {
      "POST /v1/onboardings/onb-3f9a1c2b7d4e/resume": () => json(202, onb({ state: "checking" })),
    });
    const { user } = show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText("시험 단계에서 멈췄습니다.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(posted(calls, "/resume")).toHaveLength(1));
  });

  it("a blocked discovery shows the blocker and the PR-closing delete text", async () => {
    live(onb({ state: "failed", failedState: "discovering", report: { blockers: [{ code: "managed_database", message: "RDS" }], warnings: [] } }));
    const { user } = show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText(FINDING_TEXT.managed_database)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument(); // resume checks again after a fix
    await user.click(screen.getByRole("button", { name: "가져오기 삭제" }));
    expect(screen.getByRole("group", { name: "가져오기 삭제 확인" })).toHaveTextContent("원본은 아직 바꾸지 않았습니다");
  });

  it("a finished deletion (404) says it is gone", async () => {
    startSession(fakeSession());
    installFetch((call) => (call.url.endsWith("/events") ? json(404, { error: { code: "onboarding_not_found", message: "no" } }) : hang(call)));
    show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText(/이 가져오기는 없습니다/)).toBeInTheDocument();
  });
});

describe("live: roles, retries and a repository without a PR", () => {
  it("hides every action from a viewer", async () => {
    live(awaiting({ state: "failed", failedState: "checking" }), {}, [], "viewer");
    show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText(/operator 역할만 할 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "가져오기 삭제" })).not.toBeInTheDocument();
  });

  it("approves the default branch head when there is no PR", async () => {
    const calls = live(awaiting({ pr: undefined, facts: { head: "9d2b71f3c0a4e5b6", deployWorkflows: [] } }), {
      "POST /v1/onboardings/onb-3f9a1c2b7d4e/approve": () => json(202, onb({ state: "connecting" })),
    });
    const { user } = show("onb-3f9a1c2b7d4e");
    await user.click(await screen.findByRole("button", { name: "기본 브랜치 head 9d2b71f로 승인" }));
    await user.click(screen.getByRole("button", { name: "승인" }));
    await waitFor(() => expect(JSON.parse(posted(calls, "/approve")[0].body!)).toEqual({ headSha: "9d2b71f3c0a4e5b6" }));
  });

  it("offers the delete again only after a failed undo step", async () => {
    live(onb({ state: "syncing", deleting: true }));
    show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText("삭제하는 중입니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제 다시 시도" })).not.toBeInTheDocument();
    cleanup();
    live(onb({ state: "syncing", deleting: true, failure: "tailscale container: exit 1" }));
    show("onb-3f9a1c2b7d4e");
    expect(await screen.findByRole("button", { name: "삭제 다시 시도" })).toBeInTheDocument();
  });

  it("says it reconnects when the stream drops after a snapshot", async () => {
    startSession(fakeSession());
    installFetch((call) => (call.url.endsWith("/events") ? sse([snap(onb())], "drop")(call) : hang(call)));
    show("onb-3f9a1c2b7d4e");
    expect(await screen.findByText("다시 연결 중")).toBeInTheDocument();
  });
});

describe("demo", () => {
  it("walks through every state with the same screens", async () => {
    act(() => chooseMode("demo"));
    const sim = createSim();
    const { user } = show(undefined, sim);
    const ticks = (n: number) => act(() => { for (let i = 0; i < n; i++) sim.tick(); });
    await user.click(screen.getByRole("button", { name: "조사 시작" }));
    expect(sim.state.onb.doc?.state).toBe("discovering");
    ticks(60);
    const appr = screen.getByRole("region", { name: "승인" });
    await user.click(within(appr).getByRole("button", { name: /^PR head .+로 승인$/ }));
    await user.click(within(appr).getByRole("button", { name: "승인" }));
    ticks(40);
    expect(screen.getByRole("status", { name: "원본 배포 멈춤" })).toBeInTheDocument();
    expect(screen.getByText("moimroom.hopcharlie.dev A 203.0.113.10", { selector: "code" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 확인" }));
    ticks(20);
    await user.click(screen.getByRole("button", { name: "전환" }));
    await user.click(screen.getByRole("button", { name: "전환 시작" }));
    ticks(30);
    await user.click(screen.getByRole("button", { name: "원본 중지" }));
    await user.click(within(screen.getByRole("group", { name: "원본 중지 확인" })).getByRole("button", { name: "중지" }));
    expect(sim.state.onb.doc?.state).toBe("done");
    expect(sim.state.apps.moimroom).toBeDefined();
  });

  it("does not run the demo in live mode", () => {
    startSession(fakeSession());
    installFetch(hang);
    const sim = createSim();
    const before = JSON.stringify(sim.state);
    show(undefined, sim);
    expect(screen.queryByRole("button", { name: "가져오기 완료 상태로 건너뛰기" })).not.toBeInTheDocument();
    expect(JSON.stringify(sim.state)).toBe(before);
  });
});
