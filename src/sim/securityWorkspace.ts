// Demonstration fixtures only; never a scan of the team's actual images or cloud resources.
import type { EnvId, ControlEvaluation, VulnerabilityFinding, SecurityFindingRow, SecuritySourceRow, SecurityDataset } from "../data/security";
import { SIM_SECURITY } from "./security";

export const DEMO_SECURITY_ENVIRONMENTS: { id: EnvId; label: string; provider: string }[] = [
  { id: "eks", label: "AWS EKS", provider: "AWS" },
  { id: "gke", label: "GCP GKE", provider: "GCP" },
  { id: "k3s", label: "onprem k3s", provider: "ON-PREM" },
];
export const DEMO_SECURITY_AT = "2026-11-06T00:30:00+09:00";
export const DEMO_SECURITY_META = {
  mode: "fixture" as const,
  label: "로컬 화면 시연 · 실제 점검 결과 아님",
  detail: "자산·패키지·평가·수집 상태·EPSS 값은 화면 설명용 가상 데이터입니다. CVE 원문과 점수의 출처는 각 항목에 표시합니다.",
};
const nist = "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final";
const pss = "https://kubernetes.io/docs/concepts/security/pod-security-standards/";
const netpol = "https://kubernetes.io/docs/concepts/services-networking/network-policies/";
export const DEMO_SECURITY_CONTROLS: ControlEvaluation[] = [
  { id: "ctl-eks-root-mfa", title: "root 계정 MFA", controlId: "AWS IAM.9", domain: "identity", environment: "eks", status: "fail",
    basisUrl: "https://docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-9", evidence: "시연: root 자격증명이 있고 MFA가 등록되지 않은 계정 예시입니다.", recommendation: "root 계정의 MFA를 구성하고 자격증명 보관 정책을 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-eks-role", title: "앱 서비스 계정의 최소 권한", controlId: "NIST AC-6 · 부분 매핑", domain: "identity", environment: "eks", app: "moimroom", status: "pass",
    basisUrl: nist, evidence: "시연: 앱 계정에 해당 namespace의 workload 조회 권한만 부여한 예시입니다.", recommendation: "권한 변경 시 다시 평가합니다. 이 검사만으로 AC-6 전체 준수를 증명하지 않습니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-eks-key-review", title: "플랫폼 저장소 키 권한 확인", controlId: "HopCharlie KEY-01 · 제안", domain: "identity", environment: "eks", app: "platform", status: "unknown",
    basisUrl: nist, evidence: "시연: 키 정책 조회 권한이 부족해 권한 범위를 확인하지 못했습니다.", recommendation: "소유자가 조회 권한과 키의 실제 사용 범위를 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-eks-encryption", title: "신규 EBS 볼륨의 기본 암호화", controlId: "AWS EC2.7", domain: "data", environment: "eks", status: "pass",
    basisUrl: "https://docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html#ec2-7", evidence: "시연: 해당 리전의 기본 암호화가 켜진 예시입니다. 기존 모든 볼륨의 암호화를 증명하지는 않습니다.", recommendation: "기존 볼륨·DB의 암호화는 별도 검사합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-eks-audit", title: "CloudTrail 관리 이벤트 기록", controlId: "AWS CloudTrail.1", domain: "logging", environment: "eks", status: "fail",
    basisUrl: "https://docs.aws.amazon.com/securityhub/latest/userguide/cloudtrail-controls.html#cloudtrail-1", evidence: "시연: multi-Region trail의 쓰기 관리 이벤트가 빠진 예시입니다.", recommendation: "다중 리전 trail과 읽기·쓰기 관리 이벤트 구성을 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-eks-privileged", title: "특권 컨테이너 제한", controlId: "Kubernetes PSS Baseline", domain: "policy", environment: "eks", app: "moimroom", status: "fail",
    basisUrl: pss, evidence: "시연: legacy-web 컨테이너가 privileged로 설정된 예시입니다.", recommendation: "특권 실행을 제거하고 필요한 capability만 명시합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-eks-scan", title: "실행 이미지 취약점 결과 확보", controlId: "NIST RA-5 · 부분 매핑", domain: "vulnerability", environment: "eks", app: "moimroom", status: "pass",
    basisUrl: nist, evidence: "시연: 이미지 digest와 검사 결과가 연결된 예시입니다. 결과 확보는 취약점 0건을 뜻하지 않습니다.", recommendation: "발견 항목과 DB 갱신 시각을 함께 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-gke-iam", title: "프로젝트 서비스 계정 권한 검토", controlId: "NIST AC-6 · 부분 매핑", domain: "identity", environment: "gke", app: "platform", status: "unknown",
    basisUrl: nist, evidence: "시연: SCC가 연결되지 않아 프로젝트 IAM 평가 결과가 없습니다.", recommendation: "프로젝트 IAM 수집 범위와 권한을 준비합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-gke-encryption", title: "앱 데이터 전송 암호화", controlId: "NIST SC-8 · 부분 매핑", domain: "data", environment: "gke", app: "moimroom", status: "pass",
    basisUrl: nist, evidence: "시연: 앱의 DB 접속에 TLS가 적용된 설정 예시입니다. 저장 암호화는 별도 범위입니다.", recommendation: "인증서 검증과 실제 연결 조건을 계속 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-gke-audit", title: "Cloud Audit Logs 보관 정책", controlId: "NIST AU-11 · 부분 매핑", domain: "logging", environment: "gke", status: "unknown",
    basisUrl: nist, evidence: "시연: 로그 버킷의 보관 기간을 읽지 못했습니다.", recommendation: "보관 정책과 관련 로그 수집 범위를 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-gke-netpol", title: "앱 namespace 기본 차단 정책", controlId: "Kubernetes NetworkPolicy", domain: "policy", environment: "gke", app: "moimroom", status: "fail",
    basisUrl: netpol, evidence: "시연: 앱 Pod에 적용되는 ingress 기본 차단 정책이 없는 예시입니다. CNI 집행 여부는 별도 확인해야 합니다.", recommendation: "필요한 허용 규칙과 기본 차단을 설계하고 허용·거부 통신을 검증합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-gke-scan", title: "실행 이미지 취약점 결과 확보", controlId: "NIST RA-5 · 부분 매핑", domain: "vulnerability", environment: "gke", app: "moimroom", status: "pass",
    basisUrl: nist, evidence: "시연: EKS와 같은 image digest의 검사 결과를 연결한 예시입니다. 실제 registry 조회는 수행하지 않았습니다.", recommendation: "실행 manifest digest와 검사 대상의 일치를 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-k3s-role", title: "플랫폼 서비스 계정의 최소 권한", controlId: "NIST AC-6 · 부분 매핑", domain: "identity", environment: "k3s", app: "platform", status: "pass",
    basisUrl: nist, evidence: "시연: namespace 범위 RoleBinding을 사용하는 예시입니다.", recommendation: "불필요한 cluster-admin 부여 여부는 별도 평가합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-k3s-encryption", title: "앱 데이터 볼륨 저장 암호화", controlId: "NIST SC-28 · 부분 매핑", domain: "data", environment: "k3s", app: "moimroom", status: "unknown",
    basisUrl: nist, evidence: "시연: 노드 디스크 암호화 증거를 수집하지 못했습니다.", recommendation: "스토리지 운영자에게 디스크·PV·DB 암호화 증거를 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-k3s-audit", title: "Kubernetes API 감사 로그", controlId: "NIST AU-12 · 부분 매핑", domain: "logging", environment: "k3s", app: "platform", status: "unknown",
    basisUrl: nist, evidence: "시연: 최신 감사 정책과 로그 수집 상태가 확인되지 않았습니다.", recommendation: "API 서버 audit 정책·실제 기록·보관 경로를 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-k3s-policy", title: "호스트 PID namespace 공유 제한", controlId: "Kubernetes PSS Baseline", domain: "policy", environment: "k3s", app: "platform", status: "fail",
    basisUrl: pss, evidence: "시연: 운영 도구 Pod가 hostPID를 사용하는 예시입니다.", recommendation: "hostPID 필요성을 검토하고 예외가 필요하면 범위와 만료를 명시합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-k3s-scan", title: "실행 이미지 취약점 결과 확보", controlId: "NIST RA-5 · 부분 매핑", domain: "vulnerability", environment: "k3s", app: "moimroom", status: "unknown",
    basisUrl: nist, evidence: "시연: private registry 인증 오류로 현재 이미지 검사가 완료되지 않았습니다.", recommendation: "registry 읽기 권한을 분리해 준비하고 새 검사를 수행합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "ctl-k3s-aws-mfa", title: "AWS root MFA 적용성", controlId: "AWS IAM.9", domain: "identity", environment: "k3s", status: "not_applicable",
    basisUrl: "https://docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-9", evidence: "시연: 이 평가 대상은 AWS 계정이 아닌 온프레미스 클러스터입니다. AWS root MFA 검사는 적용 대상이 아닙니다.", recommendation: "온프레미스 관리자 인증은 별도 통제로 평가합니다.", observedAt: DEMO_SECURITY_AT },
];

