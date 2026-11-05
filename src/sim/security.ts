// MOCK: 시뮬레이션 모드의 보안 화면용 고정 데이터. API에 연결하면 GET /v1/security 결과로 바뀐다.
// 출처 이름은 플랫폼 수집기(security.Collectors)와 같다. GCP Security Command Center는 시연용으로
// 연결된 것처럼 두었다. 실제 플랫폼은 아직 연결하지 않아 not_configured로 보여 준다.
import type { SecurityFinding, SecurityReport, StorageKey } from "../api/types";

const at = "2026-11-06T00:50:00Z";

const findings: SecurityFinding[] = [
  {
    id: "f1", environment: "eks", provider: "aws", source: "aws-securityhub", check: "EKS.1", category: "network", severity: "high",
    title: "EKS API 엔드포인트가 공개되어 있음", resource: "cluster/charlie-eks", detail: "퍼블릭 엔드포인트 접근 대역이 0.0.0.0/0입니다.",
    recommendation: "Tailscale 대역과 관리 호스트 주소만 허용", observedAt: at,
  },
  {
    id: "f2", environment: "gke", provider: "gcp", source: "gcp-scc", check: "OPEN_FIREWALL", category: "network", severity: "medium",
    title: "방화벽 규칙이 넓은 대역을 허용", resource: "firewall/allow-ingress-8080", detail: "8080 포트를 모든 주소에 열어 두었습니다.",
    recommendation: "게이트웨이 주소로 좁히기", observedAt: at,
  },
  {
    id: "f3", environment: "k3s", provider: "onprem", source: "kubernetes", check: "k8s.no-network-policy", category: "network", severity: "medium",
    title: "NetworkPolicy가 없는 네임스페이스", resource: "namespace/monitoring", detail: "기본 차단 정책이 없습니다.",
    recommendation: "기본 차단 NetworkPolicy 적용", observedAt: at,
  },
  {
    id: "f4", environment: "eks", provider: "aws", source: "aws-guardduty", check: "Recon:EC2/PortProbeUnprotectedPort", category: "threat", severity: "low",
    title: "보호되지 않은 포트에 탐색 시도", resource: "instance/i-0abc", detail: "외부에서 포트 탐색이 있었습니다.",
    recommendation: "보안 그룹 확인", observedAt: at,
  },
  {
    id: "f5", environment: "gke", provider: "gcp", source: "gcp-scc", check: "AUDIT_LOGGING_DISABLED", category: "logging", severity: "info",
    title: "감사 로그 보관 30일", resource: "project/charlie", detail: "기본 보관 기간입니다.",
    recommendation: "필요하면 보관 기간 늘리기", observedAt: at,
  },
  {
    id: "f6", environment: "k3s", provider: "onprem", source: "kubernetes", check: "k8s.privileged", category: "workload", severity: "high",
    title: "privileged 컨테이너", resource: "monitoring/DaemonSet/node-exporter/exporter", detail: "호스트 권한으로 실행됩니다.",
    recommendation: "필요한 capability만 부여", observedAt: at,
  },
];

const s3Actions = ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads", "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"];

const storageKeys: StorageKey[] = [
  {
    app: "moimroom", instance: "moimroom", environment: "eks", driver: "aws", bucket: "hopcharlie-eks-moimroom", keyId: "...Q2XA", use: "current", state: "ok",
    createdAt: "2026-11-04T08:21:52Z", scope: { actions: s3Actions, boundary: "arn:aws:iam::123456789012:policy/hopcharlie-app-boundary" },
  },
  {
    app: "moimroom", instance: "moimroom", environment: "gke", driver: "gcs", bucket: "hopcharlie-gke-moimroom", keyId: "...7F3K", use: "current", state: "ok",
    createdAt: "2026-11-05T02:10:00Z", scope: { actions: ["roles/storage.objectAdmin", "roles/storage.legacyBucketReader"] },
  },
];

export const SIM_SECURITY: SecurityReport = {
  generatedAt: at,
  summary: {
    bySeverity: { total: 6, critical: 0, high: 2, medium: 2, low: 1, info: 1 },
    byEnvironment: {
      eks: { total: 2, critical: 0, high: 1, medium: 0, low: 1, info: 0 },
      gke: { total: 2, critical: 0, high: 0, medium: 1, low: 0, info: 1 },
      k3s: { total: 2, critical: 0, high: 1, medium: 1, low: 0, info: 0 },
    },
  },
  sources: [
    { name: "kubernetes", provider: "aws", environment: "eks", status: "ok", checkedAt: at, findings: 0 },
    { name: "aws-securityhub", provider: "aws", environment: "eks", status: "ok", checkedAt: at, findings: 1 },
    { name: "aws-guardduty", provider: "aws", environment: "eks", status: "ok", checkedAt: at, findings: 1 },
    { name: "kubernetes", provider: "gcp", environment: "gke", status: "ok", checkedAt: at, findings: 0 },
    { name: "gcp-scc", provider: "gcp", environment: "gke", status: "ok", checkedAt: at, findings: 2 },
    { name: "kubernetes", provider: "onprem", environment: "k3s", status: "ok", checkedAt: at, findings: 2 },
    { name: "storage-keys", provider: "aws", environment: "eks", status: "ok", message: "1 key of 1 instance", checkedAt: at, findings: 0 },
    { name: "storage-keys", provider: "gcp", environment: "gke", status: "ok", message: "1 key of 1 instance", checkedAt: at, findings: 0 },
  ],
  findings,
  storageKeys,
};
