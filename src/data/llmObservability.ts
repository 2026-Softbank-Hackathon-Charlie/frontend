import type { LLMObservability } from "../api/types";
import type { AIServiceTopology } from "./aiServices";

const statuses = ["observed", "unobserved", "not_configured", "scope_unmapped", "unavailable", "unsupported"];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const timestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function metrics(v: Record<string, unknown>): boolean {
  return ["inputTokens", "outputTokens", "totalTokens", "costUsd", "latencyMillis"].every(key => v[key] === null || typeof v[key] === "number" && Number.isFinite(v[key]) && v[key] >= 0 && (!key.endsWith("Tokens") || Number.isSafeInteger(v[key])));
}

/** An older/malformed response cannot silently become a zero-valued LLM report. */
export function llmReport(value: unknown, app: string, now = Date.now()): LLMObservability | undefined {
  if (!record(value) || value.app !== app || !timestamp(value.generatedAt) || !record(value.window) || !timestamp(value.window.from) || !timestamp(value.window.to) || Date.parse(value.window.from) >= Date.parse(value.window.to)) return;
  if (!record(value.source) || value.source.name !== "langfuse" || !statuses.includes(String(value.source.status)) || typeof value.source.reason !== "string") return;
  if (Date.parse(value.generatedAt) > now + 30000 || Date.parse(value.window.to) > now + 30000 || value.source.version !== undefined && (typeof value.source.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.source.version))) return;
  if (!record(value.sample) || value.sample.limit !== 100 || !count(value.sample.returned) || typeof value.sample.truncated !== "boolean" || !Array.isArray(value.observations) || value.observations.length > 100 || value.sample.returned !== value.observations.length) return;
  const ids = new Set<string>(), traces = new Set<string>();
  for (const o of value.observations) {
    if (!record(o) || typeof o.id !== "string" || typeof o.traceId !== "string" || !/^[\w-]{1,128}$/.test(o.id) || !/^[\w-]{1,128}$/.test(o.traceId) || ids.has(o.id) || !timestamp(o.startTime) || !metrics(o)) return;
    if (o.model !== undefined && (typeof o.model !== "string" || !/^[A-Za-z0-9_.:/-]{1,100}$/.test(o.model)) || o.url !== undefined && typeof o.url !== "string") return;
    if (Date.parse(o.startTime) < Date.parse(value.window.from) || Date.parse(o.startTime) >= Date.parse(value.window.to) || ![null, "ERROR", "WARNING", "DEFAULT", "DEBUG"].includes(o.level as string | null)) return;
    ids.add(o.id); traces.add(o.traceId);
  }
  if (value.source.status === "observed") {
    const s = value.summary;
    if (!record(s) || !metrics(s) || s.generations !== ids.size || s.traces !== traces.size || !ids.size || !(s.errors === null || count(s.errors) && s.errors <= ids.size)) return;
  } else if (value.summary !== null || ids.size) return;
  return value as unknown as LLMObservability;
}

/** A past app call is positive evidence of AI use; configured endpoints alone are not. */
export function hasObservedAI(value: AIServiceTopology | undefined, app: string, now: number): boolean {
  if (!value || value.app !== app || !Array.isArray(value.sources) || !value.sources.some(s => s.status === "observed") || !Array.isArray(value.services)) return false;
  return value.services.some(s => {
    const last = s.activity?.lastSeen ? Date.parse(s.activity.lastSeen) : NaN;
    return Number.isFinite(last) && last <= now + 30000 && last >= now - 24 * 3600000;
  });
}

export function traceUrl(raw: string | undefined): string {
  try {
    const u = new URL(raw ?? "");
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash && /^\/project\/[\w-]+\/traces\/[\w-]+$/.test(u.pathname) ? u.href : "";
  } catch { return ""; }
}

export const LLM_STATE = { observed: "관측됨", unobserved: "미관측", not_configured: "미연결", scope_unmapped: "앱 범위 미설정", unavailable: "수집 오류", unsupported: "미지원" } as const;
export const LLM_REASON: Record<string, string> = {
  bounded_generation_sample: "앱 범위와 일치하는 Langfuse generation 표본입니다.",
  no_scoped_generations: "선택한 기간의 표본에서 이 앱의 generation을 관측하지 못했습니다. AI를 사용하지 않는다는 뜻은 아닙니다.",
  langfuse_not_configured: "이 서버에 Langfuse 조회 연결이 설정되지 않았습니다.",
  app_scope_unmapped: "이 앱과 Langfuse 프로젝트·generation metadata의 연결이 설정되지 않았습니다.",
  configuration_error: "Langfuse 서버 설정이나 프로젝트 키 파일을 검증하지 못했습니다.",
  server_version_unsupported: "Langfuse 서버 버전을 확인하지 못했거나 지원하는 v3·v4 버전이 아닙니다.",
  api_unsupported: "현재 Langfuse 서버가 필요한 조회 API를 지원하지 않습니다.",
  project_scope_mismatch: "프로젝트 인증 결과가 이 앱의 서버 설정과 일치하지 않습니다.",
  upstream_auth_failed: "Langfuse 프로젝트 인증에 실패했습니다. 서버의 조회 권한을 확인하세요.",
  upstream_timeout: "Langfuse 조회가 제한 시간 안에 끝나지 않았습니다.",
  upstream_unavailable: "Langfuse를 읽지 못했습니다. 수집 상태를 확인하세요.",
  response_invalid: "Langfuse 응답 형식을 확인하지 못했습니다.",
};
