import type { AuditEntry } from "../api/types";
import { bin, latestPreflight, preflightOf } from "./preflight";

const at = "2026-11-03T10:00:00Z";
const entry = (detail: Record<string, unknown>, extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1,
  time: at,
  actor: "op",
  role: "operator",
  action: "POST /v1/migrations",
  target: "/v1/migrations",
  status: 202,
  detail: { planRef: "pln_1", ...detail },
  ...extra,
});

const measurements = {
  sourceBytes: 42 * 1024 ** 3,
  walBytesPerSecond: 3.1 * 1024 ** 2,
  sourceSessions: 340,
  targetMaxConnections: 200,
  targetMaxConnectionsFrom: "target",
  lagBefore: 1000 * 1024 ** 2,
  lagAfter: 1000 * 1024 ** 2,
  window: 5e9,
};

describe("pre-start checks from the audit log", () => {
  it("reads a passing start", () => {
    const p = preflightOf(
      entry({
        residency: "allowed",
        residencyDigest: "ab12cd34ef56aa",
        capacity: { allowed: true, checks: ["connections pass ok: x", "catchup pass caught_up: x", "initial_copy info measured: x"], measurements: { ...measurements, targetMaxConnections: 500, lagAfter: 1024 } },
      }),
    )!;
    expect(p.blocked).toBe(false);
    expect(p.residency.status).toBe("pass");
    expect(p.residency.digest).toBe("ab12cd34ef56aa");
    expect(p.capacity.status).toBe("pass");
    expect(p.capacity.items.map((i) => [i.label, i.status])).toEqual([
      ["접속 수", "pass"],
      ["복제 따라잡기", "pass"],
      ["초기 복사", "info"],
    ]);
    expect(p.capacity.items[0].detail).toBe("대상 최대 접속 500 (실행 중인 대상), 필요 408 (원본 접속 340 × 1.2)");
    expect(p.capacity.items[2].detail).toBe("원본 42.0 GiB, 변경 3.1 MiB/s");
  });

  it("reads a residency refusal and translates its reasons", () => {
    const p = preflightOf(
      entry(
        {
          error: "residency_denied",
          residencyDigest: "d1",
          residencyReasons: ["country_not_allowed app.public.customers", "bucket_country_not_allowed s3:photos", "inventory_incomplete", "inventory:connect_failed"],
        },
        { status: 409 },
      ),
    )!;
    expect(p.blocked).toBe(true);
    expect(p.residency.status).toBe("fail");
    expect(p.residency.items).toEqual([
      { label: "목적지 국가로 보낼 수 없는 데이터", status: "fail", detail: "app.public.customers", raw: "country_not_allowed app.public.customers" },
      { label: "목적지 국가로 보낼 수 없는 버킷", status: "fail", detail: "s3:photos", raw: "bucket_country_not_allowed s3:photos" },
      { label: "원본 테이블 목록을 끝까지 읽지 못함", status: "fail", detail: "원본 DB에 접속하지 못함", raw: "inventory_incomplete" },
    ]);
    // capacity is not measured once residency refused
    expect(p.capacity).toMatchObject({ status: "skip", items: [] });
  });

  it("reads a capacity refusal with its measurements", () => {
    const p = preflightOf(
      entry(
        {
          error: "capacity_insufficient",
          residency: "allowed",
          capacity: {
            allowed: false,
            checks: ["connections fail target_connections_insufficient: target max_connections 200 ...", "catchup fail not_catching_up: lag ...", "initial_copy info measured: source 42.0 GiB"],
            measurements,
          },
        },
        { status: 409 },
      ),
    )!;
    expect(p.blocked).toBe(true);
    expect(p.residency.status).toBe("pass");
    expect(p.capacity.status).toBe("fail");
    expect(p.capacity.items[0]).toMatchObject({ status: "fail", detail: "대상 최대 접속 200 (실행 중인 대상), 필요 408 (원본 접속 340 × 1.2)" });
    expect(p.capacity.items[1]).toMatchObject({ status: "fail", detail: "지연 1000.0 MiB → 1000.0 MiB (5초), 지연이 줄지 않습니다" });
  });

  it("shows unknown codes and messages as the platform wrote them", () => {
    const p = preflightOf(entry({ capacity: { allowed: true, checks: ["future_check pass new_code: something new"], measurements: {} } }))!;
    expect(p.capacity.items[0]).toEqual({ label: "future_check", status: "pass", detail: "something new", raw: "something new" });
  });

  it("reads skipped checks", () => {
    expect(preflightOf(entry({ residency: "rollback_exempt", capacity: { outcome: "rollback_exempt" } }))).toMatchObject({
      blocked: false,
      residency: { status: "skip" },
      capacity: { status: "skip" },
    });
    expect(preflightOf(entry({ residency: "not_configured", capacity: { outcome: "error" } }))).toMatchObject({
      residency: { status: "skip" },
      capacity: { status: "unknown" },
    });
    expect(preflightOf(entry({ runId: "run_1" }))).toBeUndefined();
  });

  it("picks the newest start or rollback of the plan", () => {
    const entries = [
      entry({ planRef: "pln_2", residency: "allowed" }, { id: 4 }),
      entry({ comment: "x" }, { id: 3, action: "POST /v1/plans/{ref}/approve" }),
      entry({ residency: "rollback_exempt" }, { id: 2, action: "POST /v1/migrations/{runId}/rollback" }),
      entry({ error: "residency_denied", residencyReasons: [] }, { id: 1 }),
    ];
    expect(latestPreflight(entries, "pln_1")?.residency.status).toBe("skip");
    expect(latestPreflight(entries.slice(3), "pln_1")?.blocked).toBe(true);
    expect(latestPreflight(entries, "pln_9")).toBeUndefined();
  });

  it("formats binary sizes", () => {
    expect(bin(512)).toBe("512 B");
    expect(bin(16 * 1024 ** 2)).toBe("16.0 MiB");
    expect(bin(2.1 * 1024 ** 3)).toBe("2.1 GiB");
  });
});
