import type { components } from "../api/schema";
/** Metadata only: host placement and caller location are independent evidence. */
export type AIServiceObservation = components["schemas"]["AIServiceObservation"];
export type AIServiceTopology = components["schemas"]["AIServiceTopology"];
type Lane = "aws" | "gcp" | "onprem";
export interface AIServiceMap {
  status: string; message: string; observedAt?: string;
  nodes: { serviceId: string; name: string; lane: Lane | "external" | "unknown"; icon: "gpu" | "cpu" | "managed" | "external" | "unknown"; detail: string; evidence: string[] }[];
  edges: { id: string; serviceId: string; caller?: Lane; active: boolean; requests?: number; lastSeen?: string }[];
}
function lane(value?: string): Lane | undefined {
  switch (value?.toLowerCase()) {
    case "aws": case "eks": case "aws.bedrock": return "aws";
    case "gcp": case "gke": case "gcp.vertex_ai": return "gcp";
    case "onprem": case "k3s": return "onprem";
  }
}
const ms = (value?: string) => value ? Date.parse(value) : NaN;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** A proxy/older response must not crash the migration screen or imply zero calls. */
export function isAIServiceTopology(v: unknown): v is AIServiceTopology {
  if (!object(v) || typeof v.app !== "string" || typeof v.generatedAt !== "string" || !object(v.window) || typeof v.window.from !== "string" || typeof v.window.to !== "string" || !Array.isArray(v.sources) || !Array.isArray(v.services) || v.services.length > 256) return false;
  return v.sources.every(s => object(s) && typeof s.name === "string" && typeof s.message === "string" && ["observed", "unobserved", "unavailable", "not_configured"].includes(String(s.status))) && v.services.every(s =>
    object(s) && typeof s.id === "string" && typeof s.serviceId === "string" && typeof s.name === "string" && typeof s.callerEnv === "string" && ["self_hosted", "managed", "external", "unknown"].includes(String(s.kind)) && object(s.location) && ["gpu", "cpu", "unknown"].includes(String(s.location.accelerator)) && object(s.activity) && ["active", "idle", "unknown"].includes(String(s.activity.state)) && (s.activity.requests === undefined || typeof s.activity.requests === "number" && Number.isInteger(s.activity.requests) && s.activity.requests >= 0) && Array.isArray(s.evidence) && s.evidence.every(e => object(e) && typeof e.source === "string" && typeof e.observedAt === "string" && typeof e.detail === "string") && [s.location.environment, s.location.provider, s.location.region, s.model, s.activity.lastSeen].every(x => x === undefined || typeof x === "string")
  );
}
/** A rabbit means an observed app call within 90 seconds, never an estimated RPS. */
export function aiServiceMap(report: AIServiceTopology | undefined, app: string, now: number, error = false): AIServiceMap {
  const empty: AIServiceMap = { status: error ? "unavailable" : "unobserved", message: error ? "AI 관측을 읽지 못했습니다." : "앱 AI 서비스 관측 미수신", nodes: [], edges: [] };
  if (!isAIServiceTopology(report) || report.app !== app) return empty;
  const nodes = new Map<string, AIServiceMap["nodes"][number]>();
  const edges: AIServiceMap["edges"] = [];
  const from = ms(report.window.from), to = ms(report.window.to), generated = ms(report.generatedAt);
  const fresh = !error && report.sources.some(s => s.status === "observed") && Number.isFinite(from) && from <= to && to <= now + 30000 && now - to <= 90000 && generated <= now + 30000 && now - generated <= 90000;
  for (const s of report.services) {
    const placement = s.kind === "external" ? "external" : lane(s.location.environment) ?? (s.kind === "managed" ? lane(s.location.provider) : undefined) ?? "unknown";
    const icon = s.kind === "external" ? "external" : s.kind === "managed" ? "managed" : s.kind === "self_hosted" ? s.location.accelerator === "gpu" ? "gpu" : s.location.accelerator === "cpu" ? "cpu" : "unknown" : "unknown";
    const detail = [s.model, s.location.provider, s.location.region, s.kind === "self_hosted" && s.location.accelerator === "unknown" ? "가속기 미확인" : "", placement === "unknown" ? "실행 위치 미확인" : ""].filter(Boolean).join(" · ");
    const node: AIServiceMap["nodes"][number] = { serviceId: s.serviceId, name: s.name, lane: placement, icon, detail, evidence: s.evidence.map(e => `${e.source} · ${e.observedAt} · ${e.detail}`) };
    const prev = nodes.get(s.serviceId);
    if (prev && (prev.lane !== node.lane || prev.icon !== node.icon)) nodes.set(s.serviceId, { ...node, lane: "unknown", icon: "unknown", detail: "실행 위치 관측 충돌", evidence: [...prev.evidence, ...node.evidence] });
    else if (!prev) nodes.set(s.serviceId, node);
    else nodes.set(s.serviceId, { ...prev, evidence: [...new Set([...prev.evidence, ...node.evidence])] });
    const last = ms(s.activity.lastSeen);
    const active = fresh && s.activity.state === "active" && typeof s.activity.requests === "number" && s.activity.requests > 0 && Number.isFinite(s.activity.requests) && last >= from && last <= to && last <= now && now - last <= 90000;
    edges.push({ id: s.id, serviceId: s.serviceId, caller: lane(s.callerEnv), active, requests: s.activity.requests, lastSeen: s.activity.lastSeen });
  }
  return { status: error ? "unavailable" : report.sources.some(s => s.status === "observed") ? fresh ? "observed" : "stale" : report.sources[0]?.status ?? "unobserved", message: error ? "AI 관측 연결 오류 · 마지막 결과" : report.sources.map(s => s.message).filter(Boolean).join(" · ") || "최근 90초의 관측된 앱 호출에만 토끼를 표시합니다.", observedAt: report.generatedAt, nodes: [...nodes.values()], edges };
}
