// Pre-start checks the platform runs when a migration starts (platform ADR 0013, 0014):
// data residency (policy against the source's live table list and buckets) and capacity
// (target connections, hot standby settings, replica catch-up, measured for a few seconds).
// The platform records both in the audit entry of the start (POST /v1/migrations) or the
// rollback, refused or not, so the page reads them from there. Nothing here is invented:
// a value the entry does not hold is shown as missing.
import type { AuditEntry } from "../api/types";

export type CheckStatus = "pass" | "fail" | "unknown" | "info" | "skip";

export interface PreflightItem {
  label: string;
  status: CheckStatus;
  detail: string;
  /** the platform's own text, for the tooltip */
  raw?: string;
}

export interface PreflightPart {
  status: CheckStatus;
  summary: string;
  items: PreflightItem[];
}

export interface PreflightView {
  /** when the platform ran the checks */
  at: string;
  /** the start was refused by a check */
  blocked: boolean;
  residency: PreflightPart & { digest?: string };
  capacity: PreflightPart;
  /** the parity record (platform ADR 0022, 0029): written at the start, it never blocks one */
  parity?: PreflightPart & { digest?: string };
}

/** Capacity measurements as the platform records them (capacity.Measurements). */
export interface CapacityMeasurements {
  sourceBytes?: number;
  walBytesPerSecond?: number;
  sourceSessions?: number;
  sourceMaxConnections?: number;
  sourceMaxWorkerProcesses?: number;
  targetMaxConnections?: number;
  /** "target" (read from the running target) or "manifest" (the target does not exist yet) */
  targetMaxConnectionsFrom?: string;
  targetMaxWorkerProcesses?: number;
  targetMaxWorkerProcessesFrom?: string;
  lagBefore?: number;
  lagAfter?: number;
  /** nanoseconds */
  window?: number;
}

/** Mirrors the platform's capacity.ConnectionHeadroom. */
const HEADROOM = 1.2;

const RESIDENCY_LABEL: Record<string, string> = {
  country_not_allowed: "목적지 국가로 보낼 수 없는 데이터",
  unclassified_dataset: "분류되지 않은 테이블 (새로 생긴 테이블일 수 있음)",
  inventory_catalog_mismatch: "분류표에는 있지만 원본에서 찾지 못한 테이블",
  unclassified_cluster: "정책에 없는 원본 클러스터",
  unknown_source: "정책에 등록되지 않은 원본 환경",
  unknown_destination: "정책에 등록되지 않은 대상 환경",
  unregistered_bucket: "정책에 등록되지 않은 버킷",
  bucket_country_not_allowed: "목적지 국가로 보낼 수 없는 버킷",
  inventory_incomplete: "원본 테이블 목록을 끝까지 읽지 못함",
  invalid_input: "정책이 다룰 수 없는 이름 (환경, 네임스페이스, 클러스터)",
  evaluation_failed: "정책을 평가하지 못함",
  not_ready: "정책 평가기가 준비되지 않음",
};

const INVENTORY_LABEL: Record<string, string> = {
  invalid_dsn: "원본 접속 정보가 올바르지 않음",
  connect_failed: "원본 DB에 접속하지 못함",
  query_failed: "카탈로그 조회 실패",
  timeout: "30초 안에 끝나지 않음",
  database_not_connectable: "접속할 수 없는 데이터베이스가 있음",
  unsupported_identifier: "지원하지 않는 이름의 테이블이 있음",
  large_objects_present: "대용량 객체(large object)가 있음",
  no_relations: "테이블이 하나도 없음",
};

const CHECK_LABEL: Record<string, string> = {
  connections: "접속 수",
  standby_settings: "대기 서버 설정",
  catchup: "복제 따라잡기",
  initial_copy: "초기 복사",
};

/** Binary size, e.g. "2.1 GiB". */
export function bin(n: number): string {
  if (Math.abs(n) < 1024) return Math.round(n) + " B";
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = -1;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(1) + " " + units[i];
}

