import { render, screen, within } from "@testing-library/react";
import { fakeSession, installFetch, json } from "../api/fakes";
import type { StorageKey } from "../api/types";
import { App } from "../App";
import { initAuth } from "../data/live";
import { createSim, SimProvider } from "../sim/store";

afterEach(() => {
  localStorage.clear();
  initAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const zero = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };

function renderSecurity(storageKeys: StorageKey[] | undefined) {
  installFetch((c) => {
    const u = new URL(c.url, "http://x");
    if (u.pathname === "/v1/security") {
      return json(200, { generatedAt: "2026-11-05T13:00:00Z", summary: { bySeverity: zero, byEnvironment: {} }, sources: [], findings: [], storageKeys });
    }
    return json(404, { error: { code: "not_found", message: "no" } });
  });
  localStorage.setItem("hopcharlie.mode", "live");
  localStorage.setItem("hopcharlie.session", JSON.stringify(fakeSession()));
  window.location.hash = "#security";
  initAuth();
  render(
    <SimProvider sim={createSim()} intervalMs={0}>
      <App />
    </SimProvider>,
  );
}

const key = (k: Partial<StorageKey>): StorageKey => ({
  app: "moimroom",
  instance: "moimroom",
  environment: "eks",
  driver: "aws",
  bucket: "hopcharlie-eks-moimroom",
  keyId: "...Q2XA",
  use: "current",
  state: "ok",
  ...k,
});

describe("security page: app storage keys", () => {
  it("shows when each key was made, what it may do, and the keys it could not check", async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    renderSecurity([
      key({ createdAt: old, scope: { actions: ["s3:GetObject", "s3:PutObject"], boundary: "arn:aws:iam::123456789012:policy/hopcharlie-app-boundary" } }),
      key({ keyId: "...OLD1", use: "old", state: "missing", message: "the provider has no such key any more" }),
      key({ instance: "moimroom--dev", environment: "gke", driver: "gcs", bucket: "hopcharlie-gke-moimroom--dev", keyId: "...GK01", state: "unread", message: "environment gke has no usable storage driver" }),
    ]);

    const table = (await screen.findByRole("heading", { name: "앱 저장소 키" })).closest("section") as HTMLElement;
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    within(rows[0]).getByText("만든 지 100일", { exact: false });
    within(rows[0]).getByText("90일 넘음");
    within(rows[0]).getByText("s3:GetObject, s3:PutObject");
    within(rows[0]).getByText("상한(permissions boundary): hopcharlie-app-boundary");
    within(rows[0]).getByText("확인");

    within(rows[1]).getByText("교체 전 키(파드가 아직 쓸 수 있음)");
    within(rows[1]).getByText("클라우드에 없음");

    within(rows[2]).getByText("앱 moimroom");
    within(rows[2]).getByText("GCS HMAC 키");
    within(rows[2]).getByText("확인 못 함");
    within(rows[2]).getByText("권한을 확인하지 못했습니다.");
    within(rows[2]).getByText("environment gke has no usable storage driver");
  });

  it("says so when the platform does not report storage keys yet", async () => {
    renderSecurity(undefined);
    await screen.findByText("연결한 플랫폼이 아직 저장소 키를 보고하지 않습니다.");
  });

  it("says so when no instance has a bucket", async () => {
    renderSecurity([]);
    await screen.findByText("버킷이 있는 앱 인스턴스가 없습니다.");
  });
});
