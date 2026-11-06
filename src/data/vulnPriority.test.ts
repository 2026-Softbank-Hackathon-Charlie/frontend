import { describe, expect, it } from "vitest";
import type { VulnerabilityFinding } from "./security";
import { epssLabel, kevLabel, priorityReasons, sortByPriority } from "./vulnPriority";

const base: VulnerabilityFinding = {
  id: "x", advisory: "CVE-1", title: "", package: "p", installedVersion: "1", fixedVersion: null, severity: "low",
  cvss: null, cvssVersion: "", scoreSource: "", basisUrl: "", kev: false, epss: null, epssDate: null, imageDigest: "d",
  occurrences: [], detail: "", recommendation: "",
};
const v = (o: Partial<VulnerabilityFinding>): VulnerabilityFinding => ({ ...base, ...o });
const running = [{ environment: "eks" as const, app: "a", workload: "w", namespace: "n", running: true }];

describe("sortByPriority", () => {
  it("puts KEV first, then running, then severity, then EPSS", () => {
    const groups = [
      [v({ advisory: "epss-high", severity: "critical", epss: 0.9 })],
      [v({ advisory: "crit-low-epss", severity: "critical", epss: 0.01 })],
      [v({ advisory: "running-low", severity: "low", occurrences: running })],
      [v({ advisory: "kev", severity: "low", kev: true, kevState: "listed" })],
      [v({ advisory: "kev-unknown", severity: "high", kev: null, kevState: "unknown" })],
    ];
    expect(sortByPriority(groups).map((g) => g[0].advisory)).toEqual(["kev", "running-low", "epss-high", "crit-low-epss", "kev-unknown"]);
  });

  it("breaks full ties by advisory ascending", () => {
    const groups = [[v({ advisory: "CVE-2" })], [v({ advisory: "CVE-1" })]];
    expect(sortByPriority(groups).map((g) => g[0].advisory)).toEqual(["CVE-1", "CVE-2"]);
  });

  it("ranks a group as KEV when only its second member is listed", () => {
    const groups = [[v({ advisory: "A-plain", severity: "critical" })], [v({ advisory: "Z-multi", severity: "low" }), v({ advisory: "Z-multi", severity: "low", kev: true, kevState: "listed" })]];
    expect(sortByPriority(groups).map((g) => g[0].advisory)).toEqual(["Z-multi", "A-plain"]);
  });

  it("ranks KEV unknown the same as not_listed", () => {
    const groups = [[v({ advisory: "B", kev: false, kevState: "not_listed" })], [v({ advisory: "A", kev: null, kevState: "unknown" })]];
    expect(sortByPriority(groups).map((g) => g[0].advisory)).toEqual(["A", "B"]);
    expect(sortByPriority([...groups].reverse()).map((g) => g[0].advisory)).toEqual(["A", "B"]);
  });

  it("uses the most severe member as the group severity", () => {
    const groups = [[v({ advisory: "A-high", severity: "high" })], [v({ advisory: "Z-mixed", severity: "low" }), v({ advisory: "Z-mixed", severity: "critical" })]];
    expect(sortByPriority(groups).map((g) => g[0].advisory)).toEqual(["Z-mixed", "A-high"]);
  });
});

describe("labels and reasons", () => {
  it("explains why a row is first", () => {
    expect(priorityReasons([v({ kev: true, kevState: "listed", ransomware: true, occurrences: running, fixedVersion: "2", epssPercentile: 0.95 })]))
      .toEqual(["KEV 등재", "랜섬웨어 사용", "실행 중", "EPSS 상위 5%", "수정 버전 있음"]);
    expect(priorityReasons([v({})])).toEqual([]);
  });
  it("names KEV and EPSS states without calling unknown safe", () => {
    expect(kevLabel(v({ kev: true, kevState: "listed", kevDueDate: "2026-11-18" }))).toBe("KEV 등재 (기한 11/18)");
    expect(kevLabel(v({ kev: false, kevState: "not_listed" }))).toBe("KEV 미등재");
    expect(kevLabel(v({ kev: null, kevState: "unknown" }))).toBe("KEV 미확인");
    expect(kevLabel(v({ kev: null, kevState: "no_cve" }))).toBe("CVE 없음");
    expect(kevLabel(v({ kev: null }))).toBe("KEV 미확인");
    expect(epssLabel(v({ epss: 0.042, epssPercentile: 0.92, epssDate: "2026-11-06", epssState: "scored" }))).toBe("EPSS 4.2% (상위 8%) · 11/06 기준");
    expect(epssLabel(v({ epss: 0.9999, epssPercentile: 0.99999, epssDate: "2026-11-06", epssState: "scored" }))).toBe("EPSS 100.0% (상위 1%) · 11/06 기준");
    expect(epssLabel(v({ epssState: "not_scored" }))).toBe("EPSS 점수 없음");
    expect(epssLabel(v({ epssState: "unknown" }))).toBe("EPSS 미확인");
    expect(epssLabel(v({ epssState: "no_cve" }))).toBe("CVE 없음");
    expect(epssLabel(v({ epss: 0.94, epssDate: "2026-11-06" }), true)).toBe("EPSS 94.0% · 11/06 기준 (예시)");
  });
});
