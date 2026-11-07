import type { Run } from "../api/types";

/** One table the engine checked by primary key (migration-engine pkg/verify MissingResult). */
export type TableCheck = { table: string; checked?: number; missing?: number; skipped?: string; error?: string };
/** The rclone check of the buckets: files on both sides with the same hash, files that differ, files only on the source. */
export type FileCheck = { matching?: number; differences?: number; missingOnTarget?: number; ok?: boolean };
export type VerifyReport = { ok?: boolean; missingRows?: number; tables: TableCheck[]; files?: FileCheck };

const obj = (x: unknown): Record<string, unknown> | undefined => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined);
const count = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const text = (x: unknown) => (typeof x === "string" && x ? x : undefined);
const bool = (x: unknown) => (typeof x === "boolean" ? x : undefined);

/** The verify step's report (engine.steps.verify.evidence.report). The evidence is untyped in the API, so every field is read with care. */
export function verifyReportOf(r: Pick<Run, "engine">): VerifyReport | undefined {
  const rep = obj(obj(r.engine.steps.verify?.evidence)?.report);
  if (!rep) return undefined;
  const tables = (Array.isArray(rep.tables) ? rep.tables : []).flatMap((t): TableCheck[] => {
    const o = obj(t);
    const table = text(o?.table);
    return o && table ? [{ table, checked: count(o.checked), missing: count(o.missing), skipped: text(o.skipped), error: text(o.error) }] : [];
  });
  const f = obj(rep.files);
  const files = f && { matching: count(f.matching), differences: count(f.differences), missingOnTarget: count(f.missingOnTarget), ok: bool(f.ok) };
  return { ok: bool(rep.ok), missingRows: count(rep.missingRows), tables, files };
}

/** Rows the target lacks over the tables that were checked; undefined when no table reports a count. */
export function missingOf(tables: TableCheck[]): number | undefined {
  const known = tables.filter((t) => !t.skipped && !t.error && t.missing !== undefined);
  return known.length ? known.reduce((n, t) => n + t.missing!, 0) : undefined;
}

/** Whether the file check found nothing wrong: undefined when the counts are not there. */
export function filesClean(f: FileCheck): boolean | undefined {
  if (f.differences === undefined || f.missingOnTarget === undefined) return f.ok;
  return f.differences === 0 && f.missingOnTarget === 0 && f.ok !== false;
}
