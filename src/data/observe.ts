// Turns what the logs show about an app (GET /v1/apps/{name}/observability) into the sentences and the timeline the
// console's observation popup reads aloud. Pure functions, so the wording is tested.
import type { AppObservation, Deployment } from "../api/types";

export type ObserveLevel = "none" | "ok" | "warn" | "bad";

export interface ObserveSummary {
  level: ObserveLevel;
  /** the one line that says how the app is doing */
  headline: string;
  /** the numbers behind it, one short sentence each */
  lines: string[];
}

export interface TimelineItem {
  at: number;
  /** where it comes from, for the label next to it */
  kind: "deploy" | "log";
  text: string;
  /** a deployment's status, so the popup can draw its chip */
  deploy?: Deployment;
}

const ms = (t: string | undefined) => (t ? Date.parse(t) : NaN);

export const WINDOWS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15분" },
  { minutes: 60, label: "1시간" },
  { minutes: 360, label: "6시간" },
  { minutes: 1440, label: "24시간" },
];

export function windowLabel(minutes: number): string {
  return WINDOWS.find((w) => w.minutes === minutes)?.label ?? minutes + "분";
}

export const num = (n: number) => n.toLocaleString("ko-KR");

/** "3분 전", "2시간 전"; the clock is passed in so a test can fix it. */
export function agoText(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return Math.floor(s / 60) + "분 전";
  if (s < 86_400) return Math.floor(s / 3600) + "시간 전";
  return Math.floor(s / 86_400) + "일 전";
}

/**
 * How the app is doing, in words. No errors is "정상"; errors are "확인 필요", and "문제" from one in twenty lines.
 * No lines at all is not "정상": it can be a quiet app or an app whose logs are not collected, and the logs cannot say which.
 */
export function summarize(o: AppObservation, minutes: number, now: number): ObserveSummary {
  const win = windowLabel(minutes);
  if (o.total === 0) {
    return {
      level: "none",
      headline: `최근 ${win} 동안 이 앱의 로그가 없습니다`,
      lines: ["앱이 조용하거나 이 앱의 로그를 모으지 않는 것일 수 있습니다. 로그만으로는 어느 쪽인지 알 수 없습니다."],
    };
  }
  const rate = o.errors / o.total;
  const level: ObserveLevel = o.errors === 0 ? "ok" : rate >= 0.05 ? "bad" : "warn";
  const headline =
    level === "ok" ? `최근 ${win} 동안 오류 없이 돌고 있습니다` : level === "warn" ? `최근 ${win} 동안 오류가 ${num(o.errors)}건 있었습니다` : `최근 ${win} 동안 오류가 많습니다 (${num(o.errors)}건)`;
  const lines = [`로그 ${num(o.total)}건 중 오류 ${num(o.errors)}건, 경고 ${num(o.warnings)}건입니다.`];
  const top = o.services[0];
  if (top) lines.push(`가장 많이 기록한 곳은 ${top.name}(${num(top.total)}건)입니다.`);
  const noisy = [...o.services].sort((a, b) => b.errors - a.errors)[0];
  if (noisy && noisy.errors > 0) lines.push(`오류는 ${noisy.name}에서 가장 많이 나왔습니다(${num(noisy.errors)}건).`);
  const last = Math.max(...o.services.map((s) => ms(s.lastSeen)).filter((t) => !Number.isNaN(t)));
  if (Number.isFinite(last)) lines.push(`마지막 로그는 ${agoText(last, now)}에 남았습니다.`);
  return { level, headline, lines };
}

/**
 * What happened, newest first: the app's recent deployments and what the logs mark (the first error of the window and
 * the busiest five minutes). Only what the two sources really say; nothing is inferred between them.
 */
export function timeline(o: AppObservation, deployments: Deployment[] | undefined, minutes: number, now: number): TimelineItem[] {
  const from = now - minutes * 60_000;
  const items: TimelineItem[] = [];
  for (const d of deployments ?? []) {
    const at = ms(d.createdAt);
    if (!Number.isNaN(at) && at >= from) items.push({ at, kind: "deploy", text: `배포 ${d.commit.slice(0, 7)}`, deploy: d });
  }
  const firstErr = o.buckets.find((b) => b.errors > 0);
  if (firstErr) items.push({ at: ms(firstErr.time), kind: "log", text: `이 기간의 첫 오류가 나타났습니다 (${firstErr.errors}건)` });
  const busiest = o.buckets.reduce<(typeof o.buckets)[number] | undefined>((m, b) => (!m || b.total > m.total ? b : m), undefined);
  if (busiest && busiest.total > 0 && o.buckets.length > 1) items.push({ at: ms(busiest.time), kind: "log", text: `로그가 가장 많았습니다 (5분에 ${num(busiest.total)}건)` });
  return items.filter((i) => !Number.isNaN(i.at)).sort((a, b) => b.at - a.at);
}
