// AI agent sessions (GET /v1/agent/sessions) and their events, shared by the migration page and the AI activity page.
import type { AgentEvent, AgentSession, AgentSessionKind, AgentSessionStatus, RunEvent } from "../api/types";
import { fmt, mmss } from "../sim/format";
import type { LogLine } from "../sim/state";
import { Chip, LogBox, Table, td, type ChipKind } from "./ui";

export const KIND_LABEL: Record<AgentSessionKind, string> = {
  plan: "계획",
  rehearsal: "리허설",
  diagnose: "진단",
  explain: "설명",
  other: "기타",
};

const STATUS: Record<AgentSessionStatus, [string, ChipKind]> = {
  running: ["진행 중", "run"],
  succeeded: ["완료", "ok"],
  failed: ["실패", "bad"],
  cancelled: ["취소", ""],
};

export function SessionStatus({ s }: { s: AgentSessionStatus }) {
  return <Chip kind={STATUS[s][1]}>{STATUS[s][0]}</Chip>;
}

/** Seconds between two RFC 3339 times. */
export function secs(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);
}

function short(v: unknown, max = 160): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** One line per agent event, in the console's words. Credential-like values arrive as "[redacted]" from the server. */
export function eventText(e: AgentEvent): string {
  switch (e.type) {
    case "tool_call":
      return "도구 호출 " + (e.tool ?? "") + " " + short(e.input);
    case "tool_result":
      return (e.tool ?? "도구") + " 결과" + (e.status ? " (" + e.status + ")" : "") + ": " + short(e.output);
    case "blocked":
      return "차단됨: " + short((e.input as { command?: string } | undefined)?.command ?? e.tool) + " — " + short(e.output);
    case "decision":
      return "결정: " + short(e.output);
    case "error":
      return "오류: " + short(e.output);
    default:
      return short(e.output);
  }
}

export function agentLines(s: AgentSession, events: AgentEvent[]): LogLine[] {
  return events.map((e) => [mmss(secs(s.createdAt, e.time)), eventText(e)]);
}

export function runLines(startedAt: string, events: RunEvent[]): LogLine[] {
  return events.map((e) => [mmss(secs(startedAt, e.time)), (e.step ? "[" + e.step + "] " : "") + (e.message || e.kind)]);
}

export function SessionTable({ sessions, onPick, picked }: { sessions: AgentSession[]; onPick?: (id: string) => void; picked?: string | null }) {
  return (
    <Table
      head={["종류", "제목", "상태", "도구 호출", "토큰 (입력 / 출력)", ""]}
      rows={sessions.map((s) => [
        td(<Chip>{KIND_LABEL[s.kind]}</Chip>),
        td(s.title),
        td(<SessionStatus s={s.status} />),
        td(fmt(s.totals.toolCalls) + "회", "num"),
        td(fmt(s.totals.inputTokens) + " / " + fmt(s.totals.outputTokens), "num"),
        td(
          onPick ? (
            <button type="button" className="btn ghost" aria-pressed={picked === s.id} onClick={() => onPick(s.id)}>
              {picked === s.id ? "보는 중" : "기록 보기"}
            </button>
          ) : (
            ""
          ),
        ),
      ])}
    />
  );
}

export function SessionFeed({ s, events }: { s: AgentSession; events: AgentEvent[] }) {
  return (
    <div className="box">
      <div className="bh">
        <b>
          {KIND_LABEL[s.kind]}: {s.title}
        </b>
        <SessionStatus s={s.status} />
      </div>
      <div className="bb">
        <LogBox lines={agentLines(s, events)} />
        <dl className="kv sm">
          <dt>모델</dt>
          <dd className="m">{s.model ?? "-"}</dd>
          <dt>요약</dt>
          <dd>{s.summary ?? "진행 중"}</dd>
        </dl>
      </div>
    </div>
  );
}

/** What the AI tried and what stopped it, from `blocked` events. */
export function blockedOf(events: AgentEvent[]): { command: string; by: string }[] {
  return events.filter((e) => e.type === "blocked").map((e) => ({ command: short((e.input as { command?: string } | undefined)?.command ?? e.tool), by: short(e.output) }));
}

/** The commands the platform blocked for the AI, from `blocked` events. */
export function BlockedTable({ events }: { events: AgentEvent[] }) {
  const blk = blockedOf(events);
  return (
    <div className="box">
      <div className="bh">
        <b>막힌 명령</b>
        <Chip>{blk.length}건</Chip>
      </div>
      {blk.length ? (
        <Table head={["AI 권한으로 시도한 명령", "막은 장치", ""]} rows={blk.map((b) => [td(b.command, "m"), td(b.by), td(<Chip kind="bad">차단</Chip>)])} />
      ) : (
        <div className="bb">
          <p className="hint">막힌 명령이 없습니다. AI가 권한 밖의 명령을 시도하면 플랫폼이 막고 여기에 남깁니다.</p>
        </div>
      )}
    </div>
  );
}
