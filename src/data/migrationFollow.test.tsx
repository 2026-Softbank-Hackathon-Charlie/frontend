import { act, renderHook } from "@testing-library/react";
import { fakeAgentSession, fakeRun } from "../api/fakes";
import type { AgentSession, App, PlanRecord, Run } from "../api/types";

// The live hook reads the platform through these hooks; each test sets what the lists answer.
const lists: { runs: Run[]; plans: PlanRecord[]; sessions: AgentSession[] } = { runs: [], plans: [], sessions: [] };
const watched: (string | null)[] = [];
const res = <T,>(data: T | undefined) => ({ data, error: undefined, loading: false, reload: () => {} });
const app = { name: "shop", namespace: "shop", database: { name: "app", user: "app", schemas: [] }, environments: ["gke", "eks"].map((env) => ({ env, cnpgCluster: "shop-db", dbHost: "h" })) } as App;

vi.mock("../api/hooks", async (orig) => ({
  ...(await orig<typeof import("../api/hooks")>()),
  useApps: () => res([app]),
  useRuns: () => res(lists.runs),
  useRun: (id: string | null) => {
    watched.push(id);
    return { run: id ? lists.runs.find((r) => r.runId === id) : undefined, events: [], connected: !!id, error: undefined };
  },
  useAIRuns: () => res([]),
  useAgentSessions: () => res(lists.sessions),
  useAgentSession: () => ({ session: undefined, events: [], connected: false, error: undefined }),
  useApp: () => res(undefined),
  useTraffic: () => res(undefined),
}));
vi.mock("./live", async (orig) => ({ ...(await orig<typeof import("./live")>()), usePlans: () => res(lists.plans) }));
vi.mock("../api/client", async (orig) => ({ ...(await orig<typeof import("../api/client")>()), listAudit: () => Promise.resolve({ entries: [] }) }));

const { useLiveMigration } = await import("./migration");

const plan = (p: Partial<PlanRecord> = {}): PlanRecord =>
  ({
    ref: "pln_1",
    status: "pending_approval",
    revision: 1,
    summary: { app: "shop", source: { env: "gke", namespace: "shop", cluster: "shop-db" }, target: { env: "eks", namespace: "shop", cluster: "shop-db" } },
    submittedBy: "operator",
    submittedAt: "2026-11-07T00:00:00Z",
    ...p,
  }) as PlanRecord;

beforeEach(() => {
  lists.runs = [];
  lists.plans = [];
  lists.sessions = [];
  watched.length = 0;
  window.location.hash = "#migrate-app?app=shop";
});

describe("the live migration page follows a run started elsewhere", () => {
  it("follows the run another browser started from the Plan on screen", () => {
    lists.plans = [plan()];
    const { result, rerender } = renderHook(() => useLiveMigration());
    expect(result.current.stage).toBe("review");
    expect(result.current.plan?.ref).toBe("pln_1");

    // B approved and started the plan; the next polls of the lists show it
    lists.plans = [plan({ status: "started" })];
    lists.runs = [fakeRun({ runId: "run_b", planRef: "pln_1" })];
    act(() => rerender());
    expect(watched.at(-1)).toBe("run_b");
    expect(result.current.stage).toBe("run");
    expect(result.current.run?.runId).toBe("run_b");
  });

  it("keeps the existing rule: a halted run the operator closed with reset is not taken up again", () => {
    lists.runs = [fakeRun({ runId: "run_h", planRef: "pln_1", status: "halted", phase: "done", endedAt: "2026-11-07T00:10:00Z" })];
    lists.plans = [plan({ status: "started" })];
    const { result, rerender } = renderHook(() => useLiveMigration());
    expect(result.current.run?.runId).toBe("run_h");
    act(() => result.current.reset());
    act(() => rerender());
    expect(result.current.run).toBeUndefined();
    expect(result.current.stage).toBe("setup");
  });
});

describe("the Plan an AI planning session submits", () => {
  it("is this app's Plan, not another app's Plan submitted meanwhile", () => {
    lists.sessions = [fakeAgentSession({ id: "ags_p", title: "shop 이전 계획 (gke → eks)", createdAt: "2026-11-07T00:00:00Z" })];
    const { result, rerender } = renderHook(() => useLiveMigration());
    expect(result.current.stage).toBe("ai");

    // another operator migrates another app: its Plan arrives first and starts at once
    const other: PlanRecord["summary"] = { ...plan().summary, planId: "doom-eks-to-gke", source: { env: "eks", namespace: "doom", cluster: "" }, target: { env: "gke", namespace: "doom", cluster: "" } };
    lists.plans = [plan({ ref: "pln_doom", summary: other, submittedAt: "2026-11-07T00:00:10Z" })];
    act(() => rerender());
    lists.plans = [plan({ ref: "pln_doom", status: "started", summary: other, submittedAt: "2026-11-07T00:00:10Z" })];
    lists.runs = [fakeRun({ runId: "run_doom", planRef: "pln_doom", source: { env: "eks", namespace: "doom", cluster: "" }, target: { env: "gke", namespace: "doom", cluster: "" } })];
    act(() => rerender());
    expect(result.current.plan?.ref).not.toBe("pln_doom");
    expect(result.current.run).toBeUndefined();

    // this session's Plan arrives
    lists.sessions = [fakeAgentSession({ id: "ags_p", title: "shop 이전 계획 (gke → eks)", status: "succeeded", createdAt: "2026-11-07T00:00:00Z" })];
    lists.plans = [...lists.plans, plan({ ref: "pln_shop", submittedAt: "2026-11-07T00:00:30Z" })];
    act(() => rerender());
    expect(result.current.plan?.ref).toBe("pln_shop");
    expect(result.current.stage).toBe("review");
  });
});

describe("the app's latest finished run", () => {
  it("is the newest run of the app once it ended", () => {
    lists.runs = [
      fakeRun({ runId: "run_2", status: "succeeded", phase: "done", endedAt: "2026-11-07T00:10:00Z" }),
      fakeRun({ runId: "run_1", status: "failed", phase: "done", endedAt: "2026-11-06T00:10:00Z" }),
    ];
    const { result } = renderHook(() => useLiveMigration());
    expect(result.current.stage).toBe("setup");
    expect(result.current.lastRun?.runId).toBe("run_2");
  });

  it("is absent without any run of the app", () => {
    const { result } = renderHook(() => useLiveMigration());
    expect(result.current.lastRun).toBeUndefined();
  });
});
