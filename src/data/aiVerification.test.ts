import { describe, expect, it } from "vitest";
import { parseAiVerificationResults } from "./aiVerification";

function capture(phase: "before" | "after") {
  const before = phase === "before";
  const backend = before ? "gcp" : "laptop";
  return {
    schemaVersion: 1,
    phase,
    backend,
    runId: `capture-${phase}`,
    startedUtc: before ? "2026-11-07T02:48:53.443650+00:00" : "2026-11-07T02:49:01.000000+00:00",
    finishedUtc: before ? "2026-11-07T02:48:58.329100+00:00" : "2026-11-07T02:49:05.000000+00:00",
    datasetName: "moimroom-ai-brief-quality",
    datasetVersion: "1",
    datasetSha256: "a".repeat(64),
    rubricVersion: "1",
    conditions: {
      appCommit: "b".repeat(40),
      gatewayCommit: "c".repeat(40),
      promptSha256: "d".repeat(64),
      model: "qwen2.5:1.5b-instruct-q4_K_M",
      manifest: "e".repeat(64),
      ollamaVersion: "0.40.14",
      options: { stream: false, keep_alive: "60s", num_ctx: 2048, num_predict: 128, temperature: 0, seed: 42 },
    },
    items: Array.from({ length: 10 }, (_, index) => {
      const id = `Q${String(index + 1).padStart(2, "0")}`;
      const requestId = `${phase}-${id}`;
      return {
        case: { id, spaceId: 1001 + index, input: { description: id, amenities: [], rules: [] } },
        requestId,
        status: 200,
        clientElapsedMs: (index + 1) * (before ? 100 : 10),
        appBackend: before ? "gke" : "onprem",
        response: { requestId, backend, durationMs: 1, text: `${phase} ${id}` },
        scores: { request_success: true, citation_match: true, missing_info: "not_applicable", fact_match: "pass", verdict: "pass" },
      };
    }),
    summary: { total: 999, failed: 999, passed: 999 },
  };
}

function failedItem(item: ReturnType<typeof capture>["items"][number], appBackend?: string) {
  return {
    ...item,
    appBackend,
    status: null,
    response: null,
    failure: "timeout",
    scores: { request_success: false, citation_match: null, missing_info: "not_evaluated", fact_match: "pending", verdict: "fail" },
  };
}

