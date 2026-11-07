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

  it("explains the hot standby settings check", () => {
    const standby = (code: string, status: string, m: Record<string, unknown>) =>
      preflightOf(entry({ capacity: { allowed: status !== "fail", checks: [`standby_settings ${status} ${code}: platform text`], measurements: m } }))!.capacity.items[0];
    const both = { sourceMaxConnections: 200, targetMaxConnections: 100, targetMaxConnectionsFrom: "manifest", sourceMaxWorkerProcesses: 8, targetMaxWorkerProcesses: 8, targetMaxWorkerProcessesFrom: "target" };

    // only the settings below the source are named
    expect(standby("target_below_source", "fail", both)).toEqual({
      label: "대기 서버 설정",
      status: "fail",
      detail: "max_connections 대상 100 (manifest 설정), 원본 200. 대상은 원본의 대기 서버로 뜨므로 원본 값 이상이어야 합니다",
      raw: "platform text",
    });
    expect(standby("target_below_source", "fail", { ...both, targetMaxConnections: 200, targetMaxWorkerProcesses: 4 }).detail).toBe(
      "max_worker_processes 대상 4 (실행 중인 대상), 원본 8. 대상은 원본의 대기 서버로 뜨므로 원본 값 이상이어야 합니다",
    );
    expect(standby("target_below_source", "fail", { ...both, targetMaxWorkerProcesses: 4 }).detail).toBe(
      "max_connections 대상 100 (manifest 설정), 원본 200, max_worker_processes 대상 4 (실행 중인 대상), 원본 8. 대상은 원본의 대기 서버로 뜨므로 원본 값 이상이어야 합니다",
    );

    // a pass names what it compared and what it did not, so it never reads as covering every hot standby setting
    const unchecked = "이 검사는 max_wal_senders, max_prepared_transactions, max_locks_per_transaction 설정을 비교하지 않습니다";
    expect(standby("ok", "pass", { ...both, targetMaxConnections: 200 }).detail).toBe(
      "max_connections 대상 200 (manifest 설정), 원본 200, max_worker_processes 대상 8 (실행 중인 대상), 원본 8: 원본 이상입니다. " + unchecked,
    );
    // a setting unknown on either side is not compared, as the platform does, and the sentence says so:
    // the target's max_worker_processes is missing from the manifest, so it would start at PostgreSQL's default
    expect(standby("ok", "pass", { sourceMaxConnections: 100, targetMaxConnections: 300, targetMaxConnectionsFrom: "target", sourceMaxWorkerProcesses: 16 }).detail).toBe(
      "max_connections 대상 300 (실행 중인 대상), 원본 100: 원본 이상입니다. max_worker_processes 설정은 대상 값을 몰라 비교하지 못했습니다 (대상에 연결되지 않고 manifest에도 없음). " + unchecked,
    );
    expect(standby("ok", "pass", { sourceMaxConnections: 100, targetMaxConnections: 300, targetMaxWorkerProcesses: 8 }).detail).toContain("max_worker_processes 설정은 원본 값을 몰라 비교하지 못했습니다. ");
    expect(standby("ok", "pass", { sourceMaxConnections: 100, targetMaxConnections: 300 }).detail).toContain(
      "max_worker_processes 설정은 원본과 대상 값을 몰라 비교하지 못했습니다 (대상에 연결되지 않고 manifest에도 없음). ",
    );
    expect(standby("not_measured", "unknown", {})).toMatchObject({ status: "unknown", detail: "원본이나 대상의 max_connections, max_worker_processes를 읽지 못해 비교하지 않았습니다" });
    // measurements that do not back the platform's verdict fall back to its own text
    expect(standby("target_below_source", "fail", {}).detail).toBe("platform text");
    expect(standby("ok", "pass", {}).detail).toBe("platform text");
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

  it("reads the parity record without letting it block the start", () => {
    const recorded = (passed: boolean, results: string[]) =>
      preflightOf(entry({ residency: "allowed", parity: { outcome: "recorded", mode: "audit", passed, results, configDigest: "cfg123" } }))!;
    const fail = recorded(false, ["identity fail rbac_mismatch: read-own-config=fail(denied), no-secret-list=pass(denied)", "metrics-alerting unknown alert_delivery_unverified"]);
    expect(fail.blocked).toBe(false);
    expect(fail.parity).toMatchObject({ status: "fail", digest: "cfg123" });
    expect(fail.parity!.items).toEqual([
      { label: "인증, 권한", status: "fail", detail: "rbac_mismatch (read-own-config=fail(denied), no-secret-list=pass(denied))", raw: "identity fail rbac_mismatch: read-own-config=fail(denied), no-secret-list=pass(denied)" },
      { label: "모니터링, 알림", status: "unknown", detail: "alert_delivery_unverified", raw: "metrics-alerting unknown alert_delivery_unverified" },
    ]);
    expect(recorded(false, ["secret unknown probe_not_configured", "audit not_applicable none"]).parity).toMatchObject({ status: "unknown", items: [{ status: "unknown" }, { status: "skip" }] });
    expect(recorded(true, ["identity pass ok"]).parity).toMatchObject({ status: "pass", items: [{ label: "인증, 권한", status: "pass", detail: "ok" }] });
    expect(preflightOf(entry({ residency: "not_configured", parity: { outcome: "not_configured", mode: "audit", binding: null } }))!.parity).toMatchObject({ status: "skip", items: [] });
    expect(preflightOf(entry({ residency: "rollback_exempt", parity: { outcome: "rollback_exempt" } }))!.parity?.status).toBe("skip");
    expect(preflightOf(entry({ residency: "allowed", parity: { outcome: "error" } }))!.parity?.status).toBe("unknown");
    expect(preflightOf(entry({ error: "residency_denied", residencyReasons: [] }))!.parity?.summary).toBe("이전을 시작하지 않아 검사하지 않았습니다");
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
