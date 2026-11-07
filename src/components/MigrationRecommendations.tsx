import { useEffect, useState } from "react";
import { recommendationHref, sourceUrl, type MigrationRecommendation } from "../data/recommendations";
import { recommendationDeadline, useRecommendations } from "../data/useRecommendations";
import { envName } from "./shared";
import { Chip, Skeleton } from "./ui";

const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
const LABEL = { move: "이전 추천", stay: "현재 환경 유지", insufficient: "추가 확인" } as const;

function RecommendationRow({ item, stale }: { item: MigrationRecommendation; stale: boolean }) {
  const href = stale ? undefined : recommendationHref(item);
  const go = item.action === "move" ? "이전하기" : "이전 조건 확인";
  return <li>
    <Chip kind={item.action === "move" ? "run" : "neu"}>{LABEL[item.action]}</Chip>
    <div className="txt">
      <b>{item.app}{item.source && <span className="ov-rec-route"> · {envName(item.source)}{item.target && item.target !== item.source ? " → " + envName(item.target) : ""}</span>}</b>
      <span>{item.title}</span>
      {item.reasons.length > 0 && <span>{item.reasons.join(" · ")}</span>}
      {item.estimatedMonthlySavingsUsd !== null && <small>공시 요금 기준 월 약 ${item.estimatedMonthlySavingsUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} 차이</small>}
      {(item.sources.length > 0 || item.missing.length > 0) && <details className="ov-rec-evidence"><summary>판단 근거</summary>
        {item.missing.length > 0 && <p>확인 필요: {item.missing.join(" · ")}</p>}
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
  return <div className="ov-recommendations" role="region" aria-label="AI 이전 추천" aria-busy={state.loading}>
    <div className="ov-rec-heading"><h3>AI 이전 추천</h3>
      <button type="button" className="btn sm ghost" disabled={!canRefresh} onClick={state.refresh}>{waiting ? "추천 결과 확인" : "추천 새로고침"}</button>
    </div>
    {!report && state.loading ? <Skeleton rows={1} /> : !report ? <p role="status" className="hint">추천을 읽지 못했습니다. 잠시 후 다시 확인하세요.</p> : <>
      <div className="hint ov-rec-meta"><time dateTime={report.generatedAt}>{date(report.generatedAt)} KST 기준</time>{stale && <Chip kind="warn">마지막 수신 결과</Chip>}{!canRefresh && !state.loading && <span>다음 확인 {date(new Date(deadline).toISOString())} KST</span>}</div>
      {state.error && <p role="status" className="hint">최신 추천을 읽지 못했습니다. 잠시 후 다시 확인하세요.</p>}
      {ready ? report.recommendations.length ? <>
        <ul className="ov-now ov-rec-list">{report.recommendations.slice(0, 3).map(item => <RecommendationRow key={item.id} item={item} stale={stale} />)}</ul>
        {report.recommendations.length > 3 && <details className="ov-rec-more"><summary>다른 앱 {report.recommendations.length - 3}개</summary><ul className="ov-now ov-rec-list">{report.recommendations.slice(3).map(item => <RecommendationRow key={item.id} item={item} stale={stale} />)}</ul></details>}
      </> : <p className="hint">추천할 등록 앱이 없습니다.</p>
        : <p role="status" className="hint">{waiting ? "AI가 이전 조건을 비교하고 있습니다." : report.status === "not_configured" ? "이전 추천 AI가 아직 연결되지 않았습니다." : "AI 추천을 완료하지 못했습니다. 잠시 후 다시 확인하세요."}</p>}
      <details className="ov-rec-method"><summary>추천 기준</summary><p className="hint">{report.ai.model ? "샌드박스 AI · " + report.ai.model : "AI 모델 미확인"} · 요금·배치 조건의 수신 시점 기준입니다. 이전 화면에서 준비 상태를 다시 확인합니다.</p></details>
    </>}
  </div>;
}
