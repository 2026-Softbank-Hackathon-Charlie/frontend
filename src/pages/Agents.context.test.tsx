import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { fakeAgentSession, fakeSession, installFetch, json } from "../api/fakes";
import { initAuth, startSession } from "../data/live";
import { Agents } from "./Agents";

vi.mock("../api/hooks", async load => ({ ...await load<typeof import("../api/hooks")>(), useAgentSession: () => ({ events: [] }) }));
const source = { env: "gke", namespace: "room", cluster: "room-db" }, target = { ...source, env: "onprem" };
const plan = { ref: "pln_one", summary: { planId: "not-an-app-name", source, target } };
const app = { name: "moimroom-mig", namespace: "room", environments: [source, target].map(e => ({ env: e.env, cnpgCluster: "room-db" })) };
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
beforeEach(() => { vi.useFakeTimers(); startSession(fakeSession()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); initAuth(); });

it("adds exactly App/From/To columns and reuses loaded metadata across unchanged session polls", async () => {
  const s = fakeAgentSession({ planRef: "pln_one", title: "another-app eks to other" });
  const calls = installFetch(c => c.url.startsWith("/v1/agent/sessions") ? json(200, { sessions: [s] }) : c.url === "/v1/plans" ? json(200, { plans: [plan] }) : c.url === "/v1/migrations" ? json(200, { runs: [] }) : c.url === "/v1/apps" ? json(200, { apps: [app] }) : json(404, {}));
  render(<Agents />); await flush();
  expect(screen.getAllByRole("columnheader").map(x => x.textContent)).toEqual(["종류", "앱", "From", "To", "제목", "상태", "도구 호출", "토큰 (입력 / 출력)", ""]);
  const row = screen.getAllByRole("row")[1];
  expect(within(row).getByText("moimroom-mig")).toBeInTheDocument();
  expect(within(row).getByText("GCP GKE")).toBeInTheDocument();
  expect(within(row).getByText("온프레미스 k3s")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(10001); }); await flush();
  for (const path of ["/v1/plans", "/v1/migrations", "/v1/apps"]) expect(calls.filter(c => c.url === path)).toHaveLength(1);
});

it("shows unlinked context as unknown without guessing the title or querying per-row metadata", async () => {
  const calls = installFetch(() => json(200, { sessions: [fakeAgentSession({ title: "docker-doom gke to onprem" })] }));
  render(<Agents />); await flush();
  expect(within(screen.getAllByRole("row")[1]).getAllByText("미확인")).toHaveLength(3);
  expect(calls.every(c => c.url.startsWith("/v1/agent/sessions"))).toBe(true);
});

it("separates a failed metadata lookup from unknown context and retries on request", async () => {
  let fail = true;
  installFetch(c => c.url.startsWith("/v1/agent/sessions") ? json(200, { sessions: [fakeAgentSession({ planRef: "pln_one" })] }) : c.url === "/v1/plans" ? fail ? json(503, { error: { code: "unavailable", message: "unavailable" } }) : json(200, { plans: [plan] }) : c.url === "/v1/apps" ? json(200, { apps: [app] }) : json(200, { runs: [] }));
  render(<Agents />); await flush();
  expect(screen.getByRole("alert")).toHaveTextContent("맥락 조회 실패: 계획");
  expect(within(screen.getAllByRole("row")[1]).getAllByText("미확인")).toHaveLength(3);
  fail = false; fireEvent.click(screen.getByRole("button", { name: "맥락 다시 읽기" })); await flush();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(within(screen.getAllByRole("row")[1]).getByText("moimroom-mig")).toBeInTheDocument();
});
