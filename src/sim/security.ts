// MOCK: 시뮬레이션 모드의 보안 화면용 고정 데이터. API에 연결하면 GET /v1/security 결과로 바뀐다.
import type { SecurityFinding, SecurityReport } from "../api/types";

const at = "2026-11-06T00:50:00Z";

const findings: SecurityFinding[] = [
  {
    id: "f1", environment: "eks", provider: "aws", source: "Security Hub", check: "EKS.1", category: "network", severity: "high",
    title: "EKS API 엔드포인트가 공개되어 있음", resource: "cluster/charlie-eks", detail: "퍼블릭 엔드포인트 접근 대역이 0.0.0.0/0입니다.",
    recommendation: "Tailscale 대역과 관리 호스트 주소만 허용", observedAt: at,
  },
  {
    id: "f2", environment: "gke", provider: "gcp", source: "Security Command Center", check: "OPEN_FIREWALL", category: "network", severity: "medium",
    title: "방화벽 규칙이 넓은 대역을 허용", resource: "firewall/allow-ingress-8080", detail: "8080 포트를 모든 주소에 열어 두었습니다.",
    recommendation: "게이트웨이 주소로 좁히기", observedAt: at,
  },
  {
    id: "f3", environment: "k3s", provider: "onprem", source: "platform", check: "NETPOL_MISSING", category: "workload", severity: "medium",
    title: "NetworkPolicy가 없는 네임스페이스", resource: "namespace/monitoring", detail: "기본 차단 정책이 없습니다.",
    recommendation: "기본 차단 NetworkPolicy 적용", observedAt: at,
  },
  {
    id: "f4", environment: "eks", provider: "aws", source: "GuardDuty", check: "Recon:EC2/PortProbeUnprotectedPort", category: "threat", severity: "low",
    title: "보호되지 않은 포트에 탐색 시도", resource: "instance/i-0abc", detail: "외부에서 포트 탐색이 있었습니다.",
    recommendation: "보안 그룹 확인", observedAt: at,
  },
  {
    id: "f5", environment: "gke", provider: "platform", source: "platform", check: "AUDIT_LOG", category: "logging", severity: "info",
    title: "감사 로그 보관 30일", resource: "project/charlie", detail: "기본 보관 기간입니다.",
    recommendation: "필요하면 보관 기간 늘리기", observedAt: at,
  },
];

export const SIM_SECURITY: SecurityReport = {
  generatedAt: at,
  summary: {
    bySeverity: { total: 5, critical: 0, high: 1, medium: 2, low: 1, info: 1 },
    byEnvironment: {
      eks: { total: 2, critical: 0, high: 1, medium: 0, low: 1, info: 0 },
      gke: { total: 2, critical: 0, high: 0, medium: 1, low: 0, info: 1 },
      k3s: { total: 1, critical: 0, high: 0, medium: 1, low: 0, info: 0 },
    },
  },
  sources: [
    { name: "Security Hub", provider: "aws", environment: "eks", status: "ok", checkedAt: at, findings: 1 },
    { name: "GuardDuty", provider: "aws", environment: "eks", status: "ok", checkedAt: at, findings: 1 },
    { name: "Security Command Center", provider: "gcp", environment: "gke", status: "ok", checkedAt: at, findings: 1 },
    { name: "platform", provider: "platform", environment: "k3s", status: "ok", checkedAt: at, findings: 1 },
  ],
  findings,
};
