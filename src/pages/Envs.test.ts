import type { DatabaseCluster } from "../api/types";
import { backupStatus } from "./Envs";

const db = (backup?: DatabaseCluster["backup"]): DatabaseCluster => ({ namespace: "moimroom", name: "moimroom-db", instances: 1, readyInstances: 1, replica: false, backup });

describe("backupStatus", () => {
  it("says nothing about a database without backups", () => {
    expect(backupStatus(db())).toBeNull();
  });

  it("shows the last backup and the first point a restore reaches", () => {
    const st = backupStatus(db({ objectStore: "moimroom-db", walArchiving: true, lastSuccessfulBackup: "2026-11-06T18:00:08Z", firstRecoverabilityPoint: "2026-11-05T18:00:10Z" }));
    expect(st?.chip).toBe("ok");
    expect(st?.label).toBe("백업 중");
    expect(st?.detail).toMatch(/^마지막 백업 .+, .+부터 복구 가능$/);
  });

  it("warns when WAL archiving fails, before anything else", () => {
    const st = backupStatus(db({ objectStore: "moimroom-db", walArchiving: false, lastFailedBackup: "2026-11-06T18:00:00Z" }));
    expect(st).toMatchObject({ chip: "bad", label: "WAL 보관 실패", detail: "마지막 백업 없음" });
  });

  it("warns when the last backup failed after the last success", () => {
    const st = backupStatus(db({ objectStore: "moimroom-db", walArchiving: true, lastSuccessfulBackup: "2026-11-05T18:00:08Z", lastFailedBackup: "2026-11-06T18:00:00Z" }));
    expect(st).toMatchObject({ chip: "warn", label: "마지막 백업 실패" });
  });
});
