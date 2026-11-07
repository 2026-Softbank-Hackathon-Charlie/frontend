import type { CanaryStep, Run } from "../api/types";

export function canaryStepVerdict(step?: CanaryStep) {
  // Older runs only recorded gate.passed.
  return step?.verdict ?? (step?.gate ? (step.gate.passed ? "ok" : "failed") : undefined);
}

export function canaryVerdict(r: Run) {
  const c = r.canary;
  if (!c) return undefined;

  const steps = c.options.weights.map((_, i) => c.steps[i]);
  const failed = steps.find((step) => canaryStepVerdict(step) === "failed");
  if (failed || c.passed === false) return { label: "게이트 실패", state: "fail", reason: failed?.gate?.reason } as const;

  const verdicts = steps.map(canaryStepVerdict);
  const passed = verdicts.filter((verdict) => verdict === "ok").length;
  const inconclusive = verdicts.filter((verdict) => verdict === "inconclusive").length;
  if (passed > 0 && passed === steps.length) return { label: "게이트 모두 통과", state: "done" } as const;
  if (inconclusive) return { label: "통과 " + passed + "단계 · 판단 보류 " + inconclusive + "단계", state: "warn" } as const;
  if (r.status === "running" && r.phase === "canary") return { label: "진행 중", state: "cur" } as const;
  if (r.status === "running" && r.phase === "sync") return { label: "동기화 뒤 시작", state: "todo" } as const;
  return { label: "게이트 판정 기록 부족", state: "todo" } as const;
}
