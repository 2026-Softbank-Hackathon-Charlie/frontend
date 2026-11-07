import type { Run } from "../api/types";

const runId = "demo-moimroom-mig-security";
const planId = "moimroom-mig-eks-to-gke";
const startedAt = "2026-11-07T14:20:10+09:00";
const endedAt = "2026-11-07T14:24:10+09:00";
const namespace = "moimroom-mig";
const cluster = "moimroom-mig-db";

export const securityComparisonRun: Run = {
  runId, planId, planRef: "demo-plan-security", startedAt, updatedAt: endedAt, endedAt,
  source: { env: "eks", namespace, cluster },
  target: { env: "gke", namespace, cluster },
  status: "succeeded", phase: "done", startedBy: "demo", autoSwitch: false,
  result: { durationMillis: 240_000, downtimeMillis: 20_000, requests: 180, failedRequests: 0, missingRows: 0, missingFiles: 0 },
  engine: {
    runId, planId, createdAt: startedAt, updatedAt: endedAt, outcome: "succeeded",
    writesHeld: false, sourceDemoted: true, promoteRequested: true, trafficOnTarget: true,
    steps: {
      fence: { status: "succeeded" },
      switchover: { status: "succeeded" },
      cutover: { status: "succeeded" },
      verify: { status: "succeeded" },
    },
  },
};
