type Verdict = "pass" | "fail" | "pending";
type Attempt = { answer: string | null; elapsedMs: number; verdict: Verdict };
type Metrics = {
  medianLatencyMs: number | null;
  failed: number;
  qualityPassed: number;
  qualityPending: number;
  total: number;
};

export type AiVerificationResult = {
  reconstructed: boolean;
  before: Metrics;
  after: Metrics;
  cases: { id: string; before: Attempt; after: Attempt }[];
};

const caseIds = Array.from({ length: 10 }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`);
const datasetFields = ["datasetName", "datasetVersion", "datasetSha256", "rubricVersion"];
const sha256 = /^[a-f0-9]{64}$/;
const commitSha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const utc = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;

function invalid(): never {
  throw new Error("비교할 수 없는 AI 검증 결과입니다. GPU13 전후 캡처 파일을 확인하세요.");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const verdict = (value: unknown): value is Verdict => value === "pass" || value === "fail" || value === "pending";
const stringList = (value: unknown) => Array.isArray(value) && value.every(text);

function timestamp(value: unknown) {
  const parts = typeof value === "string" ? utc.exec(value) : null;
  if (!parts) invalid();
  const [, second, fraction = ""] = parts;
  const date = new Date(`${second}Z`);
  if (!Number.isFinite(date.valueOf()) || !date.toISOString().startsWith(`${second}.`)) invalid();
  return `${second}.${fraction.padEnd(6, "0")}`;
}

function conditionKey(value: unknown) {
  const conditions = record(value);
  const { appCommit, gatewayCommit, promptSha256, model, manifest, ollamaVersion } = conditions;
  const options = record(conditions.options);
  const { stream, keep_alive, num_ctx, num_predict, temperature, seed } = options;
  if (
    Object.keys(conditions).length !== 7 || Object.keys(options).length !== 6 ||
    !matches(appCommit, commitSha) || !matches(gatewayCommit, commitSha) ||
    !matches(promptSha256, sha256) || !matches(manifest, sha256) || !text(model) || !text(ollamaVersion) ||
    typeof stream !== "boolean" || !matches(keep_alive, /^\d+[smh]$/) ||
    ![num_ctx, num_predict, seed].every(Number.isSafeInteger) || !Number.isFinite(temperature)
  ) invalid();

  return JSON.stringify([appCommit, gatewayCommit, promptSha256, model, manifest, ollamaVersion,
    stream, keep_alive, num_ctx, num_predict, temperature, seed]);
}

function readItem(value: unknown, backend: "gcp" | "laptop") {
  const item = record(value);
  const { id, spaceId, input: rawInput } = record(item.case);
  const input = record(rawInput);
  const { description, amenities, rules } = input;
  if (typeof id !== "string" || !caseIds.includes(id) || !nonNegativeInteger(spaceId) || spaceId === 0 ||
      Object.keys(input).length !== 3 || typeof description !== "string" || !stringList(amenities) || !stringList(rules)) invalid();

  const { status, clientElapsedMs, appBackend, failure } = item;
  const expectedApp = backend === "gcp" ? "gke" : "onprem";
  if ((status !== null && !Number.isInteger(status)) || !nonNegativeInteger(clientElapsedMs) ||
      (appBackend !== undefined && appBackend !== expectedApp) || (failure !== undefined && !text(failure))) invalid();

  const response = item.response === null ? null : record(item.response);
  if (response?.backend !== undefined && response.backend !== backend) invalid();

  const { request_success, citation_match, missing_info, fact_match, verdict: quality } = record(item.scores);
  if (typeof request_success !== "boolean" || !verdict(quality)) invalid();

  let answer: string | null = null;
  let successfulRequestId: string | null = null;
  if (request_success) {
    const expectedVerdict = citation_match && missing_info !== "fail" ? fact_match : "fail";
    if (typeof citation_match !== "boolean" ||
        !["pass", "fail", "not_applicable"].some((score) => score === missing_info) ||
        !verdict(fact_match) || quality !== expectedVerdict) invalid();

    if (
      status !== 200 || appBackend !== expectedApp || failure !== undefined || !response ||
      response.backend !== backend || !matches(response.requestId, requestIdPattern) ||
      (item.requestId !== undefined && item.requestId !== response.requestId) ||
      !nonNegativeInteger(response.durationMs) || !text(response.text)
    ) invalid();
    answer = response.text;
    successfulRequestId = response.requestId;
  } else if (citation_match !== null || missing_info !== "not_evaluated" || fact_match !== "pending" || quality !== "fail") {
    invalid();
  }

  const attempt: Attempt = { answer, elapsedMs: clientElapsedMs, verdict: quality };
  return { id, spaceId, caseKey: JSON.stringify([spaceId, description, amenities, rules]),
    observed: appBackend === expectedApp, successfulRequestId, attempt };
}

function readCapture(document: Record<string, unknown>, phase: "before" | "after") {
  const backend = phase === "before" ? "gcp" : "laptop";
  const { runId, datasetSha256 } = document;
  if (
    document.schemaVersion !== 1 || document.phase !== phase || document.backend !== backend ||
    !text(runId) || !datasetFields.every((field) => text(document[field])) ||
    !matches(datasetSha256, sha256) || !Array.isArray(document.items) || document.items.length !== caseIds.length
  ) invalid();

  const started = timestamp(document.startedUtc);
  const finished = timestamp(document.finishedUtc);
  const conditions = conditionKey(document.conditions);
  const items = Array.from(document.items, (item) => readItem(item, backend)).sort((a, b) => a.id.localeCompare(b.id));
  if (started > finished || !items.every((item, index) => item.id === caseIds[index]) ||
      new Set(items.map((item) => item.spaceId)).size !== items.length ||
      !items.some((item) => item.observed)) invalid();

  return { runId, started, finished, conditions, items };
}

function metrics(items: ReturnType<typeof readItem>[]): Metrics {
  const durations = items.filter((item) => item.successfulRequestId !== null).map((item) => item.attempt.elapsedMs).sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    medianLatencyMs: durations.length === 0 ? null :
      (durations[Math.floor((durations.length - 1) / 2)] + durations[middle]) / 2,
    failed: items.length - durations.length,
    qualityPassed: items.filter((item) => item.attempt.verdict === "pass").length,
    qualityPending: items.filter((item) => item.attempt.verdict === "pending").length,
    total: items.length,
  };
}

export function parseAiVerificationResults(documents: readonly unknown[]): AiVerificationResult {
  if (documents.length !== 2) invalid();
  const first = record(documents[0]);
  const second = record(documents[1]);
  const [beforeDocument, afterDocument] = first.phase === "before" ? [first, second] : [second, first];
  const before = readCapture(beforeDocument, "before");
  const after = readCapture(afterDocument, "after");
  const requestIds = [...before.items, ...after.items].map((item) => item.successfulRequestId).filter((id) => id !== null);
  if (
    before.runId === after.runId || before.finished > after.started || before.conditions !== after.conditions ||
    !datasetFields.every((field) => beforeDocument[field] === afterDocument[field]) ||
    !before.items.every((item, index) => item.caseKey === after.items[index].caseKey) ||
    new Set(requestIds).size !== requestIds.length
  ) invalid();

  return {
    reconstructed: [beforeDocument, afterDocument].every(({ measurementProvenance: proof }) =>
      typeof proof === "object" && proof !== null && "kind" in proof && proof.kind === "isolated-reconstruction" &&
      "historicalBeforeMigration" in proof && proof.historicalBeforeMigration === false),
    before: metrics(before.items),
    after: metrics(after.items),
    cases: ["Q01", "Q10"].map((id) => {
      const index = caseIds.indexOf(id);
      return { id, before: before.items[index].attempt, after: after.items[index].attempt };
    }),
  };
}