// Digests and execution locations below are invented; they do not describe the real moimroom dependency graph.
const appDigest = "sha256:4e8965c9a883fe35cbd509adbb62008ec66e03af5e0d342146f7a917e2d814b5";
const toolDigest = "sha256:9f1a7826ec6442cd3418c18c7cc45b7de61e8704a93dc34cc617826ff342ab01";
const appOccurrences: VulnerabilityFinding["occurrences"] = [
  { environment: "eks", app: "moimroom", namespace: "moimroom", workload: "Deployment/legacy-web", running: true },
  { environment: "gke", app: "moimroom", namespace: "moimroom", workload: "Deployment/legacy-web", running: true },
];
export const DEMO_SECURITY_VULNERABILITIES: VulnerabilityFinding[] = [
  { id: "vuln-log4shell", advisory: "CVE-2021-44228", title: "Log4Shell · JNDI 원격 코드 실행", package: "org.apache.logging.log4j:log4j-core", installedVersion: "2.14.1", fixedVersion: "2.15.0",
    severity: "critical", cvss: 10, cvssVersion: "3.1", cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", scoreSource: "Apache 공식 advisory",
    basisUrl: "https://logging.apache.org/security.html#CVE-2021-44228", kev: true, epss: 0.94, epssDate: "2026-11-06", imageDigest: appDigest, occurrences: appOccurrences,
    detail: "가상 Java 이미지에 log4j-core가 포함된 예시입니다. 실제 moimroom의 패키지 목록이 아닙니다. CVSS 10.0은 Apache 원문, EPSS 94%와 연결된 자산은 화면 시연용 값입니다.",
    recommendation: "2.15.0은 이 CVE의 최초 수정 버전입니다. 후속 Log4j 취약점도 있으므로 실제 조치에서는 지원 중인 최신 패치 버전과 Java 호환성을 확인합니다." },
  { id: "vuln-commons-text", advisory: "CVE-2022-42889", title: "Commons Text · 신뢰하지 않는 입력 보간", package: "org.apache.commons:commons-text", installedVersion: "1.9", fixedVersion: "1.10.0",
    severity: "critical", cvss: 9.8, cvssVersion: "3.1", cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", scoreSource: "NIST NVD CVSS 3.1",
    basisUrl: "https://nvd.nist.gov/vuln/detail/CVE-2022-42889", kev: null, epss: null, epssDate: null, imageDigest: appDigest, occurrences: appOccurrences,
    detail: "같은 가상 이미지의 다른 패키지 발생 건입니다. 패키지 존재만으로 악용 가능성을 확정하지 않습니다. Apache는 StringSubstitutor에 검증되지 않은 입력을 전달하는 조건을 설명합니다. KEV·EPSS는 이 예시에서 조회하지 않았습니다.",
    recommendation: "Apache 권고의 1.10.0 이상과 입력 검증을 검토합니다. 원문: https://commons.apache.org/proper/commons-text/security.html" },
  { id: "vuln-regresshion", advisory: "CVE-2024-6387", title: "OpenSSH · 인증 전 signal handler 경쟁 조건", package: "openssh-server", installedVersion: "9.7p1", fixedVersion: null,
    severity: "high", cvss: 8.1, cvssVersion: "3.1", cvssVector: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", scoreSource: "NIST NVD / Red Hat CNA CVSS 3.1",
    basisUrl: "https://nvd.nist.gov/vuln/detail/CVE-2024-6387", kev: null, epss: null, epssDate: null, imageDigest: toolDigest,
    occurrences: [
      { environment: "k3s", app: "platform", namespace: "platform-tools", workload: "Job/archive-tool", running: false },
      { environment: "eks", app: "platform", namespace: "platform-tools", workload: "Deployment/maintenance", running: null },
    ],
    detail: "가상 운영 도구 이미지 예시입니다. 종료된 Job과 실행 여부가 미확인인 workload를 구분합니다. 이 결과에는 배포판별 수정 버전을 제공하지 않았으며, 수정 버전이 실제로 없다는 뜻이 아닙니다.",
    recommendation: "배포판 보안 advisory와 backport를 확인해 실제 수정 패키지를 선택합니다. 실행 여부 미확인은 비실행 판정으로 바꾸지 않습니다." },
];

