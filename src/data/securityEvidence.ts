/** Evidence links describe the reviewed implementation, not the deployed binary's version. */
const CODE = "https://github.com/2026-Softbank-Hackathon-Charlie/platform/blob/31540bbe1afeaf63a7901b101f6152bdab12b9a8/internal/security/";
const SOURCE_FILES: Record<string, string> = {
  kubernetes: "kubernetes.go", "aws-iam": "aws.go", "aws-ec2": "aws.go", "aws-cloudtrail": "aws.go",
  "aws-guardduty": "aws.go", "aws-securityhub": "aws.go", "aws-s3": "aws.go", "gcp-scc": "scc.go",
  "platform-audit": "platform.go", "platform-config": "platform.go", "storage-keys": "storagekeys.go",
  "image-scan": "posture.go", grype: "grype.go",
};
export const securityCodeUrl = (source: string) => SOURCE_FILES[source] ? CODE + SOURCE_FILES[source] + "#L1" : undefined;

const AUTH_PARAMS = new Set(["token", "accesstoken", "refreshtoken", "idtoken", "apikey", "authorization", "auth", "password", "passwd", "secret", "clientsecret", "signature", "credential", "awsaccesskeyid", "googleaccessid", "xamzsignature", "xamzcredential", "xamzsecuritytoken", "xgoogsignature", "xgoogcredential"]);
/** Reject non-web URLs, userinfo and known authentication query/fragment parameters. */
export function evidenceUrl(value: string | null | undefined): string {
  try {
    const url = new URL(value ?? "");
    for (const key of [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()]) {
      if (AUTH_PARAMS.has(key.toLowerCase().replace(/[-_]/g, ""))) return "";
    }
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export type ObservationState = "loading" | "observed" | "unobserved" | "error" | "unsupported";
export const OBSERVATION_LABEL: Record<ObservationState, string> = { loading: "수집 중", observed: "관측됨", unobserved: "미관측", error: "수집 오류", unsupported: "미지원" };
export interface SecurityObservation {
  state: ObservationState;
  endpoint: string;
  reason: string;
  collectedAt: string | null;
  /** A response retained after refresh failed is evidence from the last successful read. */
  retained?: boolean;
}
export interface SecurityRequestState { loading?: boolean; error?: { status: number; code: string; message: string } }

export function reportObservation(endpoint: string, collectedAt: string | undefined, request: SecurityRequestState = {}, legacyError?: string): SecurityObservation {
  const e = request.error;
  if (e || legacyError) return {
    endpoint, collectedAt: collectedAt ?? null, retained: !!collectedAt,
    state: e && [404, 405, 501].includes(e.status) ? "unsupported" : "error",
    reason: `${e ? `HTTP ${e.status || "응답 없음"} · ${e.code} · ${e.message}` : legacyError}${collectedAt ? " · 마지막 성공 결과를 표시합니다." : ""}`,
  };
  if (!collectedAt) return { endpoint, collectedAt: null, state: request.loading ? "loading" : "unobserved", reason: request.loading ? "이 API의 응답을 기다립니다. 수집 완료 여부는 아직 판단하지 않습니다." : "이 API의 결과를 아직 관측하지 못했습니다." };
  return { endpoint, collectedAt, state: "observed", reason: "API가 반환한 결과입니다. 수집 성공과 개별 검사 통과는 별개입니다." };
}
