import { render, screen, within } from "@testing-library/react";
import { fakeSession, installFetch, json } from "../api/fakes";
import type { SecuritySource, StorageKey } from "../api/types";
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

const keySource = (environment: string, s: Partial<SecuritySource> = {}): SecuritySource => ({
  name: "storage-keys",
  provider: environment === "gke" ? "gcp" : "aws",
  environment,
  status: "ok",
  checkedAt: "2026-11-05T13:00:00Z",
  findings: 0,
  ...s,
});

function renderSecurity(storageKeys: StorageKey[] | undefined, sources: SecuritySource[] = [keySource("eks"), keySource("gke")]) {
  installFetch((c) => {
    const u = new URL(c.url, "http://x");
    if (u.pathname === "/v1/security") {
      return json(200, { generatedAt: "2026-11-05T13:00:00Z", summary: { bySeverity: zero, byEnvironment: {} }, sources, findings: [], storageKeys });
    }
    return json(404, { error: { code: "not_found", message: "no" } });
  });
  localStorage.setItem("hopcharlie.mode", "live");
  localStorage.setItem("hopcharlie.session", JSON.stringify(fakeSession()));
  window.location.hash = "#security/findings";
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

  it("marks deactivated keys and keys the platform has no record of", async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    renderSecurity([
      key({ createdAt: old, state: "inactive", message: "the key the pods are given is deactivated" }),
      key({ keyId: "...MADE", use: "unrecorded", createdAt: old, message: "the platform has no record of this key" }),
    ]);
    const table = (await screen.findByRole("heading", { name: "앱 저장소 키" })).closest("section") as HTMLElement;
    const rows = within(table).getAllByRole("row").slice(1);
    within(rows[0]).getByText("비활성");
    // the age flag is for keys that can still be used
    expect(within(rows[0]).queryByText("90일 넘음")).not.toBeInTheDocument();
    within(rows[1]).getByText("기록에 없음");
    within(rows[1]).getByText("90일 넘음");
  });

  it("names the environments it could not read instead of saying there are no keys", async () => {
    renderSecurity([], [keySource("eks"), keySource("gke", { status: "error", message: "could not read the platform's records of bucket keys" })]);
    const table = (await screen.findByRole("heading", { name: "앱 저장소 키" })).closest("section") as HTMLElement;
    await within(table).findByText("could not read the platform's records of bucket keys", { exact: false });
    within(table).getByText("GCP GKE");
    expect(within(table).queryByText("버킷이 있는 앱 인스턴스가 없습니다.")).not.toBeInTheDocument();
  });

  it("says so when no environment has a storage driver", async () => {
    renderSecurity([], []);
    await screen.findByText("저장소 드라이버가 있는 환경이 없습니다.");
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