export const DEMO_SECURITY_FINDINGS: SecurityFindingRow[] = [
  { id: "finding-root-mfa", category: "identity", title: "root 계정에 MFA가 설정되지 않음", kind: "configuration", environment: "eks", severity: "critical", source: "AWS 설정 점검 · 시연", controlId: "AWS IAM.9",
    basisUrl: "https://docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-9", resource: "AWS account / root", detail: "가상 계정 설정 예시입니다. 실제 계정의 MFA 상태를 조회한 결과가 아닙니다.", recommendation: "root MFA와 자격증명 보관을 확인합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "finding-cloudtrail", category: "logging", title: "CloudTrail 쓰기 관리 이벤트 기록 미설정", kind: "configuration", environment: "eks", severity: "high", source: "AWS 설정 점검 · 시연", controlId: "AWS CloudTrail.1",
    basisUrl: "https://docs.aws.amazon.com/securityhub/latest/userguide/cloudtrail-controls.html#cloudtrail-1", resource: "trail/example-audit", detail: "가상 trail 예시입니다. 기록하지 않은 이벤트와 실제 저장·보관 범위를 확인해야 합니다.", recommendation: "다중 리전 trail의 읽기·쓰기 이벤트 기록을 구성합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "finding-netpol", category: "network", title: "앱 Pod에 기본 차단 정책이 적용되지 않음", kind: "configuration", environment: "gke", app: "moimroom", severity: "medium", source: "Kubernetes 점검 · 시연", controlId: "NetworkPolicy · 프로젝트 정책",
    basisUrl: netpol, resource: "namespace/moimroom", detail: "가상 Pod 선택 범위 예시입니다. 정책 객체의 존재와 CNI 집행·실제 통신 검증은 별도입니다. Medium은 프로젝트 시연 정책이며 Kubernetes 공식 위험 등급이 아닙니다.", recommendation: "필요한 허용과 기본 차단을 설계하고 통신을 검증합니다.", observedAt: DEMO_SECURITY_AT },
  { id: "finding-blocked-request", category: "identity", title: "승인 권한 없는 요청 3회 — 모두 차단", kind: "governance", environment: "eks", app: "platform", severity: "medium", source: "플랫폼 감사 로그 · 시연", controlId: "HopCharlie AUTH-01 · 제안",
    basisUrl: nist, resource: "POST /v1/plans/{ref}/approve", detail: "가상 HTTP 403 감사 이벤트입니다. 역할 검사가 동작한 예시이며, 공격 성공이나 권한 획득을 의미하지 않습니다. 등급은 로컬 운영 정책입니다.", recommendation: "호출자의 목적·도구를 검토합니다. 편의를 위해 승인 권한을 자동으로 넓히지 않습니다.", observedAt: DEMO_SECURITY_AT },
  { id: "finding-port-probe", category: "threat", title: "보호되지 않은 포트 탐색 신호", kind: "threat", environment: "eks", app: "moimroom", severity: "low", source: "GuardDuty · 시연", basisUrl: "https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_finding-types-ec2.html",
    resource: "instance/example-web", detail: "GuardDuty 유형을 참고한 가상 탐지 신호입니다. 실제 GuardDuty finding을 수집한 것이 아니며, 이 낮음 등급은 시연용입니다.", recommendation: "탐색 대상 포트·보안 그룹과 관련 접속 로그를 확인합니다.", observedAt: DEMO_SECURITY_AT },
];

