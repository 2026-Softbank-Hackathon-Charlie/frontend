/** Metadata only: host placement and caller location are independent evidence. */
export interface AIServiceObservation {
  id: string; serviceId: string; name: string; kind: "self_hosted" | "managed" | "external" | "unknown";
  callerEnv?: string;
  location: { environment?: string; provider?: string; region?: string; accelerator: "gpu" | "cpu" | "unknown" };
  model?: string;
  activity: { state: "active" | "idle" | "unknown"; requests?: number; lastSeen?: string };
  evidence: { source: string; observedAt: string; detail: string }[];
}
export interface AIServiceTopology {
  app: string; generatedAt: string; window: { from: string; to: string };
  sources: { name: string; status: "observed" | "unobserved" | "unavailable" | "not_configured"; message: string }[];
  services: AIServiceObservation[];
}
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
/** A rabbit means an observed app call within 90 seconds, never an estimated RPS. */
export function aiServiceMap(report: AIServiceTopology | undefined, app: string, now: number, error = false): AIServiceMap {
  const empty: AIServiceMap = { status: error ? "unavailable" : "unobserved", message: error ? "AI 관측을 읽지 못했습니다." : "앱 AI 서비스 관측 미수신", nodes: [], edges: [] };
  if (!report || report.app !== app) return empty;
  const nodes = new Map<string, AIServiceMap["nodes"][number]>();
  const edges: AIServiceMap["edges"] = [];
  const from = ms(report.window.from), to = ms(report.window.to), generated = ms(report.generatedAt);
  const fresh = !error && Number.isFinite(from) && from <= to && to <= now + 30000 && now - to <= 90000 && generated <= now + 30000 && now - generated <= 90000;
  for (const s of report.services) {
    const placement = s.kind === "external" ? "external" : lane(s.location.environment) ?? (s.kind === "managed" ? lane(s.location.provider) : undefined) ?? "unknown";
    const icon = s.kind === "external" ? "external" : s.kind === "managed" ? "managed" : s.kind === "self_hosted" ? s.location.accelerator === "gpu" ? "gpu" : s.location.accelerator === "cpu" ? "cpu" : "unknown" : "unknown";
    const detail = [s.model, s.location.provider, s.location.region, s.kind === "self_hosted" && s.location.accelerator === "unknown" ? "가속기 미확인" : "", placement === "unknown" ? "실행 위치 미확인" : ""].filter(Boolean).join(" · ");
    const node: AIServiceMap["nodes"][number] = { serviceId: s.serviceId, name: s.name, lane: placement, icon, detail, evidence: s.evidence.map(e => `${e.source} · ${e.observedAt} · ${e.detail}`) };
    const prev = nodes.get(s.serviceId);
    if (prev && (prev.lane !== node.lane || prev.icon !== node.icon)) nodes.set(s.serviceId, { ...node, lane: "unknown", icon: "unknown", detail: "실행 위치 관측 충돌", evidence: [...prev.evidence, ...node.evidence] });
    else if (!prev) nodes.set(s.serviceId, node);
    const last = ms(s.activity.lastSeen);
    const active = fresh && s.activity.state === "active" && typeof s.activity.requests === "number" && s.activity.requests > 0 && Number.isFinite(s.activity.requests) && last >= from && last <= to && last <= now && now - last <= 90000;
    edges.push({ id: s.id, serviceId: s.serviceId, caller: lane(s.callerEnv), active, requests: s.activity.requests, lastSeen: s.activity.lastSeen });
  }
  return { status: error ? "unavailable" : report.sources.some(s => s.status === "observed") ? "observed" : report.sources[0]?.status ?? "unobserved", message: error ? "AI 관측 연결 오류 · 마지막 결과" : report.sources.map(s => s.message).filter(Boolean).join(" · ") || "최근 90초의 관측된 앱 호출에만 토끼를 표시합니다.", observedAt: report.generatedAt, nodes: [...nodes.values()], edges };
}
