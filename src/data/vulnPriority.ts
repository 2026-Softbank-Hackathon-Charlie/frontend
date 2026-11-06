// SEC-07: default priority order and its reasons. KEV, running state and EPSS
// are separate bases next to severity; nothing here changes a severity.
import { activeException, type SecuritySeverity, type VulnerabilityFinding } from "./security";

const SEVERITY_RANK: Record<SecuritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4, unknown: 5 };
const md = (d: string) => d.slice(5).replace("-", "/");
const listed = (g: VulnerabilityFinding[]) => g.some((v) => v.kev === true);
const isRunning = (g: VulnerabilityFinding[]) => g.some((v) => v.occurrences.some((o) => o.running === true));
const maxEpss = (g: VulnerabilityFinding[]) => Math.max(-1, ...g.map((v) => v.epss ?? -1));
const topPercent = (pct: number) => Math.max(1, Math.round((1 - pct) * 100));

/**
 * KEV listed → running → severity → EPSS (highest first) → advisory. KEV unknown ranks as not listed.
 * Groups whose first member has an active exception (SEC-08) come after all others, in the same order.
 */
export function sortByPriority(groups: VulnerabilityFinding[][]): VulnerabilityFinding[][] {
  const now = Date.now();
  const key = (g: VulnerabilityFinding[]) => [activeException(g[0].exception, now) ? 1 : 0, listed(g) ? 0 : 1, isRunning(g) ? 0 : 1, Math.min(...g.map((v) => SEVERITY_RANK[v.severity]))];
  return [...groups].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return maxEpss(b) - maxEpss(a) || a[0].advisory.localeCompare(b[0].advisory);
  });
}

export function priorityReasons(group: VulnerabilityFinding[]): string[] {
  const out: string[] = [];
  if (listed(group)) out.push("KEV 등재");
  if (group.some((v) => v.ransomware)) out.push("랜섬웨어 사용");
  if (isRunning(group)) out.push("실행 중");
  const pct = Math.max(-1, ...group.map((v) => v.epssPercentile ?? -1));
  if (pct >= 0.9) out.push(`EPSS 상위 ${topPercent(pct)}%`);
  if (group.some((v) => v.fixedVersion)) out.push("수정 버전 있음");
  return out;
}

export function kevLabel(v: VulnerabilityFinding): string {
  if (v.kevState === "no_cve") return "CVE 없음";
  if (v.kev === true) return v.kevDueDate ? `KEV 등재 (기한 ${md(v.kevDueDate)})` : "KEV 등재";
  return v.kev === false ? "KEV 미등재" : "KEV 미확인";
}

export function epssLabel(v: VulnerabilityFinding, demo = false): string {
  if (v.epssState === "no_cve") return "CVE 없음";
  if (v.epssState === "not_scored") return "EPSS 점수 없음";
  if (v.epss === null) return "EPSS 미확인";
  const top = v.epssPercentile != null ? ` (상위 ${topPercent(v.epssPercentile)}%)` : "";
  const day = v.epssDate ? ` · ${md(v.epssDate)} 기준` : "";
  return `EPSS ${(v.epss * 100).toFixed(1)}%${top}${day}${demo ? " (예시)" : ""}`;
}