function residencyPart(d: Record<string, unknown>, refused: string): PreflightView["residency"] {
  const digest = typeof d.residencyDigest === "string" ? d.residencyDigest : undefined;
  const reasons = Array.isArray(d.residencyReasons) ? d.residencyReasons.filter((x): x is string => typeof x === "string") : [];
  if (refused === "residency_denied") {
    const inventory = reasons.find((r) => r.startsWith("inventory:"))?.slice("inventory:".length);
    const items: PreflightItem[] = [];
    for (const r of reasons) {
      if (r.startsWith("inventory:")) continue;
      const [code, ...rest] = r.split(" ");
      const target = rest.join(" ");
      const detail = code === "inventory_incomplete" && inventory ? (INVENTORY_LABEL[inventory] ?? inventory) : target;
      items.push({ label: RESIDENCY_LABEL[code] ?? code, status: "fail", detail, raw: r });
    }
    return { status: "fail", summary: "정책 위반으로 시작하지 않았습니다", items, digest };
  }
  switch (d.residency) {
    case "allowed":
      return { status: "pass", summary: "원본 전체 테이블과 버킷이 목적지 국가로 갈 수 있습니다", items: [], digest };
    case "rollback_exempt":
      return { status: "skip", summary: "롤백이라 검사하지 않았습니다 (데이터가 출발한 환경으로 돌아감)", items: [], digest };
    case "not_configured":
      return { status: "skip", summary: "플랫폼에 레지던시 정책이 설정되지 않아 검사하지 않았습니다", items: [] };
    default:
      return { status: "skip", summary: "검사 기록이 없습니다", items: [] };
  }
}

function capacityItem(line: string, m: CapacityMeasurements): PreflightItem | undefined {
  const x = /^(\S+) (\S+) (\S+): ([\s\S]*)$/.exec(line);
  if (!x) return undefined;
  const [, id, st, code, msg] = x;
  const status: CheckStatus = st === "pass" || st === "fail" || st === "info" ? st : "unknown";
  return { label: CHECK_LABEL[id] ?? id, status, detail: capacityDetail(id, code, m) ?? msg, raw: msg };
}

const fromLabel = (from?: string) => (from === "manifest" ? "manifest 설정" : "실행 중인 대상");

interface StandbySetting {
  name: string;
  src?: number;
  dst?: number;
  from?: string;
}
type Compared = StandbySetting & { src: number; dst: number };
const compared = (s: StandbySetting): s is Compared => s.src !== undefined && s.dst !== undefined;

/**
 * Hot standby settings PostgreSQL also requires at or above the primary's, but the platform's
 * standby_settings check does not read. A pass must not read as covering them.
 */
const STANDBY_UNCHECKED = "max_wal_senders, max_prepared_transactions, max_locks_per_transaction";

/**
 * The target starts as a hot standby of the source, and PostgreSQL refuses to start one whose
 * setting is below the primary's. Mirrors the platform's capacity.standbySettings: a setting
 * unknown on either side is not compared, so the sentence names it instead of hiding it.
 */
function standbyDetail(code: string, m: CapacityMeasurements): string | undefined {
  if (code === "not_measured") return "원본이나 대상의 max_connections, max_worker_processes를 읽지 못해 비교하지 않았습니다";
  const settings: StandbySetting[] = [
    { name: "max_connections", src: m.sourceMaxConnections, dst: m.targetMaxConnections, from: m.targetMaxConnectionsFrom },
    { name: "max_worker_processes", src: m.sourceMaxWorkerProcesses, dst: m.targetMaxWorkerProcesses, from: m.targetMaxWorkerProcessesFrom },
  ];
  const known = settings.filter(compared);
  const text = (s: Compared) => s.name + " 대상 " + s.dst + " (" + fromLabel(s.from) + "), 원본 " + s.src;
  if (code === "target_below_source") {
    const short = known.filter((s) => s.dst < s.src);
    if (short.length === 0) return undefined;
    return short.map(text).join(", ") + ". 대상은 원본의 대기 서버로 뜨므로 원본 값 이상이어야 합니다";
  }
  if (code !== "ok" || known.length === 0) return undefined;
  const unknown = settings.filter((s) => !compared(s));
  const why = (s: StandbySetting) =>
    s.name + " 설정은 " + (s.src === undefined && s.dst === undefined ? "원본과 대상 값을" : s.src === undefined ? "원본 값을" : "대상 값을") + " 몰라 비교하지 못했습니다" + (s.dst === undefined ? " (대상에 연결되지 않고 manifest에도 없음)" : "");
  return [known.map(text).join(", ") + ": 원본 이상입니다", ...unknown.map(why), "이 검사는 " + STANDBY_UNCHECKED + " 설정을 비교하지 않습니다"].join(". ");
}

