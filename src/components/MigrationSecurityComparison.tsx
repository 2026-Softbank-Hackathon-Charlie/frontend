import { useState } from "react";
import type { Run } from "../api/types";
import { Icon } from "./Icon";
import { EnvLabel, envName } from "./shared";
import { Chip } from "./ui";
import "../styles/migration-security-comparison.css";

const PSS_BASELINE_URL = "https://kubernetes.io/docs/concepts/security/pod-security-standards/#baseline";

const outcomes = {
  fail: {
    choice: "통과 → 실패", label: "실패", tone: "bad", summary: "새 위반",
    reason: "대상 web 컨테이너에서 특권 설정을 확인했습니다.",
    evidence: "securityContext.privileged: true",
    timing: "평가 시각", next: "대상 워크로드의 특권 설정을 확인하세요.",
  },
  unknown: {
    choice: "통과 → 미확인", label: "미확인", tone: "warn", summary: "확인 필요",
    reason: "대상 Pod 조회 권한이 없어 증거를 수집하지 못했습니다.",
    evidence: "Kubernetes API · 403 Forbidden",
    timing: "평가 시도", next: "Pod 조회 권한을 확인한 뒤 다시 평가하세요.",
  },
} as const;

export function DemoMigrationSecurityComparison() {
  const [selected, setSelected] = useState<keyof typeof outcomes>("fail");
  const target = outcomes[selected];
  return <section className="box migration-security-comparison" aria-label="보안 비교">
    <div className="bh">
      <h3 className="icon-label"><Icon name="shield-check" size={16} />보안 비교</h3>
      <Chip>시연 데이터</Chip>
    </div>
    <div className="bb migration-security-body">
      <div className="migration-security-control">
        <p><code>HC-POL-02</code> <strong>특권 컨테이너 금지</strong></p>
        <p className="hint"><code>moimroom-mig / Deployment/moimroom-mig-web</code></p>
      </div>
      <div className="chips" role="group" aria-label="판정 변화 예시">
        {(["fail", "unknown"] as const).map((scenario) => <button key={scenario} type="button"
          className={`btn sm ${selected === scenario ? "primary" : "ghost"}`}
          aria-pressed={selected === scenario} onClick={() => setSelected(scenario)}>{outcomes[scenario].choice}</button>)}
      </div>
      <div className="migration-security-pair">
        <div className="migration-security-side">
          <div className="migration-security-side-heading">
            <div><p className="hint">이전 전</p><b><EnvLabel env="eks" label="AWS EKS" /></b></div>
            <Chip kind="ok" dot>통과</Chip>
          </div>
          <p>조회한 컨테이너에 특권 설정이 없습니다.</p>
          <p className="hint migration-security-time"><span>평가 시각</span> <time dateTime="2026-11-07T14:20:00+09:00">2026-11-07 14:20 KST</time></p>
        </div>
        <div className="migration-security-side">
          <div className="migration-security-side-heading">
            <div><p className="hint">전환 직전</p><b><EnvLabel env="gke" label="GCP GKE" /></b></div>
            <Chip kind={target.tone} dot>{target.label}</Chip>
          </div>
          <p>{target.reason}</p>
          <code>{target.evidence}</code>
          <p className="hint migration-security-time"><span>{target.timing}</span> <time dateTime="2026-11-07T14:23:00+09:00">2026-11-07 14:23 KST</time></p>
        </div>
      </div>
      <div className={`migration-security-verdict ${target.tone}`} role="status">
        <strong>{target.summary}</strong><span>{target.next}</span>
      </div>
      <div className="hint migration-security-basis">
        <a href={PSS_BASELINE_URL} target="_blank" rel="noreferrer">Kubernetes PSS Baseline</a>
        <span><span>정책 버전</span> <code>hopcharlie-security-policy/2026-11-06.1</code></span>
      </div>
    </div>
  </section>;
}

