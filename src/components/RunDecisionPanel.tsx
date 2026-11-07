import type { Run, RunResult } from "../api/types";
import { canaryVerdict } from "../data/canaryVerdict";
import { fmt } from "../sim/format";
import { envName } from "./shared";
import { Chip } from "./ui";
import { measuredWriteMissing, writeVerificationOf } from "./WriteVerification";
import "../styles/run-decision.css";

const validCount = (n?: number): n is number => n !== undefined && Number.isSafeInteger(n) && n >= 0;
const count = (n?: number) => validCount(n) ? fmt(n) : "미측정";

export function invalidRequestCounts({ requests, failedRequests }: RunResult): boolean {
  return (requests !== undefined && !validCount(requests))
    || (failedRequests !== undefined && !validCount(failedRequests))
    || (requests !== undefined && failedRequests !== undefined && failedRequests > requests);
}

const stepLabel = (step?: Run["engine"]["steps"][string]) =>
  step?.status === "succeeded" ? "완료" : step?.status === "failed" ? "실패"
    : step?.status === "pending" ? "미실행" : "기록 없음";

export function RunDecisionPanel({ r }: { r: Run }) {
  if (r.status !== "succeeded" && r.status !== "halted") return null;

  const { engine, result, canary } = r;
  const halted = r.status === "halted";
  const target = envName(r.target.env);
  const switched = engine.trafficOnTarget && !engine.writesHeld;
  const observeFailed = r.observe?.passed === false;
  const reason = r.statusReason || engine.failureError;
  const demotionTimedOut = engine.failureStep === "switchover"
    && reason?.includes("waiting for demotion token") && reason.includes("context deadline exceeded");
  const invalidCounts = invalidRequestCounts(result);
  const verification = writeVerificationOf(result);
  const writeMissing = measuredWriteMissing(verification, result.missingWrites);
  const writeResult = verification?.status === "not_configured" ? "미설정"
    : writeMissing !== undefined ? "누락 " + fmt(writeMissing) + "건" : "미측정";
  const failedRequests = invalidCounts ? "집계 이상"
    : validCount(result.requests) && validCount(result.failedRequests)
      ? fmt(result.failedRequests) + " / " + fmt(result.requests) : "미측정";
  const verdict = halted ? (engine.failureStep === "switchover" ? "DB 역할 전환에서 중단" : "이전 중단")
    : observeFailed ? "전환 후 관찰 위반" : switched ? target + " 쓰기 전환 완료" : "쓰기 전환 확인 필요";
  const facts = halted ? [
    ["종료 시 Gateway 기록", engine.writesHeld ? "쓰기 보류 유지" : "쓰기 보류 없음"],
    [target + " 경로 전환", engine.trafficOnTarget ? "전환 기록 있음" : stepLabel(engine.steps.cutover)],
    ["현재 DB primary", "실시간 확인 필요"],
    ["실패 요청", failedRequests],
  ] : [
    ["실패 요청", failedRequests],
    ["쓰기 보류", result.downtimeMillis === undefined ? "미측정" : (result.downtimeMillis / 1000).toFixed(1) + "초"],
    ["누락 행 / 파일", count(result.missingRows) + " / " + count(result.missingFiles)],
    ["개별 쓰기 대조", writeResult],
  ];
  const stages = [
    ["읽기 카나리", canaryVerdict(r)?.label ?? "기록 없음"],
    ["쓰기 보류", stepLabel(engine.steps.fence)],
    ["DB 역할 전환", stepLabel(engine.steps.switchover)],
    ["경로 전환", stepLabel(engine.steps.cutover)],
    ["최종 검증", stepLabel(engine.steps.verify)],
  ];

  return <section className="box run-decision" aria-label="전환 판단">
    <div className="bh"><h3>전환 판단</h3><Chip kind={halted || observeFailed ? "warn" : switched ? "ok" : "neu"}>{verdict}</Chip></div>
    <div className="bb run-decision-body">
      <p className="hint">{!halted && switched ? "실행 종료 기록 · Gateway 쓰기 보류 해제" : "실행 종료 기록 · 현재 DB 역할과 트래픽 상태는 별도 확인"}</p>
      {halted && reason && <p className="run-decision-reason"><b>{demotionTimedOut ? "원본 DB 강등 토큰 대기 시간 초과" : "중단 원인"}</b> <code>{reason}</code></p>}
      {observeFailed && r.observe?.violation && <p className="run-decision-reason">{r.observe.violation}</p>}
      <dl className="run-decision-facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <dl className="run-decision-steps" aria-label="전환 단계">
        {stages.map(([label, state]) => <div key={label}><dt>{label}</dt><dd>{state}</dd></div>)}
      </dl>
      {halted && <div className="run-decision-checks">
        <h4>재개·원복 전 확인</h4>
        <ol>
          <li>양쪽 CNPG에서 실제 primary와 대상 승격 완료 여부를 확인합니다.</li>
          <li>현재 Gateway 쓰기 대상, 쓰기 보류 상태와 신규 쓰기를 받은 위치를 확인합니다.</li>
          <li>WAL 재생 위치와 최신 데이터를 확인한 뒤 재개 또는 원복 경로를 결정합니다.</li>
        </ol>
        {engine.sourceDemoted && engine.promoteRequested && <p className="hint">원본 강등과 대상 승격 요청이 엔진에 기록됐습니다. 양쪽 DB의 실제 역할을 조회해 확인하세요.</p>}
      </div>}
      {!!canary?.steps.length && <details className="run-decision-canary">
        <summary>읽기 카나리 근거</summary>
        <table>
          <thead><tr><th scope="col">{target} 읽기</th><th scope="col">요청</th><th scope="col">오류율</th><th scope="col">p95</th></tr></thead>
          <tbody>{canary.steps.map((step) => <tr key={step.weight}>
            <td>{step.weight}%</td>
            <td>{count(step.gate?.requests)}</td>
            <td>{step.gate?.errorRate === undefined ? "–" : (step.gate.errorRate * 100).toFixed(2) + "%"}</td>
            <td>{step.gate?.p95Millis === undefined ? "–" : step.gate.p95Millis.toFixed(1) + "ms"}</td>
          </tr>)}</tbody>
        </table>
      </details>}
    </div>
  </section>;
}