/** A Korean sentence from the measurements; undefined falls back to the platform's text. */
function capacityDetail(id: string, code: string, m: CapacityMeasurements): string | undefined {
  const secs = m.window ? Math.round(m.window / 1e8) / 10 + "초" : "";
  const lag = m.lagBefore !== undefined && m.lagAfter !== undefined ? "지연 " + bin(m.lagBefore) + " → " + bin(m.lagAfter) + " (" + secs + ")" : "";
  if (id === "connections") {
    if (code === "source_not_measured") return "원본 접속 수를 읽지 못했습니다";
    if (code === "target_not_measured") return "대상 최대 접속 수를 알 수 없습니다 (대상에 연결되지 않고 manifest에도 없음)";
    if (m.sourceSessions === undefined || m.targetMaxConnections === undefined) return undefined;
    const need = Math.ceil(m.sourceSessions * HEADROOM);
    return "대상 최대 접속 " + m.targetMaxConnections + " (" + fromLabel(m.targetMaxConnectionsFrom) + "), 필요 " + need + " (원본 접속 " + m.sourceSessions + " × " + HEADROOM + ")";
  }
  if (id === "standby_settings") return standbyDetail(code, m);
  if (id === "catchup") {
    if (code === "no_replica") return "스트리밍 중인 replica가 없어 재지 않았습니다. 엔진의 지연 기준이 판단합니다";
    if (!lag) return undefined;
    if (code === "caught_up") return lag + ", 이미 기준 이하";
    if (code === "catching_up") return lag + ", 기한 안에 따라잡습니다";
    if (code === "catchup_too_slow") return lag + ", 이 속도로는 기한 안에 따라잡지 못합니다";
    if (code === "not_catching_up") return lag + ", 지연이 줄지 않습니다";
  }
  if (id === "initial_copy") {
    if (m.sourceBytes === undefined) return "원본 크기를 읽지 못했습니다";
    return "원본 " + bin(m.sourceBytes) + (m.walBytesPerSecond !== undefined ? ", 변경 " + bin(m.walBytesPerSecond) + "/s" : "");
  }
  return undefined;
}

function capacityPart(d: Record<string, unknown>, refused: string): PreflightPart {
  if (refused === "residency_denied") return { status: "skip", summary: "레지던시에서 막혀 재지 않았습니다", items: [] };
  const c = d.capacity && typeof d.capacity === "object" ? (d.capacity as Record<string, unknown>) : undefined;
  if (!c) return { status: "skip", summary: "측정 기록이 없습니다", items: [] };
  switch (c.outcome) {
    case "not_configured":
      return { status: "skip", summary: "플랫폼에서 용량 측정이 꺼져 있습니다", items: [] };
    case "rollback_exempt":
      return { status: "skip", summary: "롤백이라 재지 않았습니다", items: [] };
    case "error":
      return { status: "unknown", summary: "측정하지 못했습니다. 시작은 막지 않고 엔진의 기준이 판단합니다", items: [] };
  }
  const m = (c.measurements && typeof c.measurements === "object" ? c.measurements : {}) as CapacityMeasurements;
  const lines = Array.isArray(c.checks) ? c.checks.filter((x): x is string => typeof x === "string") : [];
  const items = lines.map((l) => capacityItem(l, m)).filter((x): x is PreflightItem => !!x);
  const allowed = c.allowed !== false;
  return {
    status: allowed ? "pass" : "fail",
    summary: allowed ? "측정값으로 보이는 명백한 실패가 없습니다" : "측정 결과 이대로는 실패하므로 시작하지 않았습니다",
    items,
  };
}

