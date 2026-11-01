export function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

/** seconds → "mm:ss" */
export function mmss(s: number): string {
  s = Math.max(0, Math.floor(s + 1e-9));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
}

/** seconds → "2분 31초" / "13초" */
export function dur(s: number): string {
  s = Math.round(s);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? m + "분 " + r + "초" : r + "초";
}

export type StepState = "wait" | "run" | "ok" | "bad";
export const ST: Record<StepState, string> = { wait: "대기", run: "진행 중", ok: "완료", bad: "실패" };

export function stOf(t: number, s: number, e: number): StepState {
  return t >= e - 1e-9 ? "ok" : t >= s - 1e-9 ? "run" : "wait";
}