export const DEMO_SECURITY_SOURCES: SecuritySourceRow[] = [
  { id: "source-aws", name: "Security Hub", environment: "eks", status: "ok", scope: "계정 설정·공식 통제", lastCollected: DEMO_SECURITY_AT, lastScanned: DEMO_SECURITY_AT,
    detail: "가상 수집 성공 예시입니다. source 조회 성공이 모든 개별 통제 통과를 뜻하지 않습니다." },
  { id: "source-image", name: "이미지 취약점 검사", environment: "eks", app: "moimroom", status: "ok", scope: "가상 앱 이미지 digest 1개", lastCollected: DEMO_SECURITY_AT, lastScanned: DEMO_SECURITY_AT,
    scannerVersion: "시연 엔진 · 미실행", databaseUpdatedAt: "2026-11-05T22:00:00+09:00", detail: "실제 Grype·Trivy를 실행하지 않았습니다. 패키지·결과·DB 시각 연결을 설명하는 시연입니다." },
  { id: "source-gcp", name: "Security Command Center", environment: "gke", status: "not_configured", scope: "프로젝트 IAM·로그·클라우드 설정", lastCollected: null, lastScanned: null,
    detail: "미연결 상태 예시입니다. GKE Kubernetes 점검 성공만으로 SCC 범위까지 확인됐다고 표시하지 않습니다." },
  { id: "source-gke-image", name: "이미지 취약점 검사", environment: "gke", app: "moimroom", status: "ok", scope: "동일 digest의 검사 결과 연결", lastCollected: DEMO_SECURITY_AT, lastScanned: DEMO_SECURITY_AT,
    scannerVersion: "시연 엔진 · 미실행", databaseUpdatedAt: "2026-11-05T22:00:00+09:00", detail: "가상 자산 연결 예시입니다. 같은 이미지 분석과 두 환경의 실행 위치를 구분합니다." },
  { id: "source-k3s-registry", name: "Private registry", environment: "k3s", app: "moimroom", status: "error", scope: "현재 실행 이미지 검사", lastCollected: DEMO_SECURITY_AT, lastScanned: null,
    detail: "시연 오류: registry 인증 권한 부족. 미검사를 취약점 0건으로 바꾸지 않습니다. credential 값은 표시하지 않습니다." },
  { id: "source-k3s-kube", name: "Kubernetes 설정", environment: "k3s", app: "platform", status: "stale", scope: "RBAC·Pod 보안 설정", lastCollected: "2026-11-03T09:00:00+09:00", lastScanned: "2026-11-03T09:00:00+09:00",
    detail: "오래된 가상 결과 예시입니다. 마지막 성공 데이터는 보존하지만 현재 상태로 확정하지 않습니다." },
  { id: "source-k3s-node", name: "노드·커널 취약점", environment: "k3s", status: "unsupported", scope: "node OS·kernel·container runtime", lastCollected: null, lastScanned: null,
    detail: "이 로컬 미리보기의 검사 범위에 포함되지 않습니다. 앱 이미지 CVE 결과가 노드 CVE 검사 완료를 뜻하지 않습니다." },
];


export const DEMO_SECURITY_DATA: SecurityDataset = {
  mode: "demo", generatedAt: DEMO_SECURITY_AT, environments: DEMO_SECURITY_ENVIRONMENTS,
  apps: ["moimroom", "platform"], appFilterAvailable: true,
  controls: DEMO_SECURITY_CONTROLS, vulnerabilities: DEMO_SECURITY_VULNERABILITIES,
  findings: DEMO_SECURITY_FINDINGS, sources: DEMO_SECURITY_SOURCES,
  storageKeys: SIM_SECURITY.storageKeys,
  storageKeySources: SIM_SECURITY.sources.filter((source) => source.name === "storage-keys"),
};
