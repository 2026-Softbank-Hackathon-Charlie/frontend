import { useState } from "react";
import { useRuns } from "../api/hooks";
import type { Run } from "../api/types";
import { Icon } from "../components/Icon";
import { invalidRequestCounts, RunDecisionPanel } from "../components/RunDecisionPanel";
import { EnvRoute, envName, RESULT_KIND, RUN_SHORT } from "../components/shared";
import { Chip, LoadError, PageHead, Skeleton } from "../components/ui";
import { errorText, useLive } from "../data/live";
import { dur, fmt } from "../sim/format";
import { useSim } from "../sim/store";
import { measuredWriteMissing, WriteVerification, writeVerificationOf } from "../components/WriteVerification";
import "../styles/results.css";

export function Routes() {
  const live = useLive();
  return <div className="page">
    <PageHead icon="route" title="이전 결과" acts={<a className="btn primary" href="#migrate-app"><Icon name="arrow-right-left" size={16} />이전하기</a>} />
    {live ? <LiveResults /> : <SimResults />}
  </div>;
}

function LiveResults() {
  const runs = useRuns(5000);
  if (!runs.data) return runs.error ? <LoadError title="이전 결과를 불러오지 못했습니다." error={errorText(runs.error)} retry={runs.reload} /> : <Skeleton box />;
  return <>{runs.error && <LoadError title="갱신하지 못했습니다. 마지막으로 받은 결과입니다." error={errorText(runs.error)} retry={runs.reload} />}<MigrationResults runs={runs.data} /></>;
}
function SimResults() {
  const { S } = useSim();
  const m = S.mig;
  return <MigrationResults runs={m.run ? [m.run, ...m.history.filter((r) => r.runId !== m.run!.runId)] : m.history} />;
}

const count = (n?: number) => n === undefined ? "미측정" : fmt(n) + "건";
const millis = (n?: number) => n === undefined ? "미측정" : dur(n / 1000);
const date = (s: string) => new Date(s).toLocaleString("ko-KR", { hour12: false });
/** Runs shown at once; the rest come a page at a time. */
const PAGE = 10;

export function MigrationResults({ runs }: { runs: Run[] }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const ended = runs.filter((r) => r.status !== "running" && r.status !== "awaiting_switch");
  const shown = [...ended].sort((a, b) => Date.parse(b.endedAt ?? b.updatedAt) - Date.parse(a.endedAt ?? a.updatedAt)).filter((r) =>
    (filter === "all" || r.status === filter) && [r.runId, r.planId, r.source.namespace, envName(r.source.env), envName(r.target.env)].join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  return <section className="results" aria-label="이전 실행 이력">
    <div className="results-filters">
      <label>검색<input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="앱, 환경 또는 run ID" /></label>
      <label>결과<select value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(PAGE); }}><option value="all">전체 결과</option>{Object.entries(RUN_SHORT).filter(([s]) => s !== "running" && s !== "awaiting_switch").map(([s, text]) => <option key={s} value={s}>{text}</option>)}</select></label>
      <p className="hint" role="status">종료된 이전 {ended.length}건 · 표시 {shown.length}건</p>
    </div>
    {!ended.length ? <div className="box empty-state"><b>아직 종료된 이전이 없습니다.</b><p className="hint">이전이 끝나면 성공·실패·중단 결과가 실행별로 쌓입니다.</p></div>
      : !shown.length ? <p className="box empty-state">조건에 맞는 이전 결과가 없습니다.</p>
      : <><ol className="result-list">{shown.slice(0, limit).map((r) => <ResultSummary key={r.runId} r={r} />)}</ol>
        {shown.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>이전 결과 {Math.min(PAGE, shown.length - limit)}건 더 보기 ({shown.length - limit}건 남음)</button>}</>}
  </section>;
}

function ResultSummary({ r }: { r: Run }) {
  const x = r.result;
  const verification = writeVerificationOf(x);
  const invalidCounts = invalidRequestCounts(x);
  return <li className="box result-card">
    <header><div><h2>{r.source.namespace || r.planId}</h2><p><EnvRoute source={r.source.env} target={r.target.env} /></p></div><Chip kind={RESULT_KIND[r.status] ?? ""}>{RUN_SHORT[r.status]}</Chip></header>
    <p className="hint"><time dateTime={r.endedAt ?? r.updatedAt}>{date(r.endedAt ?? r.updatedAt)}</time> · {r.endedAt ? "종료" : "마지막 갱신"} · <code>{r.runId}</code>{r.rollbackOf && <> · 롤백 원본 {r.rollbackOf}</>}</p>
    <dl className="result-metrics">
      {([["전체 소요", millis(x.durationMillis)], ["쓰기 보류", millis(x.downtimeMillis)], ["실패 요청", invalidCounts ? "집계 이상" : count(x.failedRequests)], ["행 누락", count(x.missingRows)], ["쓰기 누락", count(measuredWriteMissing(verification, x.missingWrites))], ["파일 누락", count(x.missingFiles)]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <WriteVerification verification={verification} legacyMissing={x.missingWrites} />
    {r.status === "halted" && <p className="result-warning">승격 이후 상태 확인이 필요합니다. 원복 완료를 의미하지 않습니다.</p>}
    {r.observe?.passed === false && <p className="result-warning">전환 후 관찰에서 게이트 위반이 감지됐습니다.{r.observe.rollbackRunId && " 롤백 실행: " + r.observe.rollbackRunId}</p>}
    {(r.statusReason || r.engine.failureError) && <p className="hint">{r.statusReason || r.engine.failureError}</p>}
    <details><summary>실행 상세</summary><RunDecisionPanel r={r} /><dl className="result-details">
      <dt>Plan</dt><dd>{r.planRef} · {r.planId}</dd><dt>시작</dt><dd>{date(r.startedAt)} · {r.startedBy}</dd>
      <dt>요청 수</dt><dd>{invalidCounts ? "집계 이상" : count(x.requests)}</dd><dt>실패 단계</dt><dd>{r.engine.failureStep ?? "기록 없음"}</dd>
      <dt>엔진 단계</dt><dd>{Object.entries(r.engine.steps).map(([key, step]) => <div key={key}>{key}: {step.status}{step.error ? " · " + step.error : ""}</div>)}</dd>
    </dl></details>
  </li>;
}
