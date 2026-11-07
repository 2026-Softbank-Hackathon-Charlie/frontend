import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeRun } from "../api/fakes";
import { MigrationResults } from "../pages/Routes";

const migration = fakeRun({
  source: { env: "gke", namespace: "moimroom-mig", cluster: "db" },
  target: { env: "onprem", namespace: "moimroom-mig", cluster: "db" },
  status: "succeeded",
});

function capture(phase: "before" | "after") {
  const before = phase === "before";
  const backend = before ? "gcp" : "laptop";
  return new File([JSON.stringify({
    schemaVersion: 1, runId: phase, phase, backend,
    startedUtc: before ? "2026-11-08T01:00:00Z" : "2026-11-08T02:00:00Z",
    finishedUtc: before ? "2026-11-08T01:01:00Z" : "2026-11-08T02:01:00Z",
    datasetName: "quality", datasetVersion: "1", datasetSha256: "a".repeat(64), rubricVersion: "1",
    conditions: {
      appCommit: "b".repeat(40), gatewayCommit: "c".repeat(40), promptSha256: "d".repeat(64),
      model: "model:tag", manifest: "e".repeat(64), ollamaVersion: "0.40.14",
      options: { stream: false, keep_alive: "60s", num_ctx: 2048, num_predict: 128, temperature: 0, seed: 42 },
    },
    items: Array.from({ length: 10 }, (_, i) => {
      const id = "Q" + String(i + 1).padStart(2, "0");
      const prompt = { id, spaceId: 1001 + i, input: { description: "test", amenities: [], rules: [] } };
      if (!before && i === 1) return {
        case: prompt, status: null, clientElapsedMs: 30_000, failure: "timeout", response: null,
        scores: { request_success: false, citation_match: null, missing_info: "not_evaluated", fact_match: "pending", verdict: "fail" },
      };
      const verdict = !before && i === 0 ? "pass" : "pending";
      return {
        case: prompt, status: 200, clientElapsedMs: before ? 400 + i % 2 : 300, appBackend: before ? "gke" : "onprem",
        response: { requestId: phase + "-" + id, backend, durationMs: 120, text: phase + " answer " + id },
        scores: { request_success: true, citation_match: true, missing_info: "not_applicable", fact_match: verdict, verdict },
      };
    }),
  })], before ? "before-gke-l4.json" : "after-onprem-laptop.json", { type: "application/json" });
}

it("shows AI verification only in expanded details of a successful moimroom-mig GKE-to-on-prem run", async () => {
  const user = userEvent.setup();
  const otherRuns = [
    fakeRun({ ...migration, runId: "other-app", source: { ...migration.source, namespace: "shop" } }),
    fakeRun({ ...migration, runId: "other-source", source: { ...migration.source, env: "eks" } }),
    fakeRun({ ...migration, runId: "other-target", target: { ...migration.target, env: "eks" } }),
    fakeRun({ ...migration, runId: "failed-run", status: "failed" }),
  ];
  render(<MigrationResults runs={[migration, ...otherRuns]} />);

  for (const run of otherRuns) {
    await user.click(screen.getByRole("button", { name: run.runId + " 실행 상세" }));
  }
  expect(screen.queryByRole("region", { name: "AI 검증" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: migration.runId + " 실행 상세" }));
  const card = within(screen.getByRole("region", { name: "AI 검증" }));
  expect(card.getByText("미측정")).toBeInTheDocument();
  expect(card.queryByRole("table")).not.toBeInTheDocument();
});

it("reads selected local captures and clears their metrics when a later import is rejected", async () => {
  const user = userEvent.setup();
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
  try {
    render(<MigrationResults runs={[migration]} />);
    await user.click(screen.getByRole("button", { name: migration.runId + " 실행 상세" }));
    const card = within(screen.getByRole("region", { name: "AI 검증" }));
    const input = card.getByLabelText("검증 결과 JSON");
    const after = capture("after");

    await user.upload(input, [after, capture("before")]);

    const table = within(await card.findByRole("table"));
    expect(within(table.getByRole("row", { name: /응답 시간 중앙값/ })).getByText("400.5 ms")).toBeInTheDocument();
    expect(within(table.getByRole("row", { name: /실패 요청 수/ })).getByText("1 / 10건")).toBeInTheDocument();
    expect(within(table.getByRole("row", { name: /품질 통과 수/ })).getByText("검토 대기 10건")).toBeInTheDocument();
    expect(table.getByText("1 / 10건 · 검토 대기 8건")).toBeInTheDocument();
    expect(card.getByText("before answer Q01")).toBeInTheDocument();
    expect(card.getByText("after answer Q10")).toBeInTheDocument();
    expect(card.queryByText("before answer Q02")).not.toBeInTheDocument();

    await user.upload(input, [after, new File(["{"], "before-gke-l4.json", { type: "application/json" })]);

    expect(await card.findByRole("alert")).toHaveTextContent("JSON 형식");
    expect(card.getByText("미측정")).toBeInTheDocument();
    expect(card.queryByRole("table")).not.toBeInTheDocument();
    expect(card.queryByText("after answer Q10")).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
