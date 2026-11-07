import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetch, json } from "../api/fakes";
import type { SourceRetentionResponse } from "../api/types";
import { SourceRetentionPanel } from "./SourceRetention";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const job = (status: NonNullable<SourceRetentionResponse["job"]>["status"] = "scheduled"): NonNullable<SourceRetentionResponse["job"]> => ({ runId: "run-1", sourceUID: "source", targetUID: "target", pods: [], keepForNanos: 86_400_000_000_000, dueAt: new Date(Date.now() + 86_400_000).toISOString(), status });

it("shows an actual deadline and extends it with one operator request", async () => {
  const current = job();
  const calls = installFetch(c => json(200, { job: c.method === "POST" ? { ...current, dueAt: JSON.parse(c.body!).retainUntil } : current }));
  render(<SourceRetentionPanel runId="run-1" operator />);
  expect(await screen.findByText("정리 예약")).toBeInTheDocument();
  expect(document.querySelector("time")).toHaveAttribute("datetime", current.dueAt);
  await userEvent.click(screen.getByRole("button", { name: "보존 24시간 연장" }));
  expect(await screen.findByText("보존 기간을 24시간 연장했습니다.")).toBeInTheDocument();
  const writes = calls.filter(c => c.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0].url).toBe("/v1/migrations/run-1/retention");
  expect(Date.parse(JSON.parse(writes[0].body!).retainUntil)).toBe(Date.parse(current.dueAt!) + 86_400_000);
});

it("cancels automatic cleanup without scheduling deletion", async () => {
  let current = job();
  const calls = installFetch(c => { if (c.method === "POST") current = { ...current, status: "cancelled", reason: "operator_keep" }; return json(200, { job: current }); });
  render(<SourceRetentionPanel runId="run-1" operator />);
  await userEvent.click(await screen.findByRole("button", { name: "원본 계속 보존" }));
  expect(await screen.findByText("자동 정리 취소")).toBeInTheDocument();
  expect(JSON.parse(calls.find(c => c.method === "POST")!.body!)).toEqual({ keep: true });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it.each(["deleting", "deleted", "cancelled"] as const)("offers no mutation for %s", async status => {
  installFetch(() => json(200, { job: job(status) }));
  render(<SourceRetentionPanel runId="run-1" operator />);
  await waitFor(() => expect(screen.queryByText("정리 예약을 확인하고 있습니다.")).not.toBeInTheDocument());
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("distinguishes no enrollment from completed cleanup", async () => {
  installFetch(() => json(200, {}));
  render(<SourceRetentionPanel runId="run-1" operator />);
  expect(await screen.findByText(/이 실행에는 자동 정리 예약이 없습니다/)).toBeInTheDocument();
  expect(screen.queryByText("원본 DB 정리 완료")).not.toBeInTheDocument();
});

it("shows the safety block and makes the panel read-only for viewers", async () => {
  installFetch(() => json(200, { job: { ...job("blocked"), reason: "safety_check_failed" } }));
  render(<SourceRetentionPanel runId="run-1" operator={false} />);
  expect(await screen.findByText("정리 보류")).toBeInTheDocument();
  expect(screen.getByText(/백업·복구 근거를 확인하지 못했습니다/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("reports an unavailable status without claiming deletion or success", async () => {
  installFetch(() => json(503, { error: { code: "unavailable", message: "offline" } }));
  render(<SourceRetentionPanel runId="run-1" operator />);
  expect(await screen.findByRole("alert")).toHaveTextContent("정리 상태를 갱신하지 못했습니다");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
