import { useId, useState, type ChangeEvent } from "react";
import { parseAiVerificationResults, type AiVerificationResult } from "../data/aiVerification";
import { fmt } from "../sim/format";
import { Chip } from "./ui";

const recordedSides = [
  { key: "before", label: "이전", source: "GKE + GCP L4" },
  { key: "after", label: "이후", source: "온프레미스 k3s + 노트북" },
] as const;
const replaySides = [
  { ...recordedSides[0], label: "기준" },
  { ...recordedSides[1], label: "비교", source: "노트북 시험 앱 + 로컬 GPU" },
] as const;
const verdictText = { pass: "품질 통과", fail: "품질 미통과", pending: "검토 대기" };
const millis = (value: number | null) => value === null
  ? "미측정"
  : value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + " ms";
const count = (value: number, total: number) => fmt(value) + " / " + fmt(total) + "건";

function quality({ qualityPassed, qualityPending, total }: AiVerificationResult["before"]) {
  const pending = "검토 대기 " + fmt(qualityPending) + "건";
  if (qualityPending === total) return pending;
  return count(qualityPassed, total) + (qualityPending ? " · " + pending : "");
}

export function RunAIVerification() {
  const id = useId();
  const [result, setResult] = useState<AiVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function loadResults(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;

    setResult(null);
    setError(null);
    if (files.length !== 2) {
      setError("이전·이후 JSON 파일을 한 개씩 함께 선택하세요.");
      return;
    }

    setReading(true);
    try {
      const documents = await Promise.all(files.map(async (file) => JSON.parse(await file.text()) as unknown));
      setResult(parseAiVerificationResults(documents));
    } catch (reason) {
      setError(reason instanceof SyntaxError ? "JSON 형식이 올바르지 않습니다."
        : reason instanceof Error && !(reason instanceof DOMException) ? reason.message
        : "선택한 파일을 읽지 못했습니다.");
    } finally {
      setReading(false);
    }
  }

  const reconstructed = result?.reconstructed === true;
  const sides = reconstructed ? replaySides : recordedSides;
  const metrics = result && [
    ["응답 시간 중앙값", ...sides.map(({ key }) => millis(result[key].medianLatencyMs))],
    ["실패 요청 수", ...sides.map(({ key }) => count(result[key].failed, result[key].total))],
    ["품질 통과 수", ...sides.map(({ key }) => quality(result[key]))],
  ];

  return <section className="box run-ai-verification" aria-labelledby={id}>
    <div className="bh">
      <h3 id={id}>AI 검증</h3>
      <span role="status"><Chip kind={reconstructed ? "neu" : ""}>{reading ? "읽는 중" : reconstructed
        ? "이전 후 재현 측정" : result ? "파일에서 불러옴" : "미측정"}</Chip></span>
    </div>
    <div className="bb">
      <p className="hint" id={id + "-files"}>
        같은 주소에서 수집한 <code>before-gke-l4.json</code>과 <code>after-onprem-laptop.json</code>을 선택하세요. 파일은 현재 브라우저에서만 읽습니다.
      </p>
      <label className="run-ai-files">
        검증 결과 JSON
        <input type="file" accept=".json,application/json" multiple disabled={reading} aria-describedby={id + "-files"} onChange={loadResults} />
      </label>
      {error && <p className="result-warning" role="alert">{error}</p>}
      {result && metrics && <>
        <p className="hint">{reconstructed ? "격리 시험 환경에서 같은 Q01~Q10을 다시 측정했습니다. 표의 시간은 시험 경로에서 성공한 요청의 왕복 시간입니다."
          : "이전 실행 기록과 별도로 가져온 측정 결과입니다. 응답 시간은 성공한 요청의 클라이언트 왕복 시간입니다."}</p>
        <table className="run-ai-metrics" aria-label="가져온 AI 검증 결과">
          <thead><tr><th scope="col">측정 항목</th>
            {sides.map(({ key, label, source }) => <th key={key} scope="col">{label}<br />{source}</th>)}
          </tr></thead>
          <tbody>{metrics.map(([label, before, after]) => <tr key={label}>
            <th scope="row">{label}</th><td>{before}</td><td>{after}</td>
          </tr>)}</tbody>
        </table>
        {result.cases.length > 0 && <div className="run-ai-cases">
          <h4>대표 답변</h4>
          {result.cases.map((example) => <div key={example.id}>
            <b>{example.id}</b>
            <dl>{sides.map(({ key, label }) => <div key={key}>
              <dt>{label}</dt>
              <dd>{example[key].answer ?? "응답 없음"}</dd>
              <dd className="hint">{millis(example[key].elapsedMs)} · {verdictText[example[key].verdict]}</dd>
            </div>)}</dl>
          </div>)}
        </div>}
      </>}
    </div>
  </section>;
}
