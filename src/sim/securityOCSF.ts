// Demonstration fixture of GET /v1/security/ocsf (SEC-09); never an export of the team's actual resources.
// The events follow the platform's OCSF 1.9.0 mapping (internal/security/ocsf.go) with demo values.
import type { SecurityOCSFExport } from "../api/types";
import { DEMO_SECURITY_AT } from "./securityWorkspace";

const time = Date.parse(DEMO_SECURITY_AT);
const metadata = { version: "1.9.0", product: { name: "HopCharlie", vendor_name: "team-charlie" }, profiles: ["cloud"] };
const base = { activity_id: 1, activity_name: "Create", category_uid: 2, category_name: "Findings", time, metadata };
const detection = { ...base, class_uid: 2004, class_name: "Detection Finding", type_uid: 200401, type_name: "Detection Finding: Create" };
const compliance = { ...base, class_uid: 2003, class_name: "Compliance Finding", type_uid: 200301, type_name: "Compliance Finding: Create" };
const vulnerability = { ...base, class_uid: 2002, class_name: "Vulnerability Finding", type_uid: 200201, type_name: "Vulnerability Finding: Create" };
const status = { New: { status_id: 1, status: "New" }, Suppressed: { status_id: 3, status: "Suppressed" } };
const severity = { Low: { severity_id: 2, severity: "Low" }, Medium: { severity_id: 3, severity: "Medium" }, High: { severity_id: 4, severity: "High" }, Critical: { severity_id: 5, severity: "Critical" } };

export const DEMO_SECURITY_OCSF: SecurityOCSFExport = {
  ocsfVersion: "1.9.0",
  generatedAt: DEMO_SECURITY_AT,
  findings: [
    { ...compliance, ...severity.Critical, ...status.New, message: "시연: root 자격증명이 있고 MFA가 등록되지 않은 계정 예시입니다.", cloud: { provider: "aws" },
      finding_info: { uid: "finding-root-mfa", title: "root 계정에 MFA가 설정되지 않음", types: ["identity"], data_sources: ["AWS 설정 점검 · 시연"], analytic: { type_id: 1, type: "Rule", name: "aws.iam.root_mfa" } },
      resources: [{ uid: "arn:aws:iam::000000000000:root", labels: ["environment:eks"] }],
      remediation: { desc: "root 계정의 MFA를 구성하고 자격증명 보관 정책을 확인합니다." },
      compliance: { control: "AWS IAM.9", status_id: 3, status: "Fail" } },
    { ...detection, ...severity.Low, ...status.New, message: "시연: GuardDuty 유형을 참고한 가상 탐지 신호입니다.", cloud: { provider: "aws" },
      finding_info: { uid: "finding-port-probe", title: "보호되지 않은 포트 탐색 신호", types: ["threat"], data_sources: ["GuardDuty · 시연"], analytic: { type_id: 1, type: "Rule", name: "Recon:EC2/PortProbeUnprotectedPort" } },
      resources: [{ uid: "instance/example-web", labels: ["environment:eks"] }],
      remediation: { desc: "보안 그룹에서 노출된 포트를 확인합니다." } },
  ],
  vulnerabilities: [
    { ...vulnerability, ...severity.Critical, ...status.Suppressed, status_detail: "시연: 외부 노출 없는 배치 이미지, 다음 배포에서 교체 예정", cloud: { provider: "platform" },
      finding_info: { uid: "vuln-log4shell", title: "CVE-2021-44228 · org.apache.logging.log4j:log4j-core 2.14.1" },
      resources: [{ uid: "sha256:demo0000000000000000000000000000000000000000000000000000000000a1", labels: ["environment:eks"] }],
      vulnerabilities: [{ cve: { uid: "CVE-2021-44228", cvss: [{ base_score: 10, version: "3.1", vector_string: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" }], epss: { score: "0.94358", percentile: 0.99957 } },
        title: "Apache Log4j2 JNDI 원격 코드 실행", severity: "Critical",
        affected_packages: [{ name: "org.apache.logging.log4j:log4j-core", version: "2.14.1", type: "java-archive", fixed_in_version: "2.15.0" }],
        is_fix_available: true, is_exploit_available: true, exploit_ref_url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        references: ["https://nvd.nist.gov/vuln/detail/CVE-2021-44228"] }] },
    { ...vulnerability, ...severity.High, ...status.New, cloud: { provider: "platform" },
      finding_info: { uid: "vuln-regresshion", title: "CVE-2024-6387 · openssh-server 9.7p1" },
      resources: [{ uid: "sha256:demo0000000000000000000000000000000000000000000000000000000000b2", labels: ["environment:gke"] }],
      vulnerabilities: [{ cve: { uid: "CVE-2024-6387", cvss: [{ base_score: 8.1, version: "3.1", vector_string: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H" }] },
        title: "OpenSSH 신호 처리 경쟁 조건", severity: "High",
        affected_packages: [{ name: "openssh-server", version: "9.7p1", type: "deb" }],
        references: ["https://nvd.nist.gov/vuln/detail/CVE-2024-6387"] }] },
  ],
  controls: [
    { ...compliance, ...severity.Medium, ...status.New, cloud: { provider: "platform" },
      finding_info: { uid: "ctl-eks-encryption", title: "신규 EBS 볼륨의 기본 암호화", analytic: { type_id: 1, type: "Rule", name: "aws.ec2.ebs_default_encryption" }, data_sources: ["AWS 설정 점검 · 시연"] },
      resources: [{ uid: "*", labels: ["environment:eks"] }],
      compliance: { control: "AWS EC2.7", status_id: 1, status: "Pass" } },
    { ...compliance, ...severity.High, ...status.New, cloud: { provider: "platform" },
      finding_info: { uid: "ctl-eks-audit", title: "CloudTrail 관리 이벤트 기록", analytic: { type_id: 1, type: "Rule", name: "aws.cloudtrail.multi_region" }, data_sources: ["AWS 설정 점검 · 시연"] },
      resources: [{ uid: "*", labels: ["environment:eks"] }],
      remediation: { desc: "다중 리전 trail과 읽기·쓰기 관리 이벤트 구성을 확인합니다." },
      compliance: { control: "AWS CloudTrail.1", status_id: 3, status: "Fail" } },
    { ...compliance, ...severity.Medium, ...status.New, cloud: { provider: "platform" },
      finding_info: { uid: "ctl-eks-key-review", title: "플랫폼 저장소 키 권한 확인", analytic: { type_id: 1, type: "Rule", name: "hopcharlie.key.policy_read" }, data_sources: ["AWS 설정 점검 · 시연"] },
      resources: [{ uid: "*", labels: ["environment:eks"] }],
      compliance: { control: "HopCharlie KEY-01", status_id: 0, status: "Unknown" } },
  ],
};
