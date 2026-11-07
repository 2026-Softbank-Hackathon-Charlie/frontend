import type { LLMObservability } from "../api/types";
import { LLM_REASON, LLM_STATE, traceUrl } from "../data/llmObservability";
import { Chip, LoadError, Skeleton, Table, td } from "./ui";

const amount = (value: number | null, suffix = "") => value === null ? "미측정" : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value) + suffix;
const cost = (value: number | null) => value === null ? "미측정" : value > 0 && value < 0.00000001 ? "<$0.00000001" : "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST";

export function AppLLMObservation({ report, loading, error, malformed, now, reload }: { report?: LLMObservability; loading: boolean; error?: string; malformed: boolean; now: number; reload(): void }) {
  if (loading && !report) return <section aria-label="Langfuse LLM 관측"><p role="status">Langfuse 관측을 읽고 있습니다.</p><Skeleton box /></section>;
  if (!report) return <LoadError title="LLM 관측 결과를 읽지 못했습니다." error={malformed ? "앱 범위 또는 응답 형식을 확인하지 못했습니다." : error ?? "Langfuse 관측 결과가 아직 없습니다."} retry={reload} />;
  const stale = !!error || now - Date.parse(report.generatedAt) > 60000;
  const s = report.summary;
  return <section className="obs-llm" aria-label="Langfuse LLM 관측">
    <div className="actrow"><Chip kind={stale || report.source.status === "unavailable" ? "warn" : report.source.status === "observed" ? "ok" : "neu"}>{stale ? "마지막 수신 결과" : LLM_STATE[report.source.status]}</Chip><b>Langfuse{report.source.version ? ` ${report.source.version}` : ""}</b></div>
    {error && <LoadError title="최신 LLM 관측을 읽지 못했습니다. 마지막 결과를 표시합니다." error={error} retry={reload} />}
    <p>{LLM_REASON[report.source.reason] ?? "Langfuse 조회 상태를 확인하세요."}</p>
    <small className="hint block">수집 <time dateTime={report.generatedAt}>{date(report.generatedAt)}</time> · {date(report.window.from)} ~ {date(report.window.to)}</small>
    <p className="hint">최근 최대 {report.sample.limit}개 generation의 표본입니다. 전체 요청 집계가 아닙니다.{report.sample.truncated && " 더 많은 결과가 있어 일부만 표시합니다."} 프롬프트와 입력·출력은 표시하지 않습니다.</p>
    {s && <>
      <dl className="obs-llm-metrics">
        <div><dt>Trace / generation</dt><dd>{s.traces} / {s.generations}</dd></div>
        <div><dt>평균 지연</dt><dd>{amount(s.latencyMillis, " ms")}</dd></div>
        <div><dt>입력 / 출력 토큰</dt><dd>{amount(s.inputTokens)} / {amount(s.outputTokens)}</dd></div>
        <div><dt>총 토큰</dt><dd>{amount(s.totalTokens)}</dd></div>
        <div><dt>비용 (USD)</dt><dd>{cost(s.costUsd)}</dd></div>
        <div><dt>오류 generation</dt><dd>{s.errors === null ? "미확인" : s.errors}</dd></div>
      </dl>
      <div className="obs-llm-table"><Table head={["Trace / 모델", "관측 시각", "지연", "입력 / 출력 토큰", "비용 (USD)", "상태"]} rows={report.observations.map(o => [
        td(<><span className="m">{o.traceId}</span><small className="block">{o.model ?? "모델 미확인"}</small>{traceUrl(o.url) && <a href={traceUrl(o.url)} target="_blank" rel="noreferrer">Langfuse trace 보기 ↗</a>}</>),
        td(<time dateTime={o.startTime}>{date(o.startTime)}</time>), td(amount(o.latencyMillis, " ms")), td(`${amount(o.inputTokens)} / ${amount(o.outputTokens)}`), td(cost(o.costUsd)), td(o.level === "ERROR" ? "오류" : o.level === "WARNING" ? "경고" : o.level ? "관측됨" : "미확인"),
      ])} /></div>
    </>}
  </section>;
}
