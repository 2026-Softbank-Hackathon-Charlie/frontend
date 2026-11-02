import { useState } from "react";
import { useSecurity } from "../api/hooks";
import type { SecurityReport, SecuritySeverity } from "../api/types";
import { envName } from "../components/shared";
import { Chip, PageHead, Table, td, type ChipKind } from "../components/ui";
import { errorText, useLive } from "../data/live";
import { SIM_SECURITY } from "../sim/security";

const SEV: Record<SecuritySeverity, [string, ChipKind]> = {
  critical: ["치명", "bad"],
  high: ["높음", "bad"],
  medium: ["중간", "run"],
  low: ["낮음", ""],
  info: ["정보", ""],
};
const SEV_ORDER: SecuritySeverity[] = ["critical", "high", "medium", "low", "info"];
const SRC_STATUS = { ok: ["정상", "ok"], unavailable: ["응답 없음", "bad"], not_configured: ["설정 안 됨", ""], error: ["오류", "bad"] } as const;

export function Security() {
  return useLive() ? <LiveSecurity /> : <SecurityView report={SIM_SECURITY} demo />;
}

function LiveSecurity() {
  const r = useSecurity(60_000);
  if (r.error && !r.data) {
    return (
      <div className="page">
        <PageHead title="보안" />
        <p className="hint">불러오지 못했습니다: {errorText(r.error)}</p>
      </div>
    );
  }
  if (!r.data) {
    return (
      <div className="page">
        <PageHead title="보안" />
        <p className="hint">불러오는 중</p>
      </div>
    );
  }
  return <SecurityView report={r.data} />;
}

function SecurityView({ report, demo }: { report: SecurityReport; demo?: boolean }) {
  const [sev, setSev] = useState<SecuritySeverity | "">("");
  const s = report.summary.bySeverity;
  const findings = report.findings.filter((f) => !sev || f.severity === sev);
  return (
    <div className="page">
      <PageHead title="보안" sub="클라우드 보안 서비스와 플랫폼 점검이 찾은 항목을 환경별로 모읍니다. 심각한 것부터 보여 줍니다." />
      {demo && <p className="hint">시연 데이터입니다. API에 연결하면 GET /v1/security 결과를 보여 줍니다.</p>}
      <div className="chips" role="group" aria-label="심각도로 거르기">
        <button type="button" className="btn ghost" aria-pressed={sev === ""} onClick={() => setSev("")}>
          전체 {s.total}
        </button>
        {SEV_ORDER.map((k) => (
          <button key={k} type="button" className="btn ghost" aria-pressed={sev === k} onClick={() => setSev(k)}>
            {SEV[k][0]} {s[k]}
          </button>
        ))}
      </div>
      <section className="sec">
        <h2>찾은 항목</h2>
        <div className="box">
          <Table
            head={["심각도", "환경", "항목", "리소스", "권장 조치"]}
            rows={findings.map((f) => [
              td(<Chip kind={SEV[f.severity][1]}>{SEV[f.severity][0]}</Chip>),
              td(envName(f.environment)),
              td(
                <>
                  <b>{f.title}</b>
                  <small className="block">{f.detail}</small>
                </>,
              ),
              td(f.resource, "m"),
              td(f.recommendation),
            ])}
          />
        </div>
      </section>
      <section className="sec">
        <h2>점검 출처</h2>
        <div className="box">
          <Table
            head={["출처", "환경", "상태", "항목 수"]}
            rows={report.sources.map((x) => [td(x.name), td(envName(x.environment)), td(<Chip kind={SRC_STATUS[x.status][1]}>{SRC_STATUS[x.status][0]}</Chip>), td(x.findings + "개", "m")])}
          />
        </div>
      </section>
    </div>
  );
}
