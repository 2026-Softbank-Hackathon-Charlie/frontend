import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeRun } from "../api/fakes";
import type { AgentEvent } from "../api/types";
import { MigrationResults } from "../pages/Routes";
import { eventText } from "./agent";

const ev = (p: Partial<AgentEvent>): AgentEvent => ({ seq: 1, sessionId: "ags_1", time: "2026-11-07T10:00:00Z", type: "message", ...p }) as AgentEvent;

it("words the rehearsal's plan line, its allowed probes and results without output", () => {
  expect(eventText(ev({ type: "message", tool: "plan", output: { planId: "moimroom-mig-gke-to-eks", planRef: "pln_9b4ee0acb2ee", planSession: "ags_3" } }))).toBe("대상 Plan: moimroom-mig-gke-to-eks (pln_9b4ee0acb2ee)");
  expect(eventText(ev({ type: "tool_result", tool: "kubectl", status: "expected", input: { command: "kubectl get pods -n sandbox-a" }, output: "open" }))).toBe("예상대로 허용됨: kubectl get pods -n sandbox-a");
  expect(eventText(ev({ type: "tool_result", tool: "engine.precheck", status: "ok", output: "" }))).toBe("engine.precheck 결과 (ok)");
  expect(eventText(ev({ type: "tool_result", tool: "sandbox_source", status: "ok", output: { rows: 20000 } }))).toBe('sandbox_source 결과 (ok): {"rows":20000}');
});

it("shows ten results at a time", async () => {
  const runs = Array.from({ length: 23 }, (_, i) => fakeRun({ runId: "run_" + i, status: "succeeded", endedAt: new Date(Date.UTC(2026, 10, 7, 0, i)).toISOString() }));
  render(<MigrationResults runs={runs} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(10);
  await userEvent.click(screen.getByRole("button", { name: "이전 결과 10건 더 보기 (13건 남음)" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(20);
  await userEvent.click(screen.getByRole("button", { name: "이전 결과 3건 더 보기 (3건 남음)" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(23);
  expect(screen.queryByRole("button", { name: /더 보기/ })).not.toBeInTheDocument();
});
