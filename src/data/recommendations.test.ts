import { recommendationReport, recommendationHref, sourceUrl } from "./recommendations";

const now = Date.parse("2026-11-08T03:00:00Z");
export function reportFixture() {
  return { generatedAt: new Date(now).toISOString(), nextRefreshAt: new Date(now + 900000).toISOString(), nextCheckAt: null, ttlSeconds: 900,
    cacheStatus: "fresh", status: "ready", ai: { status: "ready", model: "same-sandbox-model", sessionId: "ags_one" },
    recommendations: [{ id: "rec-1", app: "moimroom-mig", source: "eks", target: "onprem", action: "insufficient", title: "온프레미스 이전 조건 확인",
      reasons: ["외부 반출 조건을 확인하세요", "온프레미스 운영비가 미입력입니다"], missing: ["전력·장비 상각 비용"],
      sources: [{ title: "AWS 공시 요금", url: "https://aws.amazon.com/ec2/pricing/on-demand/", observedAt: null }], estimatedMonthlySavingsUsd: null }] };
}

it("preserves unknown savings and binds the direct link to app, source and target", () => {
  const report = recommendationReport(reportFixture(), now)!;
  expect(report.recommendations[0].estimatedMonthlySavingsUsd).toBeNull();
  expect(recommendationHref(report.recommendations[0])).toBe("#migrate-app?app=moimroom-mig&source=eks&target=onprem");
  expect(recommendationHref({ ...report.recommendations[0], source: null })).toBeUndefined();
  expect(recommendationHref({ ...report.recommendations[0], action: "stay" })).toBeUndefined();
});

it.each(["missing status", "future", "wrong endpoint", "unsafe app", "negative saving", "three reasons", "generating with decisions"])("rejects %s evidence", mode => {
  const report = reportFixture();
  if (mode === "missing status") delete (report as Partial<typeof report>).status;
  if (mode === "future") report.generatedAt = new Date(now + 60000).toISOString();
  if (mode === "wrong endpoint") report.recommendations[0].target = "https://private";
  if (mode === "unsafe app") report.recommendations[0].app = "../other";
  if (mode === "negative saving") Object.assign(report.recommendations[0], { estimatedMonthlySavingsUsd: -1 });
  if (mode === "three reasons") report.recommendations[0].reasons.push("extra");
  if (mode === "generating with decisions") report.status = "generating";
  expect(recommendationReport(report, now)).toBeUndefined();
});

it("allows only safe HTTPS evidence links without credentials", () => {
  expect(sourceUrl("https://cloud.google.com/products/compute/pricing")).toContain("cloud.google.com");
  for (const value of ["javascript:alert(1)", "http://outside.test", "https://user:password@outside.test", "https://outside.test/?token=private"]) expect(sourceUrl(value)).toBeUndefined();
});