describe("parseAiVerificationResults", () => {
  it("computes metrics from individual attempts and pairs just Q01 and Q10 in either upload order", () => {
    const before = capture("before");
    const after = capture("after");
    after.items[0].scores.missing_info = "fail";
    after.items[0].scores.verdict = "fail";
    after.items[1].scores.verdict = "pending";
    after.items[1].scores.fact_match = "pending";
    const failed = failedItem(after.items[9]);
    const result = parseAiVerificationResults([{ ...after, items: [failed, ...after.items.slice(0, 9).reverse()] }, before]);

    expect(result.before).toEqual({ medianLatencyMs: 550, failed: 0, qualityPassed: 10, qualityPending: 0, total: 10 });
    expect(result.after).toEqual({ medianLatencyMs: 50, failed: 1, qualityPassed: 7, qualityPending: 1, total: 10 });
    expect(result.cases).toEqual([
      { id: "Q01", before: { answer: "before Q01", elapsedMs: 100, verdict: "pass" }, after: { answer: "after Q01", elapsedMs: 10, verdict: "fail" } },
      { id: "Q10", before: { answer: "before Q10", elapsedMs: 1000, verdict: "pass" }, after: { answer: null, elapsedMs: 100, verdict: "fail" } },
    ]);
  });

  it("accepts reordered condition keys and reports no latency when every attempt failed", () => {
    const before = capture("before");
    const after = capture("after");
    const options = Object.fromEntries(Object.entries(after.conditions.options).reverse());
    const conditions = Object.fromEntries(Object.entries({ ...after.conditions, options }).reverse());
    const errorResponse = { ...failedItem(after.items[0], "onprem"), status: 503, response: { error: "unavailable" }, failure: "http_error" };
    const items = [errorResponse, ...after.items.slice(1).map((item) => failedItem(item))];

    expect(parseAiVerificationResults([before, { ...after, items, conditions }]).after).toEqual({
      medianLatencyMs: null, failed: 10, qualityPassed: 0, qualityPending: 0, total: 10,
    });
  });

  it("rejects isolated and incorrectly routed captures, including conflicting failure headers", () => {
    const before = capture("before");
    const after = capture("after");
    const isolatedItems = after.items.map((item) => ({ ...item, appBackend: undefined }));
    const failuresWithoutHeaders = after.items.map((item) => failedItem(item));
    const conflictingFailure = [failedItem(after.items[0], "gke"), ...after.items.slice(1)];
    for (const items of [isolatedItems, failuresWithoutHeaders, conflictingFailure]) {
      expect(() => parseAiVerificationResults([before, { ...after, items }])).toThrow("AI 검증");
    }
    after.items[0].response.backend = "gcp";
    expect(() => parseAiVerificationResults([before, after])).toThrow("AI 검증");
  });

  it("requires matching, unique, positive demo space IDs", () => {
    const before = capture("before");
    const after = capture("after");
    for (const [index, item] of before.items.entries()) {
      item.case.spaceId = 870 + index * 13;
      after.items[index].case.spaceId = item.case.spaceId;
    }
    expect(parseAiVerificationResults([before, after]).after.total).toBe(10);

    after.items[0].case.spaceId = 9999;
    expect(() => parseAiVerificationResults([before, after])).toThrow("AI 검증");

    for (const spaceId of [after.items[1].case.spaceId, 0, 4.5, Number.MAX_SAFE_INTEGER + 1]) {
      before.items[0].case.spaceId = spaceId;
      after.items[0].case.spaceId = spaceId;
      expect(() => parseAiVerificationResults([before, after])).toThrow("AI 검증");
    }
  });

  it("rejects successful attempts with inconsistent or unevaluated rubric scores", () => {
    const before = capture("before");
    const after = capture("after");
    const [item, ...remaining] = after.items;
    for (const patch of [
      { citation_match: null },
      { citation_match: false },
      { missing_info: "not_evaluated" },
      { missing_info: "fail" },
      { fact_match: "pending" },
    ]) {
      const items = [{ ...item, scores: { ...item.scores, ...patch } }, ...remaining];
      expect(() => parseAiVerificationResults([before, { ...after, items }])).toThrow("AI 검증");
    }
  });

  it("requires the collector's default rubric scores for failed requests", () => {
    const before = capture("before");
    const after = capture("after");
    const item = failedItem(after.items[0]);
    for (const patch of [{ citation_match: true }, { missing_info: "fail" }, { fact_match: "fail" }]) {
      const items = [{ ...item, scores: { ...item.scores, ...patch } }, ...after.items.slice(1)];
      expect(() => parseAiVerificationResults([before, { ...after, items }])).toThrow("AI 검증");
    }
  });

  it("rejects a conflicting AI backend preserved in a failed response", () => {
    const before = capture("before");
    const after = capture("after");
    const mismatch = {
      ...failedItem(after.items[0], "onprem"),
      status: 200,
      response: { ...after.items[0].response, backend: "gcp" },
      failure: "backend_mismatch",
    };
    expect(() => parseAiVerificationResults([before, { ...after, items: [mismatch, ...after.items.slice(1)] }])).toThrow("AI 검증");
  });

  it("rejects duplicate successful request IDs within or across captures", () => {
    const before = capture("before");
    const after = capture("after");
    for (const requestId of [after.items[1].requestId, before.items[0].requestId]) {
      after.items[0].requestId = requestId;
      after.items[0].response.requestId = requestId;
      expect(() => parseAiVerificationResults([before, after])).toThrow("AI 검증");
    }
  });

  it("rejects duplicate cases, changed inputs, and incompatible metadata", () => {
    const before = capture("before");
    const after = capture("after");
    const changedCase = { ...after.items[0].case, input: { description: "different", amenities: [], rules: [] } };
    const changedItem = { ...after.items[0], case: changedCase };
    for (const candidate of [
      { ...after, items: [...after.items.slice(0, 9), after.items[0]] },
      { ...after, items: [changedItem, ...after.items.slice(1)] },
      { ...after, datasetSha256: "f".repeat(64) },
      { ...after, rubricVersion: "2" },
      { ...after, conditions: { ...after.conditions, options: { ...after.conditions.options, seed: 23 } } },
      { ...after, startedUtc: before.startedUtc },
      { ...after, runId: before.runId },
      { before, after },
    ]) {
      expect(() => parseAiVerificationResults([before, candidate])).toThrow("AI 검증");
    }
  });
});
