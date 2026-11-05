import { useState } from "react";
import { useSecurity } from "../api/hooks";
import type { SecurityCategory, SecurityReport, SecuritySeverity } from "../api/types";
import { envName } from "../components/shared";
import { Chip, LoadError, PageHead, Skeleton, Table, td, type ChipKind } from "../components/ui";
import { errorText, useLive } from "../data/live";
import { CATEGORIES, CATEGORY_LABEL, PROVIDER_LABEL, securityMatrix, SOURCE_LABEL, type CellState } from "../data/securityMatrix";
import { SIM_SECURITY } from "../sim/security";

const SEV: Record<SecuritySeverity, [string, ChipKind]> = {
  critical: ["치명", "bad"],
  high: ["높음", "bad"],
  medium: ["중간", "warn"],
  low: ["낮음", ""],
  info: ["정보", ""],
};
const SEV_ORDER: SecuritySeverity[] = ["critical", "high", "medium", "low", "info"];
const SRC_STATUS = { ok: ["정상", "ok"], unavailable: ["응답 없음", "bad"], not_configured: ["설정 안 됨", ""], error: ["오류", "bad"] } as const;

const sourceName = (s: string) => SOURCE_LABEL[s] ?? s;

export function Security() {
  return useLive() ? <LiveSecurity /> : <SecurityView report={SIM_SECURITY} demo />;
}

function LiveSecurity() {
  const r = useSecurity(60_000);
  if (r.error && !r.data) {
    return (
      <div className="page">
        <PageHead icon="shield-check" title="보안" />
        <LoadError title="보안 점검 결과를 불러오지 못했습니다." error={errorText(r.error)} retry={r.reload} />
      </div>
    );
  }
  if (!r.data) {
    return (
      <div className="page">
        <PageHead icon="shield-check" title="보안" />
        <Skeleton box rows={4} />
      </div>
    );
  }
  return <SecurityView report={r.data} />;
}

interface Cell {
  env: string;
  cat: SecurityCategory;
}

function MatrixCell({ c, at, picked, onPick }: { c: CellState; at: Cell; picked: boolean; onPick: (x: Cell | null) => void }) {
  if (c.kind === "findings") {
    const [label, kind] = SEV[c.top];
    return (
      <button type="button" className="btn ghost sm" aria-pressed={picked} title="이 칸의 항목만 보기" onClick={() => onPick(picked ? null : at)}>
        <Chip kind={kind}>{label}</Chip> {c.count}건
      </button>
    );
  }
  if (c.kind === "clean") {
    return (
      <span title={"확인한 출처: " + c.sources.map(sourceName).join(", ")}>
        <Chip kind="ok">이상 없음</Chip>
      </span>
    );
  }
  if (c.kind === "unread") {
    return (
      <span title={"읽지 못한 출처: " + c.sources.map(sourceName).join(", ")}>
        <Chip>확인 못 함</Chip>
      </span>
    );
  }
  return <span className="hint">점검 안 함</span>;
}

function SecurityView({ report, demo }: { report: SecurityReport; demo?: boolean }) {
  const [sev, setSev] = useState<SecuritySeverity | "">("");
  const [cell, setCell] = useState<Cell | null>(null);
  const s = report.summary.bySeverity;
  const rows = securityMatrix(report);
  const findings = report.findings.filter((f) => (!sev || f.severity === sev) && (!cell || (f.environment === cell.env && f.category === cell.cat)));
  return (
    <div className="page">
      <PageHead icon="shield-check" title="보안" sub="클라우드 보안 서비스와 플랫폼 점검이 찾은 항목을 환경별로 모읍니다. 심각한 것부터 보여 줍니다." />
      {demo && <p className="hint">시연 데이터입니다. API에 연결하면 GET /v1/security 결과를 보여 줍니다.</p>}

      <section className="sec">
        <h2>환경 × 분류</h2>
        <details className="hint">
          <summary>칸 읽는 법</summary>
          클라우드마다 다른 보안 서비스(GuardDuty, Security Hub, Security Command Center, Kubernetes 점검)의 결과를 같은 6개 분류와 심각도로 맞췄습니다. 칸에는 가장 높은 심각도와 개수가
          나오고, 누르면 아래 목록을 그 칸으로 거릅니다. &lsquo;이상 없음&rsquo;은 그 분류를 보는 출처를 읽었고 찾은 항목이 없다는 뜻입니다. &lsquo;확인 못 함&rsquo;은 그 출처를 읽지
          못했다는 뜻이고, &lsquo;점검 안 함&rsquo;은 그 환경에 그 분류를 보는 출처가 없다는 뜻입니다. 둘 다 안전하다는 뜻이 아닙니다.
        </details>
        <div className="box">
          <Table
            head={["환경", ...CATEGORIES.map((c) => CATEGORY_LABEL[c])]}
            rows={rows.map((r) => [
              td(
                <>
                  <b>{envName(r.environment)}</b>
                  <small className="block">
                    {r.providers.map((p) => PROVIDER_LABEL[p]).join(", ")}
                    {r.sources.length ? " (" + r.sources.map((x) => sourceName(x.name)).join(", ") + ")" : ""}
                  </small>
                </>,
              ),
              ...CATEGORIES.map((c) =>
                td(<MatrixCell c={r.cells[c]} at={{ env: r.environment, cat: c }} picked={cell?.env === r.environment && cell.cat === c} onPick={setCell} />, "nw"),
              ),
            ])}
          />
        </div>
      </section>

      <section className="sec">
        <div className="sech">
          <h2>찾은 항목</h2>
          {cell && (
            <span className="hint">
              {envName(cell.env)}의 {CATEGORY_LABEL[cell.cat]}만 보는 중{" "}
              <button type="button" className="linkbtn" onClick={() => setCell(null)}>
                전체 보기
              </button>
            </span>
          )}
        </div>
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
        <div className="box">
          <Table
            head={["심각도", "환경", "분류", "항목", "리소스", "권장 조치"]}
            rows={findings.map((f) => [
              td(<Chip kind={SEV[f.severity][1]}>{SEV[f.severity][0]}</Chip>),
              td(
                <>
                  {envName(f.environment)}
                  <small className="block">{sourceName(f.source)}</small>
                </>,
              ),
              td(CATEGORY_LABEL[f.category], "nw"),
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
            rows={report.sources.map((x) => [
              td(
                <>
                  {sourceName(x.name)}
                  {x.message && <small className="block">{x.message}</small>}
                </>,
              ),
              td(envName(x.environment)),
              td(<Chip kind={SRC_STATUS[x.status][1]}>{SRC_STATUS[x.status][0]}</Chip>),
              td(x.findings + "개", "num"),
            ])}
          />
        </div>
      </section>
    </div>
  );
}
