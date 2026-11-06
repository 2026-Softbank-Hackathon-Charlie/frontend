import { useState } from "react";
import { useSecurityOCSF } from "../api/hooks";
import type { SecurityOCSFExport } from "../api/types";
import { errorText } from "../data/live";
import { DEMO_SECURITY_OCSF } from "../sim/securityOCSF";
import { LoadError, Skeleton, Table, td } from "./ui";

/** SEC-09: the platform's OCSF export of the security data, to read and download. */
type OCSFEvent = Record<string, unknown>;
type Kind = "findings" | "vulnerabilities" | "controls";

const KINDS: { id: Kind; label: string; classes: string }[] = [
  { id: "findings", label: "발견 항목", classes: "2004 / 2003" },
  { id: "vulnerabilities", label: "취약점", classes: "2002" },
  { id: "controls", label: "통제 평가", classes: "2003" },
];
// Known OCSF status names in their spec order; anything else follows in order of appearance.
const EVENT_STATUS = ["New", "In Progress", "Suppressed", "Resolved", "Archived", "Deleted", "Other"];
const COMPLIANCE_STATUS = ["Pass", "Warning", "Fail", "Unknown", "Other"];

const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const text = (v: unknown): string | undefined => typeof v === "string" && v ? v : undefined;
const statusOf = (kind: Kind, e: OCSFEvent) => text(kind === "controls" ? object(e.compliance)?.status : e.status) ?? "Unknown";

/** "New 39 · Suppressed 3"; for controls by compliance.status: "Pass 20 · Fail 5 · Unknown 2". */
export function statusBreakdown(kind: Kind, events: OCSFEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(statusOf(kind, e), (counts.get(statusOf(kind, e)) ?? 0) + 1);
  const order = kind === "controls" ? COMPLIANCE_STATUS : EVENT_STATUS;
  const names = [...counts.keys()].sort((a, b) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1));
  return names.length ? names.map((n) => `${n} ${counts.get(n)}`).join(" · ") : "—";
}

/** The parts of a time in KST, zero-padded. */
function kst(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const p = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value ?? "";
  return { y: p("year"), m: p("month"), d: p("day"), h: p("hour"), min: p("minute") };
}
const shortTime = (iso: string) => { const t = kst(iso); return `${t.m}/${t.d} ${t.h}:${t.min} KST`; };
/** The download name, stamped with the export's generation time in KST. */
export const ocsfFileName = (iso: string) => { const t = kst(iso); return `hopcharlie-ocsf-${t.y}${t.m}${t.d}-${t.h}${t.min}.json`; };

function download(data: SecurityOCSFExport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ocsfFileName(data.generatedAt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const eventLabel = (e: OCSFEvent, i: number) => text(object(e.finding_info)?.title) ?? text(object(e.finding_info)?.uid) ?? `이벤트 ${i + 1}`;

export function OCSFExportView({ data }: { data: SecurityOCSFExport }) {
  // An older server sends findings only: the other kinds are then empty, not an error.
  const events: Record<Kind, OCSFEvent[]> = { findings: data.findings ?? [], vulnerabilities: data.vulnerabilities ?? [], controls: data.controls ?? [] };
  const [kind, setKind] = useState<Kind>(events.vulnerabilities.length ? "vulnerabilities" : "findings");
  const [index, setIndex] = useState(0);
  const list = events[kind];
  const selected = list[Math.min(index, list.length - 1)];
  return <div className="sp-ocsf">
    <div className="sp-ocsf-head">
      <p>OCSF {data.ocsfVersion} · 생성 {shortTime(data.generatedAt)}</p>
      <button type="button" className="btn ghost sm" onClick={() => download(data)}>JSON 내려받기</button>
    </div>
    <div className="box sp-table-box"><Table head={["종류", "OCSF 클래스", "건수", "상태"]} rows={KINDS.map((k) => [
      td(<b>{k.label}</b>), td(<span className="m">{k.classes}</span>), td(events[k.id].length, "num"), td(statusBreakdown(k.id, events[k.id])),
    ])} /></div>
    <div className="sp-filters">
      <label>종류<select aria-label="종류" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setIndex(0); }}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
      <label className="sp-search">이벤트<select aria-label="이벤트" value={selected ? Math.min(index, list.length - 1) : ""} disabled={!list.length} onChange={(e) => setIndex(Number(e.target.value))}>{list.map((e, i) => <option key={i} value={i}>{eventLabel(e, i)}</option>)}</select></label>
    </div>
    {selected ? <pre className="code sp-ocsf-json" aria-label="OCSF 이벤트 JSON">{JSON.stringify(selected, null, 2)}</pre> : <div className="box sp-empty"><p>내보낼 이벤트가 없습니다.</p></div>}
  </div>;
}

function LiveOCSF() {
  const result = useSecurityOCSF();
  if (result.loading) return <Skeleton box rows={4} />;
  const alert = result.error && <div role="alert"><LoadError title="OCSF 내보내기를 불러오지 못했습니다." error={errorText(result.error)} retry={result.reload} /></div>;
  return <>{alert}{result.data && <OCSFExportView data={result.data} />}</>;
}

/** Live mode reads GET /v1/security/ocsf; demo mode shows the same screen from demo events. */
export function SecurityOCSF({ live }: { live: boolean }) {
  return live ? <LiveOCSF /> : <OCSFExportView data={DEMO_SECURITY_OCSF} />;
}
