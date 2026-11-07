/** On-prem enrollment responses. Codes and commands are returned only on creation. */
export type OnpremEnrollmentStatus = "pending" | "claimed" | "verifying" | "ready" | "failed" | "expired" | "revoked";
export type OnpremCheckId = "k3s" | "network" | "permissions" | "image_pull" | "hello_world";
export interface OnpremEnrollmentCheck {
  id: OnpremCheckId;
  status: "pending" | "running" | "passed" | "failed" | "unknown";
  message?: string;
  checkedAt?: string;
}
export interface OnpremEnrollment {
  id: string;
  environment: string;
  status: OnpremEnrollmentStatus;
  /** Optional on older servers; describes the actual registration worker stage. */
  stage?: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  checks: OnpremEnrollmentCheck[];
}
export interface OnpremEnrollmentCreateRequest {
  environment: string;
  installK3s: boolean;
}
export interface OnpremEnrollmentCreated {
  enrollment: OnpremEnrollment;
  /** Present only on the original issuance, never synthesized for a replay. */
  code?: string;
  installCommand?: string;
}
