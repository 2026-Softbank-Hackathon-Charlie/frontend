import { evidenceUrl, reportObservation, securityCodeUrl } from "./securityEvidence";

it("separates waiting, missing observations, source errors and unsupported endpoints", () => {
  expect(reportObservation("controls", undefined, { loading: true }).state).toBe("loading");
  expect(reportObservation("controls", undefined).state).toBe("unobserved");
  expect(reportObservation("controls", undefined, { error: { status: 404, code: "not_found", message: "no route" } }).state).toBe("unsupported");
  expect(reportObservation("controls", undefined, { error: { status: 403, code: "forbidden", message: "denied" } }).state).toBe("error");
  expect(reportObservation("controls", "2026-11-08T00:00:00Z", { error: { status: 0, code: "timeout", message: "timeout" } })).toMatchObject({ state: "error", retained: true, collectedAt: "2026-11-08T00:00:00Z" });
});

it("uses reviewed source mappings and accepts only safe actual evidence URLs", () => {
  expect(securityCodeUrl("kubernetes")).toMatch(/31540bbe.*kubernetes\.go#L1$/);
  expect(securityCodeUrl("unknown-collector")).toBeUndefined();
  expect(securityCodeUrl("constructor")).toBeUndefined();
  for (const value of ["", "#security", "javascript:alert(1)", "data:text/html,x", "https://user:secret@example.test/"]) expect(evidenceUrl(value)).toBe("");
  expect(evidenceUrl("https://nvd.nist.gov/vuln/detail/CVE-2024-6387")).toBe("https://nvd.nist.gov/vuln/detail/CVE-2024-6387");
  for (const key of ["access_token", "api_key", "password", "X-Amz-Signature", "X-Goog-Credential"]) expect(evidenceUrl("https://example.test/report?" + key + "=private")).toBe("");
  expect(evidenceUrl("https://example.test/report#access_token=private")).toBe("");
  expect(evidenceUrl("https://example.test/search?id=CVE-2024-6387&q=openssl")).toBe("https://example.test/search?id=CVE-2024-6387&q=openssl");
});
