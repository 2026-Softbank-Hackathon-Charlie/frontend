import { useEffect, useState } from "react";
import { recommendationHref, sourceUrl, type MigrationRecommendation } from "../data/recommendations";
import { recommendationDeadline, useRecommendations } from "../data/useRecommendations";
import { envName } from "./shared";
import { Chip, Skeleton } from "./ui";

const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
const LABEL = { move: "이전 추천", stay: "현재 환경 유지", insufficient: "판단 보류" } as const;
const MISSING_LABEL = new Map([
  ["comparable_total_cost_estimates", "총비용 견적"],
  ["capacity_preflight_required", "대상 자원 여유"],
  ["data_policy_preflight_required", "데이터 반출 정책"],
  ["current_environment_unobserved", "현재 실행 위치"],
  ["target_environment_unregistered", "등록 이전 대상"],
  ["environment_readiness_unknown", "환경 준비 상태"],
  ["migration_in_progress", "진행 중인 이전"],
  ["destination_country_restricted", "대상 국가 보관 제한"],
]);

function deferredReason(item: MigrationRecommendation, missing: string[]): string {
  if (item.missing.includes("migration_in_progress")) return "진행 중인 이전이 끝날 때까지 다음 판단을 보류합니다.";
  if (item.missing.includes("destination_country_restricted")) return "대상 국가가 등록 데이터 보관 정책을 벗어납니다.";
  if (item.missing.includes("current_environment_unobserved")) return "현재 실행 위치가 미확인이라 이전 출발지를 정할 수 없습니다.";
  if (item.missing.includes("target_environment_unregistered")) return "등록된 다른 환경이 없어 이전 대상을 비교할 수 없습니다.";
  if (missing.length) return missing.slice(0, 3).join(" · ") + (missing.length > 3 ? " 등" : "") + " 미확인으로 판단을 보류합니다.";
  return item.reasons.join(" · ") || "AI가 이전 판단을 보류했습니다.";
}

function RecommendationRow({ item, stale }: { item: MigrationRecommendation; stale: boolean }) {
  const href = stale ? undefined : recommendationHref(item);
  const go = item.action === "move" ? "이전하기" : "이전 조건 확인";
  const missing = [...new Set(item.missing.map(code => MISSING_LABEL.get(code) ?? "추가 확인 필요"))];
  const deferred = item.action === "insufficient";
  return <li>
    <Chip kind={item.action === "move" ? "run" : "neu"}>{LABEL[item.action]}</Chip>
    <div className="txt">
      <b>{item.app}</b>
      <span className="ov-rec-route">{item.source ? envName(item.source) : "현재 위치 미확인"}{item.target && item.target !== item.source ? " → " + envName(item.target) : ""}{deferred && item.target && " · 비교 대상"}</span>
      <span className="ov-rec-decision">{deferred ? deferredReason(item, missing) : item.reasons.join(" · ")}</span>
      {item.action === "move" && item.estimatedMonthlySavingsUsd !== null && <small>입력 총비용 견적 기준 월 약 ${item.estimatedMonthlySavingsUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} 차이</small>}
      {(item.sources.length > 0 || item.missing.length > 0 || deferred && item.reasons.length > 0) && <details className="ov-rec-evidence"><summary>판단 근거·참고 자료</summary>
        {deferred && item.missing.length > 0 && item.reasons.length > 0 && <p>{item.reasons.join(" · ")}</p>}
        {missing.length > 0 && <p>확인 필요: {missing.join(" · ")}</p>}
        <ul>{item.sources.map((source, i) => <li key={source.title + i}>
          {sourceUrl(source.url) ? <a href={sourceUrl(source.url)} target="_blank" rel="noreferrer">{source.title} ↗</a> : source.title}
          {source.observedAt && <time dateTime={source.observedAt}> · {date(source.observedAt)} KST</time>}
        </li>)}</ul>
      </details>}
    </div>
    {href && <a className="btn ghost" href={href} aria-label={item.app + " " + go}>{go}</a>}
  </li>;
}

/** Mounted only in the live overview's “지금 볼 것”. */
export function MigrationRecommendations() {
  const state = useRecommendations();
  const [now, setNow] = useState(() => Date.now());
  const deadline = recommendationDeadline(state);
  useEffect(() => {
    setNow(Date.now());
    if (deadline <= Date.now()) return;
    // Unlocks the manual control only; never performs network work.
    const timer = setTimeout(() => setNow(Date.now()), deadline - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [deadline]);
  const report = state.report;
  const stale = !!state.error || !!report && now >= Date.parse(report.nextRefreshAt);
  const waiting = report?.status === "generating";
  const canRefresh = !state.loading && now >= deadline;
  const ready = report?.status === "ready";
  return <div className="ov-recommendations" role="region" aria-label="AI 이전 판단" aria-busy={state.loading}>
    <div className="ov-rec-heading"><h3>AI 이전 판단</h3>
      <button type="button" className="btn sm ghost" disabled={!canRefresh} onClick={state.refresh}>{waiting ? "추천 결과 확인" : "추천 새로고침"}</button>
    </div>
    {!report && state.loading ? <Skeleton rows={1} /> : !report ? <p role="status" className="hint">추천을 읽지 못했습니다. 잠시 후 다시 확인하세요.</p> : <>
      <div className="hint ov-rec-meta"><time dateTime={report.generatedAt}>{date(report.generatedAt)} KST 기준</time>{stale && <Chip kind="warn">마지막 수신 결과</Chip>}{!canRefresh && !state.loading && <span>다음 확인 {date(new Date(deadline).toISOString())} KST</span>}</div>
      {state.error && <p role="status" className="hint">최신 추천을 읽지 못했습니다. 잠시 후 다시 확인하세요.</p>}
      {ready ? report.recommendations.length ? <>
        <ul className="ov-now ov-rec-list">{report.recommendations.slice(0, 3).map(item => <RecommendationRow key={item.id} item={item} stale={stale} />)}</ul>
        {report.recommendations.length > 3 && <details className="ov-rec-more"><summary>다른 앱 {report.recommendations.length - 3}개</summary><ul className="ov-now ov-rec-list">{report.recommendations.slice(3).map(item => <RecommendationRow key={item.id} item={item} stale={stale} />)}</ul></details>}
      </> : <p className="hint">지금 표시할 추천이 없습니다.</p>
        : <p role="status" className="hint">{waiting ? "AI가 이전 조건을 비교하고 있습니다." : report.status === "not_configured" ? "이전 추천 AI가 아직 연결되지 않았습니다." : "AI 추천을 완료하지 못했습니다. 잠시 후 다시 확인하세요."}</p>}
      <details className="ov-rec-method"><summary>추천 기준</summary><p className="hint">{report.ai.model ? "샌드박스 AI · " + report.ai.model : "AI 모델 미확인"} · 요금·배치 조건의 수신 시점 기준입니다. 이전 화면에서 준비 상태를 다시 확인합니다.</p></details>
    </>}
  </div>;
}
