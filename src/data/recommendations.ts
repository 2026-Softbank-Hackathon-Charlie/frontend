// API data is validated before it can produce an app/target navigation link.
export interface MigrationRecommendation {
  id: string; app: string; source: string | null; target: string | null;
  action: "move" | "stay" | "insufficient"; title: string; reasons: string[]; missing: string[];
  sources: { title: string; url: string; observedAt: string | null }[];
  estimatedMonthlySavingsUsd: number | null;
}
export interface MigrationRecommendationReport {
  generatedAt: string; nextRefreshAt: string; nextCheckAt: string | null; ttlSeconds: number;
  cacheStatus: "fresh" | "cached"; status: "ready" | "generating" | "not_configured" | "unavailable";
  ai: { status: string; model: string | null; sessionId: string | null };
  recommendations: MigrationRecommendation[];
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const timestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const lines = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every(x => text(x, 240));

/** Official evidence links are text-safe even when a proxy returns a malformed response. */
export function sourceUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash) return u.href;
  } catch { /* an invalid link is never clickable */ }
}

export function recommendationReport(value: unknown, now = Date.now()): MigrationRecommendationReport | undefined {
  if (!record(value) || !timestamp(value.generatedAt) || !timestamp(value.nextRefreshAt) || Date.parse(value.generatedAt) > now + 30000 || Date.parse(value.nextRefreshAt) < Date.parse(value.generatedAt) || Date.parse(value.nextRefreshAt) - Date.parse(value.generatedAt) > 86400000) return;
  if (!Number.isInteger(value.ttlSeconds) || Number(value.ttlSeconds) <= 0 || Number(value.ttlSeconds) > 86400 || !["fresh", "cached"].includes(String(value.cacheStatus)) || !["ready", "generating", "not_configured", "unavailable"].includes(String(value.status))) return;
  if (value.nextCheckAt !== null && !timestamp(value.nextCheckAt) || !record(value.ai) || !text(value.ai.status, 80) || value.ai.model !== null && !text(value.ai.model, 120) || value.ai.sessionId !== null && !text(value.ai.sessionId, 128)) return;
  if (!Array.isArray(value.recommendations) || value.recommendations.length > 50 || value.status !== "ready" && value.recommendations.length) return;
  const ids = new Set<string>();
  for (const r of value.recommendations) {
    if (!record(r) || !text(r.id, 128) || ids.has(r.id) || !name(r.app) || r.source !== null && !name(r.source) || r.target !== null && !name(r.target) || !["move", "stay", "insufficient"].includes(String(r.action)) || !text(r.title, 200) || !lines(r.reasons, 2) || !lines(r.missing, 20)) return;
    if (r.action === "move" && (!r.source || !r.target || r.source === r.target || !r.reasons.length)) return;
    if (r.estimatedMonthlySavingsUsd !== null && (typeof r.estimatedMonthlySavingsUsd !== "number" || !Number.isFinite(r.estimatedMonthlySavingsUsd) || r.estimatedMonthlySavingsUsd < 0)) return;
    if (!Array.isArray(r.sources) || r.sources.length > 20 || !r.sources.every(s => record(s) && text(s.title, 160) && typeof s.url === "string" && s.url.length <= 2048 && (s.observedAt === null || timestamp(s.observedAt)))) return;
    ids.add(r.id);
  }
  return value as unknown as MigrationRecommendationReport;
}

export function recommendationHref(r: MigrationRecommendation): string | undefined {
  if (r.action === "stay" || !name(r.app) || !name(r.source) || !name(r.target) || r.source === r.target) return;
  return "#migrate-app?" + new URLSearchParams({ app: r.app, source: r.source, target: r.target }).toString();
}
