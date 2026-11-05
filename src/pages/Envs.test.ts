import type { DatabaseCluster } from "../api/types";
import { backupStatus } from "./Envs";

const db = (backup?: DatabaseCluster["backup"]): DatabaseCluster => ({ namespace: "moimroom", name: "moimroom-db", instances: 1, readyInstances: 1, replica: false, backup });
const now = Date.parse("2026-11-07T00:00:00Z");
const store = { objectStore: "moimroom-db", walArchiving: true };

describe("backupStatus", () => {
  it("shows a database without backups as such", () => {
    expect(backupStatus(db(), now)).toEqual({ chip: "neu", label: "백업 없음", detail: "" });
  });

  it("is fine with a recent backup, and shows how far back a restore reaches", () => {
    const st = backupStatus(db({ ...store, lastSuccessfulBackup: "2026-11-06T18:00:08Z", firstRecoverabilityPoint: "2026-11-05T18:00:10Z" }), now);
    expect(st.chip).toBe("ok");
    expect(st.label).toBe("백업 정상");
    expect(st.detail).toMatch(/^마지막 백업 .+, .+부터 복구 가능$/);
  });

  it("warns when WAL archiving fails, before anything else", () => {
    const st = backupStatus(db({ ...store, walArchiving: false, lastFailedBackup: "2026-11-06T18:00:00Z" }), now);
    expect(st).toEqual({ chip: "bad", label: "WAL 보관 실패", detail: "마지막 백업 없음" });
  });

  it("warns when the last backup failed after the last success", () => {
    const st = backupStatus(db({ ...store, lastSuccessfulBackup: "2026-11-05T18:00:08Z", lastFailedBackup: "2026-11-06T18:00:00Z" }), now);
    expect(st).toMatchObject({ chip: "warn", label: "마지막 백업 실패" });
  });

  it("warns while archiving works but no base backup has succeeded yet", () => {
    expect(backupStatus(db(store), now)).toMatchObject({ chip: "warn", label: "백업 기록 없음", detail: "마지막 백업 없음" });
  });

  it("warns when the last backup is older than 26 hours", () => {
    expect(backupStatus(db({ ...store, lastSuccessfulBackup: "2026-11-05T21:59:00Z" }), now)).toMatchObject({ chip: "warn", label: "백업 오래됨" });
    expect(backupStatus(db({ ...store, lastSuccessfulBackup: "2026-11-05T22:01:00Z" }), now)).toMatchObject({ chip: "ok" });
  });

  it("compares times, not strings", () => {
    // The same instant written with an offset: not later than the success.
    const st = backupStatus(db({ ...store, lastSuccessfulBackup: "2026-11-06T18:00:00Z", lastFailedBackup: "2026-11-07T02:00:00+09:00" }), now);
    expect(st.chip).toBe("ok");
  });
});