/** Mirrors the platform's parity.Capability names. */
const CAPABILITY_LABEL: Record<string, string> = {
  identity: "인증, 권한",
  secret: "시크릿",
  audit: "감사 로그",
  "metrics-alerting": "모니터링, 알림",
  "backup-restore": "백업, 복구",
};

/** One line of paritygate.Lines: "capability status code" and, after ": ", its checks as id=status(code). */
function parityItem(line: string): PreflightItem | undefined {
  const x = /^(\S+) (\S+) (\S+?)(?:: ([\s\S]*))?$/.exec(line);
  if (!x) return undefined;
  const [, cap, st, code, checks] = x;
  const status: CheckStatus = st === "pass" || st === "fail" ? st : st === "not_applicable" ? "skip" : "unknown";
  return { label: CAPABILITY_LABEL[cap] ?? cap, status, detail: checks ? code + " (" + checks + ")" : code, raw: line };
}

function parityPart(d: Record<string, unknown>, refused: string): NonNullable<PreflightView["parity"]> {
  const p = d.parity && typeof d.parity === "object" ? (d.parity as Record<string, unknown>) : undefined;
  if (!p) return { status: "skip", summary: refused ? "이전을 시작하지 않아 검사하지 않았습니다" : "검사 기록이 없습니다", items: [] };
  switch (p.outcome) {
    case "recorded":
      break;
    case "not_configured":
      return { status: "skip", summary: "플랫폼에 동등성 파일이 설정되지 않아 검사하지 않았습니다", items: [] };
    case "rollback_exempt":
      return { status: "skip", summary: "롤백이라 검사하지 않았습니다", items: [] };
    case "no_app":
      return { status: "skip", summary: "동등성 파일에 대상 namespace의 앱이 없어 검사하지 않았습니다", items: [] };
    case "error":
      return { status: "unknown", summary: "검사를 실행하지 못했습니다. 기록 전용이라 시작은 막지 않았습니다", items: [] };
    default:
      return { status: "skip", summary: "검사 기록이 없습니다", items: [] };
  }
  const lines = Array.isArray(p.results) ? p.results.filter((x): x is string => typeof x === "string") : [];
  const items = lines.map(parityItem).filter((x): x is PreflightItem => !!x);
  const digest = typeof p.configDigest === "string" && p.configDigest ? p.configDigest : undefined;
  if (p.passed === true) return { status: "pass", summary: "필수 검사를 모두 통과했습니다. 기록 전용이라 시작은 막지 않습니다", items, digest };
  // not passed: a failed check is a mismatch; otherwise something stayed unknown or the evidence expired
  if (items.some((i) => i.status === "fail"))
    return { status: "fail", summary: "대상이 원본의 요구와 맞지 않는 항목이 있습니다. 기록 전용이라 시작은 막지 않았습니다", items, digest };
  return { status: "unknown", summary: "확인하지 못한 항목이 있어 통과로 보지 않습니다. 기록 전용이라 시작은 막지 않았습니다", items, digest };
}

/** The pre-start checks of an audit entry, or undefined when it holds none. */
export function preflightOf(e: Pick<AuditEntry, "time" | "detail">): PreflightView | undefined {
  const d = e.detail ?? {};
  const refused = typeof d.error === "string" ? d.error : "";
  const has = "residency" in d || "residencyReasons" in d || "capacity" in d || "parity" in d || refused === "residency_denied" || refused === "capacity_insufficient";
  if (!has) return undefined;
  return {
    at: e.time,
    blocked: refused === "residency_denied" || refused === "capacity_insufficient",
    residency: residencyPart(d, refused),
    capacity: capacityPart(d, refused),
    parity: parityPart(d, refused),
  };
}

/** The newest start or rollback entry of a plan that carries pre-start checks. Entries are newest first. */
export function latestPreflight(entries: AuditEntry[], planRef: string): PreflightView | undefined {
  for (const e of entries) {
    if (e.detail?.planRef !== planRef) continue;
    if (e.action !== "POST /v1/migrations" && !e.action.endsWith("/rollback")) continue;
    const p = preflightOf(e);
    if (p) return p;
  }
  return undefined;
}
