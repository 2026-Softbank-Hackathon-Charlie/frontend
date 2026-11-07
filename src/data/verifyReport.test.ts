import { fakeRun } from "../api/fakes";
import type { Run } from "../api/types";
import { filesClean, missingOf, verifyReportOf } from "./verifyReport";

const withReport = (report: unknown): Run => {
  const r = fakeRun();
  r.engine.steps.verify = { status: "succeeded", evidence: { report } };
  return r;
};

describe("the verify step's report", () => {
  it("reads the report a real run returns, with no tables yet", () => {
    const rep = verifyReportOf(
      withReport({ durability: "asynchronous", files: { differences: 0, matching: 634, missingOnTarget: 0, ok: true, output: "..." }, missingRows: 0, ok: true, tables: [] }),
    );
    expect(rep).toEqual({ ok: true, missingRows: 0, tables: [], files: { matching: 634, differences: 0, missingOnTarget: 0, ok: true } });
  });

  it("keeps each table's counts, skip and error, and drops entries without a name", () => {
    const rep = verifyReportOf(
      withReport({
        tables: [
          { table: "app.reservations", checked: 1234, missing: 0, samples: [] },
          { table: "app.audit", checked: 0, missing: 0, skipped: "no primary key" },
          { table: "app.reviews", checked: 0, missing: 0, error: "permission denied" },
          { checked: 5 },
          "app.x",
        ],
      }),
    )!;
    expect(rep.tables).toEqual([
      { table: "app.reservations", checked: 1234, missing: 0, skipped: undefined, error: undefined },
      { table: "app.audit", checked: 0, missing: 0, skipped: "no primary key", error: undefined },
      { table: "app.reviews", checked: 0, missing: 0, skipped: undefined, error: "permission denied" },
    ]);
    expect(rep.files).toBeUndefined();
    // the skipped and failed tables do not count as zero missing
    expect(missingOf(rep.tables)).toBe(0);
    expect(missingOf(rep.tables.slice(1))).toBeUndefined();
  });

  it("has no report before the verify step or when the evidence is not an object", () => {
    expect(verifyReportOf(fakeRun())).toBeUndefined();
    expect(verifyReportOf(withReport("ok"))).toBeUndefined();
    expect(verifyReportOf(withReport(null))).toBeUndefined();
  });

  it("calls the files clean only when nothing differs and nothing is missing", () => {
    expect(filesClean({ matching: 3, differences: 0, missingOnTarget: 0, ok: true })).toBe(true);
    expect(filesClean({ matching: 3, differences: 1, missingOnTarget: 0, ok: false })).toBe(false);
    expect(filesClean({ matching: 3, differences: 0, missingOnTarget: 2 })).toBe(false);
    expect(filesClean({})).toBeUndefined();
  });
});