type RunSecurityComparison = NonNullable<Run["securityComparison"]>;
type Assessment = NonNullable<RunSecurityComparison["source"]>;

const assessmentStatus = {
  pass: { label: "통과", tone: "ok" },
  fail: { label: "실패", tone: "bad" },
  unknown: { label: "미확인", tone: "warn" },
  not_applicable: { label: "해당 없음", tone: "neu" },
} as const;

const assessmentReason: Record<Assessment["reason"], string> = {
  clear: "조회한 컨테이너에 특권 설정이 없습니다.",
  privileged: "조회한 컨테이너에서 특권 설정을 확인했습니다.",
  forbidden: "Pod 조회 권한이 없어 증거를 수집하지 못했습니다.",
  unavailable: "Kubernetes API에서 Pod를 조회하지 못했습니다.",
  workload_not_ready: "평가할 워크로드 Pod가 준비되지 않았습니다.",
};

function SavedAssessment({ stage, env, assessment }: { stage: string; env: string; assessment?: Assessment }) {
  const status = assessment ? assessmentStatus[assessment.result] : { label: "기록 없음", tone: "neu" } as const;
  return <div className="migration-security-side">
    <div className="migration-security-side-heading">
      <div><p className="hint">{stage}</p><b><EnvLabel env={env} label={envName(env)} /></b></div>
      <Chip kind={status.tone} dot>{status.label}</Chip>
    </div>
    {assessment && <>
      <p className="hint"><code>{assessment.workload}</code></p>
      <p>{assessmentReason[assessment.reason]}</p>
      {assessment.evidence && <code>{assessment.evidence}</code>}
      <p className="hint migration-security-time">
        <span>{assessment.result === "unknown" ? "평가 시도" : "평가 시각"}</span>{" "}
        <time dateTime={assessment.assessedAt}>{new Date(assessment.assessedAt).toLocaleString("ko-KR", { hour12: false, timeZoneName: "short" })}</time>
      </p>
      <p className="hint"><span>정책 버전</span> <code>{assessment.policyVersion}</code></p>
    </>}
  </div>;
}

export function SavedMigrationSecurityComparison({ run }: { run: Run }) {
  if (!run.securityComparison) return null;
  const { controlId, source, target } = run.securityComparison;
  let warning: string | undefined;
  if (!source || !target) {
    warning = "두 시점의 판정 기록을 확인하세요.";
  } else if (source.policyVersion !== target.policyVersion) {
    warning = "두 판정에 사용된 정책 버전이 다릅니다.";
  } else if (source.result === "unknown" || target.result === "unknown") {
    warning = "미확인 판정의 근거를 확인하세요.";
  }
  const privilegedControl = controlId === "HC-POL-02";
  const newViolation = privilegedControl && !warning && source?.result === "pass" && target?.result === "fail";
  return <section className="box migration-security-comparison" aria-label="보안 비교">
    <div className="bh">
      <h3 className="icon-label"><Icon name="shield-check" size={16} />보안 비교</h3>
    </div>
    <div className="bb migration-security-body">
      <div className="migration-security-control">
        <p><code>{controlId}</code>{privilegedControl && <> <strong>특권 컨테이너 금지</strong></>}</p>
      </div>
      <div className="migration-security-pair">
        <SavedAssessment stage="이전 전" env={run.source.env} assessment={source} />
        <SavedAssessment stage="전환 직전" env={run.target.env} assessment={target} />
      </div>
      {warning && <div className="migration-security-verdict warn" role="status">
        <strong>확인 필요</strong><span>{warning}</span>
      </div>}
      {newViolation && <div className="migration-security-verdict bad" role="status">
        <strong>새 위반</strong><span>대상 워크로드의 특권 설정을 확인하세요.</span>
      </div>}
      {privilegedControl && <div className="hint migration-security-basis">
        <a href={PSS_BASELINE_URL} target="_blank" rel="noreferrer">Kubernetes PSS Baseline</a>
      </div>}
    </div>
  </section>;
}
