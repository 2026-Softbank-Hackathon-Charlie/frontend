import { fakeDeployment } from "../api/fakes";
import type { AppObservation } from "../api/types";
import { agoText, summarize, timeline, windowLabel } from "./observe";

const BASE = Date.parse("2026-11-07T09:00:00Z");
/** the ISO time `min` minutes after 09:00 */
const at = (min: number) => new Date(BASE + min * 60_000).toISOString();
const NOW = BASE + 60 * 60_000;
const obs = (p: Partial<AppObservation> = {}): AppObservation => ({
  since: at(0),
  total: 1200,
  errors: 0,
  warnings: 4,
  buckets: [],
  services: [{ name: "pxls-web", total: 900, errors: 0, warnings: 3, lastSeen: at(58) }, { name: "pxls-db", total: 300, errors: 0, warnings: 1, lastSeen: at(50) }],
  patterns: [],
  ...p,
});

describe("how the app is doing, in words", () => {
  it("says no errors is fine and names the busiest service and the last log", () => {
    const s = summarize(obs(), 60, NOW);
    expect(s.level).toBe("ok");
    expect(s.headline).toBe("최근 1시간 동안 오류 없이 돌고 있습니다");
    expect(s.lines).toContain("로그 1,200건 중 오류 0건, 경고 4건입니다.");
    expect(s.lines).toContain("가장 많이 기록한 곳은 pxls-web(900건)입니다.");
    expect(s.lines.some((l) => l.includes("마지막 로그는 2분 전"))).toBe(true);
  });

  it("asks to check a few errors and calls one in twenty lines a problem", () => {
    const few = summarize(obs({ errors: 3, services: [{ name: "pxls-web", total: 1200, errors: 3, warnings: 0, lastSeen: at(59) }] }), 60, NOW);
    expect(few.level).toBe("warn");
    expect(few.headline).toBe("최근 1시간 동안 오류가 3건 있었습니다");
    expect(few.lines).toContain("오류는 pxls-web에서 가장 많이 나왔습니다(3건).");
    expect(summarize(obs({ errors: 60 }), 60, NOW)).toMatchObject({ level: "bad", headline: "최근 1시간 동안 오류가 많습니다 (60건)" });
  });

  it("does not call an app with no log lines healthy", () => {
    const s = summarize(obs({ total: 0, errors: 0, warnings: 0, services: [] }), 360, NOW);
    expect(s.level).toBe("none");
    expect(s.headline).toBe("최근 6시간 동안 이 앱의 로그가 없습니다");
    expect(s.lines[0]).toContain("어느 쪽인지 알 수 없습니다");
  });
});

describe("what happened, newest first", () => {
  const bucket = (min: number, total: number, errors = 0) => ({ time: at(min), total, errors, warnings: 0 });

  it("mixes the deployments in the window with the first error and the busiest five minutes", () => {
    const o = obs({ buckets: [bucket(10, 100), bucket(20, 400, 5), bucket(30, 300, 2)] });
    const deps = [fakeDeployment({ id: "d1", commit: "abcdef1234567", createdAt: at(40) }), fakeDeployment({ id: "d0", commit: "0000000aaaa", createdAt: at(-500) })];
    const t = timeline(o, deps, 60, NOW);
    expect(t.map((i) => i.text)).toEqual(["배포 abcdef1", "오류가 처음 나타났습니다 (5건)", "로그가 가장 많았습니다 (5분에 400건)"]);
    expect(t.map((i) => i.kind)).toEqual(["deploy", "log", "log"]);
    expect(t[0].deploy?.id).toBe("d1");
  });

  it("says nothing it does not know: no errors, one slice and no deployments is an empty timeline", () => {
    expect(timeline(obs({ buckets: [bucket(10, 100)] }), [], 60, NOW)).toEqual([]);
    expect(timeline(obs(), undefined, 60, NOW)).toEqual([]);
  });
});

it("reads time and windows plainly", () => {
  expect(agoText(NOW - 5_000, NOW)).toBe("방금");
  expect(agoText(NOW - 5 * 60_000, NOW)).toBe("5분 전");
  expect(agoText(NOW - 3 * 3_600_000, NOW)).toBe("3시간 전");
  expect(agoText(NOW - 2 * 86_400_000, NOW)).toBe("2일 전");
  expect(windowLabel(15)).toBe("15분");
  expect(windowLabel(1440)).toBe("24시간");
  expect(windowLabel(90)).toBe("90분");
});
