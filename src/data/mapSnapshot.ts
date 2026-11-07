// The migration map's snapshot (PORTING.md §4 render(snapshot)): everything the map draws, built from the console's
// migration state at every stage, from the setup through the AI plan and rehearsal, the approval and the engine run.
// In demo mode that state is the console's simulation, in live mode the platform (plans, AI sessions, the run over
// SSE, the gateway). Nothing here is invented: a value the state does not hold is shown as unknown.
import type { AgentEvent, AgentSession, Environment, Run, RunEvent, TrafficState } from "../api/types";
import { blockedOf, eventText as agentText } from "../components/agent";
import { ENV, ENV_ORDER, envKeyOf, sampleBucketName, type EnvKey } from "../sim/data";
import { CANARY, CANARY_PRESETS, ENGINE_STEPS, statusText } from "../sim/mig";
import { approvalBlock, PLATFORM_GATE, rehearsing, type MigrationView } from "./migration";
import { isAfter } from "../api/hooks";
import { mapEvents, mapFacts, mapSteps, type MapFacts } from "./migrationMap";
import type { CheckStatus } from "./preflight";

export type NodeSt = "idle" | "plan" | "busy" | "ready" | "live" | "standby" | "crit";
/** "warn": ran and went on without a verdict (a canary step with too few requests), not a failure. */
export type PhaseSt = "done" | "cur" | "wait" | "fail" | "todo" | "skip" | "warn";
export type LineCls = "cmd" | "m" | "ok" | "w" | "err" | "a";
export type Line = [text: string, cls: LineCls];
export type MapAction = "approve" | "switch" | "abort" | "resume" | "rollback" | "reset";
type Tone = "muted" | "info" | "ok" | "warn" | "crit";

export interface SnapLane {
  role: "src" | "tgt" | "";
  name: string;
  region: string;
  cluster: string;
  cSub: string;
  store: string;
  sSub: string;
  tag: string;
  tagTone: Tone;
}

export interface SnapPhase {
  key: string;
  group: string;
  label: string;
  st: PhaseSt;
  /** run time so far or in all, "" when it has not started */
  dur: string;
  /** the run console's lines for this phase */
  lines: Line[];
}

export interface MapSnapshot {
  v: 1;
  scope: string;
  src: EnvKey;
  tgt: EnvKey;
  /** where the numbers come from, e.g. 시뮬레이션 데이터, 엔진 상태 수신 중 */
  source: string;
  /** the live stream dropped: everything is the last state received */
  stale: boolean;
  lanes: Record<EnvKey, SnapLane>;
  /** `${lane}.cluster|app|db|store`, `user`, `gslb` */
  nodes: Record<string, [NodeSt, string]>;
  app: string;
  /** share of reads on the target, 0 to 100; undefined when unknown */
  share?: number;
  cross: boolean;
  crossLabel: string;
  sync: { mode: "none" | "copy" | "cdc"; label: string; num: string; files: boolean };
  /** motion on the target before the run: the AI's read-only queries, or the sandbox rehearsal */
  activity: "none" | "probe" | "sandbox";
  /** the target's error rate, 0 to 1, for the red dots */
  errRate: number;
  errEdge: boolean;
  kpi: {
    phase: string;
    pill: [cls: string, text: string];
    weights: string;
    weightsSub: string;
    split: [number, number];
    weightsFrom: string;
    sync: [big: string, sub: string];
    slo: [big: string, sub: string, crit: boolean];
  };
  phases: SnapPhase[];
  /** index of the phase at work, waiting or failed; -1 before the setup is done or once every phase is past */
  cur: number;
  banners: { cls: "" | "okb" | "wab" | "inb"; title: string; text: string }[];
  detail: { title: string; desc: string; checks: [name: string, evidence: string, pillCls: string, pillText: string][] };
  /** Explanations and received evidence, shown only in the detailed view. */
  validations: { title: string; purpose: string; criteria: string; status: string; tone: string; summary: string; evidence: string[] }[];
  /** the engine events panel: AI session events and run events, oldest first, at most 120 */
  events: { id: string; ts: string; kind: string; cls: string; text: string }[];
  actions: { key: MapAction; label: string; cls: string }[];
  busy: boolean;
}

export interface SnapshotContext {
  traffic?: TrafficState;
  envs?: Environment[];
  /** wall clock for the durations of phases still at work */
  now: number;
  /** the run's headline and explanation (Migrate's heroText) */
  hero?: [string, string];
}

const LANE_NAME: Record<EnvKey, string> = { aws: "AWS", gcp: "Google Cloud", onprem: "온프레미스" };
const PILL: Record<PhaseSt, [string, string]> = { done: ["ok", "통과"], cur: ["info", "진행 중"], wait: ["wa", "대기"], fail: ["no", "실패"], skip: ["idle", "건너뜀"], todo: ["idle", "대기"], warn: ["wa", "판단 보류"] };
const CHECK_ST: Record<CheckStatus, PhaseSt> = { pass: "done", fail: "fail", unknown: "skip", info: "done", skip: "skip" };
const SESSION_ST: Record<AgentSession["status"], PhaseSt> = { succeeded: "done", running: "cur", failed: "fail", cancelled: "skip" };

const clock = (t: string) => new Date(t).toLocaleTimeString("ko-KR", { hour12: false });
const secsBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 1000);
const fmtDur = (s: number) => (s < 60 ? Math.round(s) + "s" : Math.floor(s / 60) + "m " + Math.round(s % 60) + "s");
const fmtN = (n: number) => Math.round(n).toLocaleString("ko-KR");
export const bytes = (n: number) => (n < 1024 ? fmtN(n) + " B" : n < 1024 ** 2 ? (n / 1024).toFixed(1) + " KiB" : (n / 1024 ** 2).toFixed(1) + " MiB");
const short = (v: unknown, max = 90) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

function agentCls(e: AgentEvent): LineCls {
  if (e.type === "tool_call") return "cmd";
  if (e.type === "blocked") return "w";
  if (e.type === "error") return "err";
  if (e.type === "decision") return "ok";
  if (e.type === "tool_result") return e.status && e.status !== "ok" ? "err" : "m";
  return "m";
}

export function runEventText(e: RunEvent): string {
  const d = e.data ?? {};
  if (e.message) return e.message;
  if (e.kind === "status_changed") return "status=" + d.status + " phase=" + d.phase + (d.reason ? " · " + d.reason : "");
  if (e.kind === "metric") return typeof d.lagBytes === "number" ? "replication lag " + bytes(d.lagBytes) : typeof d.downtimeMillis === "number" ? "write hold " + d.downtimeMillis + "ms" : "";
  if (e.kind === "canary_step") return "read weight → target " + d.weight + "%";
  if (e.kind === "gate_result" || e.kind === "observe_step") {
    const g = d.gate as { passed?: boolean; errorRate?: number; p95Millis?: number; requests?: number; reason?: string } | undefined;
    const verdict = typeof d.verdict === "string" ? d.verdict : g?.passed ? "pass" : "fail";
    return verdict + (g ? " · requests=" + g.requests + " err=" + ((g.errorRate ?? 0) * 100).toFixed(2) + "% p95=" + g.p95Millis + "ms" + (g.reason ? " · " + g.reason : "") : "");
  }
  if (e.kind === "observe_rollback") return d.rollbackRunId ? "rollback run " + d.rollbackRunId : "rollback error: " + d.error;
  return "";
}

function runCls(e: RunEvent): LineCls {
  if (e.kind === "step_failed" || e.kind === "halt" || e.kind === "rollback") return "err";
  if (e.kind === "step_succeeded" || e.kind === "done") return "ok";
  if (e.kind === "gate_result" || e.kind === "observe_step") return (e.data?.gate as { passed?: boolean } | undefined)?.passed || e.data?.verdict === "ok" ? "ok" : e.data?.verdict === "inconclusive" ? "w" : "err";
  if (e.kind === "step_started") return "cmd";
  if (e.kind === "status_changed") return "a";
  if (e.kind === "canary_step") return "w";
  return "m";
}
const runLine = (e: RunEvent): Line => [clock(e.time) + "  " + (e.step ? "[" + e.step + "] " : "") + e.kind + (runEventText(e) ? "  " + runEventText(e) : ""), runCls(e)];
const agentLine = (e: AgentEvent): Line => [clock(e.time) + "  " + agentText(e), agentCls(e)];

/* ---------- phases ---------- */

interface Phase extends Omit<SnapPhase, "dur"> {
  desc: string;
  checks: [string, string, PhaseSt][];
  startedAt?: string;
  endedAt?: string;
}

function phasesOf(v: MigrationView, r: Run | undefined, events: RunEvent[]): Phase[] {
  const out: Phase[] = [];
  const steps = r ? mapSteps(r, events) : undefined;
  const active = !!r && (r.status === "running" || r.status === "awaiting_switch");
  const evOf = (s?: AgentSession) => (s ? v.sessionEvents(s.id) : []);

  // AI plan: the plan session, else a plan someone submitted without the AI
  const plan = v.sessions.find((s) => s.kind === "plan");
  const planSt: PhaseSt = plan ? SESSION_ST[plan.status] : v.plan ? "done" : v.stage === "ai" ? "cur" : "todo";
  out.push({
    key: "ai-plan",
    group: "검증",
    label: "AI 계획",
    desc: "AI가 읽기 전용 도구로 두 클러스터를 조회해 이전 Plan을 만듭니다. 운영 클러스터를 바꾸는 권한은 없습니다.",
    st: planSt,
    startedAt: plan?.createdAt,
    endedAt: plan?.endedAt,
    checks: plan
      ? [
          ["읽기 전용 도구 호출", fmtN(plan.totals.toolCalls) + "회", plan.status === "running" ? "cur" : "done"],
          ["토큰 (입력 / 출력)", fmtN(plan.totals.inputTokens) + " / " + fmtN(plan.totals.outputTokens), plan.status === "running" ? "cur" : "done"],
          ["Plan 제출", v.plan ? v.plan.ref + " · revision " + v.plan.revision : "작성 중", v.plan ? "done" : planSt],
        ]
      : v.plan
        ? [["Plan 제출", v.plan.ref + " · " + v.plan.submittedBy, "done"]]
        : [],
    lines: plan ? evOf(plan).map(agentLine) : v.plan ? [["AI 계획 세션 없음 · Plan 제출: " + v.plan.submittedBy, "m"]] : [],
  });

  // the sandbox rehearsal, with the AI's diagnoses of a failed attempt
  const reh = v.sessions.find((s) => s.kind === "rehearsal");
  const diags = v.sessions.filter((s) => s.kind === "diagnose");
  const rehEvents = [...evOf(reh), ...diags.flatMap(evOf)].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const blocked = blockedOf(rehEvents);
  const rehSt: PhaseSt = reh ? SESSION_ST[reh.status] : v.plan && v.stage !== "ai" ? "skip" : "todo";
  out.push({
    key: "ai-rehearsal",
    group: "검증",
    label: "샌드박스 리허설",
    desc: "대상 클러스터의 격리된 샌드박스에서 테스트 데이터로 미리 실행합니다. 실패하면 AI가 원인을 진단하고 수정안을 Plan에 첨부합니다.",
    st: rehSt,
    startedAt: reh?.createdAt,
    endedAt: reh?.endedAt,
    checks: reh
      ? [
          ["리허설", reh.summary ?? (reh.status === "running" ? "실행 중" : reh.status), rehSt],
          ["실패 후 AI 진단", diags.length ? diags.length + "회" + (v.plan?.attachments?.length ? " · 수정안 첨부" : "") : "없음", diags.length ? "done" : "skip"],
          ["AI 권한 밖 명령", blocked.length ? blocked.length + "건 모두 차단" : "시도 없음", blocked.length ? "done" : "skip"],
        ]
      : [],
    lines: rehEvents.map(agentLine),
  });

  // the operator's approval, then the platform's pre-start checks
  const p = v.plan;
  const approveSt: PhaseSt = !p ? "todo" : p.status === "pending_approval" ? (v.stage === "review" ? "wait" : "todo") : p.status === "rejected" ? "fail" : "done";
  out.push({
    key: "approve",
    group: "게이트",
    label: "최종 승인",
    desc: "운영자가 화면에 보인 Plan revision을 승인해야 엔진이 시작합니다. 그사이 첨부가 바뀌면 승인이 거절됩니다.",
    st: approveSt,
    endedAt: r?.startedAt,
    checks: p
      ? [
          ["Plan", p.ref + " · revision " + p.revision, "done"],
          ["첨부", p.attachments?.length ? p.attachments.map((a) => a.name).join(", ") : "없음", "done"],
          ["운영자 승인", approveSt === "wait" ? "대기 중" : approveSt === "done" ? (r ? "시작: " + r.startedBy : "승인됨") : approveSt === "fail" ? "반려" : "-", approveSt === "todo" ? "todo" : approveSt],
        ]
      : [],
    lines: p ? [["Plan " + p.ref + " revision " + p.revision + " · 제출 " + p.submittedBy, "m"], ...(approveSt === "done" ? ([["승인됨" + (r ? " · 시작 " + r.startedBy : ""), "ok"]] as Line[]) : [])] : [],
  });
  const pf = v.preflight;
  const pfItems = pf ? [pf.residency, pf.capacity].flatMap((x) => (x.items.length ? x.items : [{ label: x.summary, status: x.status, detail: "" }])) : [];
  out.push({
    key: "preflight",
    group: "게이트",
    label: "시작 전 검사",
    desc: "데이터 레지던시 정책과 대상 용량(접속 한도, 대기 서버 설정, 복제 따라잡기)을 확인합니다. 명백히 실패할 이전은 시작하지 않습니다.",
    st: pf ? (pf.blocked ? "fail" : "done") : r ? "skip" : "todo",
    endedAt: pf?.at,
    checks: pfItems.map((i): [string, string, PhaseSt] => [i.label, i.detail, CHECK_ST[i.status]]),
    lines: pfItems.map((i): Line => [i.label + (i.detail ? " · " + i.detail : ""), i.status === "fail" ? "err" : i.status === "pass" ? "ok" : "m"]),
  });

  // the engine run
  const engine = (id: string, group: string) => {
    const def = ENGINE_STEPS.find((s) => s.id === id)!;
    const rec = r?.engine.steps[id];
    const s = steps?.[id] ?? "pending";
    const st: PhaseSt = s === "succeeded" ? "done" : s === "failed" ? "fail" : s === "skipped" ? "skip" : s === "running" ? (active ? "cur" : r?.engine.failureStep === id ? "fail" : "todo") : "todo";
    const checks: [string, string, PhaseSt][] = Object.entries(rec?.evidence ?? {}).map(([k, x]) => [k, short(x), st === "fail" ? "fail" : "done"]);
    if (rec?.error) checks.push(["오류", short(rec.error, 140), "fail"]);
    out.push({ key: id, group, label: def.label, desc: def.detail, st, startedAt: rec?.startedAt, endedAt: rec?.endedAt, checks, lines: events.filter((e) => e.step === id).map(runLine) });
  };
  ["precheck", "prepare", "presync", "delta"].forEach((id) => engine(id, "데이터"));

  const c = r?.canary;
  const http = (r ? !!c : p?.summary.gatewayMode === "http") || (!p && !r);
  const weights = c ? c.options.weights : (v.start ? CANARY_PRESETS[v.start.options.canary] : CANARY).weights;
  if (!http) {
    out.push({ key: "canary", group: "트래픽", label: "읽기 카나리", desc: "게이트웨이(http)를 거치지 않는 Plan이라 카나리 없이 전환합니다.", st: steps?.delta === "succeeded" ? "skip" : "todo", checks: [], lines: [] });
  } else {
    weights.forEach((w, i) => {
      const s = c?.steps[i];
      const g = s?.gate;
      const verdict = s?.verdict ?? (g ? (g.passed ? "ok" : "failed") : undefined);
      const st: PhaseSt = !s ? "todo" : verdict === "ok" ? "done" : verdict === "inconclusive" ? "warn" : verdict === "failed" ? "fail" : active ? "cur" : "fail";
      const checks: [string, string, PhaseSt][] = g
        ? [
            ["요청 수 ≥ " + PLATFORM_GATE.minRequests, fmtN(g.requests), g.requests >= PLATFORM_GATE.minRequests ? "done" : "warn"],
            ["오류율 ≤ " + PLATFORM_GATE.maxErrorRate * 100 + "%", (g.errorRate * 100).toFixed(2) + "%", g.errorRate <= PLATFORM_GATE.maxErrorRate ? "done" : "fail"],
            ["p95 ≤ " + PLATFORM_GATE.maxP95Millis + "ms", g.p95Millis + "ms", g.p95Millis <= PLATFORM_GATE.maxP95Millis ? "done" : "fail"],
          ]
        : s
          ? [["게이트 판정", "관찰 중", "cur"]]
          : [];
      if (g && !g.passed && g.reason) checks.push(["판정", g.reason, st === "warn" ? "warn" : "fail"]);
      const span = (e: RunEvent) => !!s && !isAfter(s.startedAt, e.time) && (!s.endedAt || !isAfter(e.time, s.endedAt));
      out.push({
        key: "canary-" + i,
        group: "트래픽",
        label: "카나리 " + w + "%",
        desc: "읽기 " + w + "%를 대상으로 보내고 게이트(오류율, p95 지연)로 판정합니다. 쓰기는 아직 원본 primary로 갑니다. 게이트가 실패하면 읽기를 원본으로 되돌리고 원복합니다.",
        st,
        startedAt: s?.startedAt,
        endedAt: s?.endedAt,
        checks,
        lines: events.filter((e) => (e.kind === "canary_step" || e.kind === "gate_result") && e.data?.weight === w && span(e)).map(runLine),
      });
    });
  }
  const switchStarted = !!steps && (steps.fence !== "pending" || !!r?.switchApprovedAt);
  out.push({
    key: "switch",
    group: "트래픽",
    label: r?.autoSwitch ? "자동 전환" : "전환 승인",
    desc: r?.autoSwitch ? "동기화와 카나리가 끝나면 바로 전환합니다." : "데이터가 맞으면 운영자의 전환 승인을 기다립니다. 승인하면 쓰기를 잠시 붙잡고 대상을 승격합니다.",
    st: r?.status === "awaiting_switch" ? "wait" : switchStarted ? "done" : "todo",
    endedAt: r?.switchApprovedAt,
    checks: r
      ? [
          ...(c ? [["카나리 게이트", c.passed ? "모두 통과" : c.steps.length ? "진행 중" : "대기", c.passed ? "done" : "todo"] as [string, string, PhaseSt]] : []),
          ["전환 승인", r.switchApprovedBy ? "approved by " + r.switchApprovedBy : r.autoSwitch ? "자동" : r.status === "awaiting_switch" ? "대기 중" : "-", r.switchApprovedBy || (r.autoSwitch && switchStarted) ? "done" : r.status === "awaiting_switch" ? "wait" : "todo"],
        ]
      : [],
    lines: events.filter((e) => e.kind === "status_changed" && (e.data?.status === "awaiting_switch" || e.data?.phase === "cutover")).map(runLine),
  });
  ["fence", "switchover", "start-target", "cutover"].forEach((id) => engine(id, "전환"));
  ["verify", "finalize"].forEach((id) => engine(id, "정리"));
  const o = r?.observe;
  if (o) {
    out.push({
      key: "observe",
      group: "정리",
      label: "전환 후 관찰",
      desc: "전환한 뒤에도 대상을 게이트로 계속 판정합니다." + (o.options.autoRollback ? " 어기면 플랫폼이 롤백 run을 시작합니다." : ""),
      st: r!.phase === "observe" && active ? "cur" : o.passed === true ? "done" : o.passed === false ? "fail" : o.stoppedReason ? "skip" : "todo",
      startedAt: o.steps[0]?.startedAt,
      endedAt: o.steps.at(-1)?.endedAt,
      checks: o.steps.map((s, i): [string, string, PhaseSt] => [i + 1 + "단계", s.gate ? (s.gate.errorRate * 100).toFixed(2) + "% · " + s.gate.p95Millis + "ms" : s.verdict, s.verdict === "ok" ? "done" : s.verdict === "violated" ? "fail" : "warn"]),
      lines: events.filter((e) => e.kind === "observe_step" || e.kind === "observe_rollback").map(runLine),
    });
  }
  return out;
}

/** The phase at work or waiting, else where it failed, else the next to do; -1 when every phase is past. */
export function currentOf(phases: { st: PhaseSt }[]): number {
  const at = phases.findIndex((p) => p.st === "cur" || p.st === "wait");
  if (at >= 0) return at;
  const failed = phases.findIndex((p) => p.st === "fail");
  if (failed >= 0) return failed;
  return phases.findIndex((p) => p.st === "todo");
}

/* ---------- nodes ---------- */

type Part = "cluster" | "app" | "db" | "store";
type LaneNodes = Record<Part, [NodeSt, string]>;

/** Before the run: the source serves everything; the target follows the AI plan and the sandbox rehearsal. */
function preRunNodes(v: MigrationView, files: boolean | undefined): { tgt: LaneNodes; tag: [string, Tone]; activity: MapSnapshot["activity"] } {
  const plan = v.sessions.find((s) => s.kind === "plan");
  const reh = v.sessions.find((s) => s.kind === "rehearsal");
  const diag = v.sessions.find((s) => s.kind === "diagnose");
  const store = (st: NodeSt, sub: string): [NodeSt, string] => (files === false ? ["idle", "파일 이전 안 함"] : [st, sub]);
  if (v.stage === "setup") return { tgt: { cluster: ["idle", "대상 후보"], app: ["idle", "배포 전"], db: ["idle", "생성 전"], store: store("idle", "생성 전") }, tag: ["대상 후보", "muted"], activity: "none" };
  if (reh?.status === "running") {
    const fixing = diag?.status === "running";
    return {
      tgt: {
        cluster: ["busy", "샌드박스 네임스페이스"],
        app: fixing ? ["crit", "리허설 실패 · AI 진단 중"] : diag ? ["busy", "수정안으로 다시 실행"] : ["busy", "sandbox 배포"],
        db: ["busy", "sandbox · 테스트 데이터"],
        store: store("busy", "sandbox"),
      },
      tag: [fixing ? "리허설 실패 · 진단 중" : "리허설 중", fixing ? "crit" : "info"],
      activity: "sandbox",
    };
  }
  if (!v.plan && (plan?.status === "running" || v.stage === "ai")) {
    return { tgt: { cluster: ["plan", "AI 조회 중 (읽기 전용)"], app: ["plan", "계획 중"], db: ["plan", "계획 중"], store: store("plan", "계획 중") }, tag: ["AI 계획 중", "info"], activity: "probe" };
  }
  const failed = reh?.status === "failed" || plan?.status === "failed";
  const blocked = v.preflight?.blocked && v.plan?.status === "approved";
  return {
    tgt: { cluster: ["plan", "계획됨"], app: [failed ? "crit" : "plan", failed ? "리허설 실패" : "계획됨"], db: ["plan", "계획됨"], store: store("plan", "계획됨") },
    tag: blocked ? ["시작 전 검사에서 막힘", "crit"] : failed ? ["리허설 실패", "crit"] : reh?.status === "succeeded" ? ["리허설 통과", "info"] : ["계획됨", "info"],
    activity: "none",
  };
}

/** During and after the run, from the record only. */
function runNodes(r: Run, f: MapFacts, files: boolean | undefined, share: number): { src: LaneNodes; tgt: LaneNodes; srcTag: string; tag: [string, Tone] } {
  const s = f.steps;
  const finalized = s.finalize === "succeeded";
  const rolledBack = r.status === "rolled_back";
  const shrunk = finalized && !rolledBack;
  const writes = f.write === "source" ? " · 쓰기" : "";
  const src: LaneNodes = {
    cluster: [shrunk ? "standby" : "live", ""],
    app: [shrunk ? "idle" : "live", shrunk ? "축소됨 · 원본 보존" : f.readShare === undefined ? "읽기 비율 확인 필요" : 100 - share + "% 읽기" + writes],
    db: ["live", "primary"],
    store: [shrunk ? "standby" : "live", files === false ? "파일 이전 안 함" : ""],
  };
  if (f.uncertain) src.db = ["crit", "역할 확인 필요"];
  else if (f.write === "held") src.db = ["busy", "쓰기 보류 중"];
  else if (f.promoted && !rolledBack) src.db = ["standby", r.engine.sourceDemoted ? "쓰기 차단 · 보존" : "원본 · 보존"];

  const prep = s.prepare;
  const tgt: LaneNodes = { cluster: ["plan", "계획됨"], app: ["plan", "계획됨"], db: ["plan", "계획됨"], store: ["plan", files === false ? "파일 이전 안 함" : "계획됨"] };
  if (prep !== "pending") {
    tgt.cluster = prep === "running" ? ["busy", "대상 준비 중"] : prep === "failed" ? ["crit", "준비 실패"] : ["ready", "준비 완료"];
    tgt.app = prep === "running" ? ["busy", "Argo CD 동기화"] : prep === "failed" ? ["crit", "준비 실패"] : ["ready", "Ready · 트래픽 0%"];
    tgt.db = prep === "running" ? ["busy", "CNPG 생성 중"] : prep === "failed" ? ["crit", "준비 실패"] : ["ready", "standby"];
    tgt.store = files === false ? ["idle", "파일 이전 안 함"] : prep === "running" ? ["busy", "버킷 준비 중"] : ["ready", "버킷 준비"];
  }
  if (s.presync === "running") {
    tgt.db = ["busy", "초기 복사 수신"];
    if (files !== false) tgt.store = ["busy", "rclone 복사 중"];
  } else if (s.presync === "succeeded") {
    tgt.db = ["ready", "standby · 복제 수신"];
    if (files !== false) tgt.store = ["ready", "파일 복사 완료"];
  }
  if (s.presync === "failed") tgt.db = ["crit", "초기 복사 실패"];
  if (s.delta === "failed") tgt.db = ["crit", "변경분 동기화 실패"];
  if (share > 0) {
    tgt.cluster = ["live", ""];
    tgt.app = ["live", share + "% 읽기" + (f.write === "target" ? " · 쓰기" : "")];
  }
  if (f.write === "held") tgt.db = ["busy", "쓰기 보류 중"];
  if (s.switchover === "running") tgt.db = ["busy", "승격 중"];
  if (s.switchover === "failed") tgt.db = ["crit", "승격 실패"];
  if (f.promoted) tgt.db = ["live", "primary · 승격됨"];
  if (f.cutover || f.write === "target") {
    tgt.cluster = ["live", ""];
    if (files !== false) tgt.store = ["live", ""];
  }
  if (f.slo && f.slo.errorRate > PLATFORM_GATE.maxErrorRate && share > 0) tgt.app = ["crit", "오류율 " + (f.slo.errorRate * 100).toFixed(1) + "%"];
  if (f.uncertain) tgt.db = ["crit", "역할 확인 필요"];
  if (rolledBack) {
    tgt.app = ["standby", "트래픽 0%"];
    tgt.db = ["standby", "보존 (원인 분석용)"];
    if (files !== false) tgt.store = ["standby", ""];
  } else if ((r.status === "failed" || r.status === "aborted") && !f.promoted) tgt.app = ["standby", "트래픽 0%"];

  const tag: [string, Tone] =
    r.status === "succeeded"
      ? r.observe?.passed === false
        ? ["전환 후 관찰 위반", "crit"]
        : ["이주 완료", "ok"]
      : rolledBack
        ? ["롤백됨", "crit"]
        : r.status === "halted"
          ? ["멈춤 · 확인 필요", "crit"]
          : r.status === "awaiting_switch"
            ? ["전환 승인 대기", "warn"]
            : r.status !== "running"
              ? [statusText(r.status, r.phase), "crit"]
              : [r.phase === "sync" ? "동기화 중" : r.phase === "canary" ? "카나리" : r.phase === "cutover" ? "전환 중" : r.phase === "observe" ? "전환 후 관찰" : "검증 중", "info"];
  return { src, tgt, srcTag: shrunk ? "원본 · 축소됨" : "원본", tag };
}

/* ---------- the snapshot ---------- */

export function buildMapSnapshot(v: MigrationView, ctx: SnapshotContext): MapSnapshot {
  const r = v.stage === "run" ? v.run : undefined;
  const events = r ? mapEvents(r, v.events) : [];
  const srcName = r?.source.env ?? v.plan?.summary.source.env ?? v.src;
  const tgtName = r?.target.env ?? v.plan?.summary.target.env ?? v.tgt;
  const src = envKeyOf(srcName) ?? "aws";
  const tgt = envKeyOf(tgtName) ?? ENV_ORDER.find((k) => k !== src)!;
  const envOf = (name: string) => ctx.envs?.find((e) => e.name === name);
  const backends = { src: envOf(srcName)?.gatewayBackend ?? srcName, tgt: envOf(tgtName)?.gatewayBackend ?? tgtName };
  const files = v.plan?.summary.files;

  // traffic: the run's record and the gateway during a run; before it, the gateway (live) or all on the source
  const f = r ? mapFacts(r, events, ctx.traffic, backends) : undefined;
  let share: number | undefined = f ? f.readShare : v.live ? undefined : 0;
  let write: MapFacts["write"] = v.live ? "unknown" : "source";
  let fromGateway = false;
  let rps: number | undefined;
  if (f) {
    write = f.write;
    fromGateway = f.fromGateway;
    rps = f.rps;
  } else if (ctx.traffic) {
    const t = ctx.traffic;
    if (backends.src in t.readWeights || backends.tgt in t.readWeights || [backends.src, backends.tgt].includes(t.writeBackend)) {
      share = t.readWeights[backends.tgt] ?? 0;
      write = t.writesHeld ? "held" : t.writeBackend === backends.tgt ? "target" : t.writeBackend === backends.src ? "source" : "unknown";
      fromGateway = true;
      rps = Object.values(t.stats).reduce((n, x) => n + x.rps, 0);
    }
  }
  const sh = share ?? 0;
  const active = !!f?.active;
  const stale = v.live && active && v.stream?.connected === false;

  const pre = r ? undefined : preRunNodes(v, files);
  const run = r && f ? runNodes(r, f, files, sh) : undefined;
  const srcNodes: LaneNodes = run?.src ?? {
    cluster: ["live", ""],
    app: ["live", share === undefined ? "트래픽 미수신" : 100 - sh + "% 읽기" + (write === "source" ? " · 쓰기" : "")],
    db: ["live", "primary"],
    store: [files === false ? "idle" : "live", files === false ? "파일 이전 안 함" : ""],
  };
  const tgtNodes = run?.tgt ?? pre!.tgt;
  const tag = run?.tag ?? pre!.tag;

  const lanes = {} as Record<EnvKey, SnapLane>;
  const nodes: MapSnapshot["nodes"] = {};
  for (const k of ENV_ORDER) {
    const name = k === src ? srcName : k === tgt ? tgtName : undefined;
    const e = name ? envOf(name) : ctx.envs?.find((x) => envKeyOf(x.name) === k);
    let cSub: string;
    if (!v.live) cSub = "v" + ENV[k].k8s + " · 노드 " + ENV[k].nodes;
    else if (!e) cSub = "상태 미수신";
    else if (!e.status.reachable) cSub = "API 응답 없음";
    else cSub = (e.status.kubernetesVersion ?? "") + (e.status.nodes ? " · 노드 " + e.status.nodes.ready + "/" + e.status.nodes.total : "");
    const role = k === src ? "src" : k === tgt ? "tgt" : "";
    lanes[k] = {
      role,
      name: LANE_NAME[k],
      region: v.live ? (e?.region ?? (e ? "" : "등록 안 됨")) : ENV[k].region,
      cluster: ENV[k].short,
      cSub,
      store: ENV[k].storage,
      sSub: v.live ? "" : sampleBucketName(k),
      tag: role === "src" ? (run?.srcTag ?? "원본") : role === "tgt" ? tag[0] : "",
      tagTone: role === "tgt" ? tag[1] : "muted",
    };
    const n: LaneNodes = role === "src" ? srcNodes : role === "tgt" ? tgtNodes : { cluster: ["idle", cSub], app: ["idle", "대상 아님"], db: ["idle", "대상 아님"], store: ["idle", ""] };
    for (const part of ["cluster", "app", "db", "store"] as Part[]) {
      const [st, sub] = n[part];
      const ep = role === "src" ? (r?.source ?? v.plan?.summary.source) : role === "tgt" ? (r?.target ?? v.plan?.summary.target) : undefined;
      const fallback = part === "cluster" ? cSub : part === "store" ? lanes[k].sSub : part === "db" && ep ? ep.cluster : "";
      nodes[k + "." + part] = [st, part === "db" && ep && sub ? ep.cluster + " · " + sub : sub || fallback];
    }
  }
  nodes.user = ["live", rps !== undefined ? fmtN(rps) + " rps" : "요청"];
  nodes.gslb = [write === "held" ? "busy" : f?.uncertain ? "crit" : "live", "게이트웨이 가중치"];

  const phasesFull = phasesOf(v, r, events);
  const cur = v.stage === "setup" ? -1 : currentOf(phasesFull);
  const durOf = (p: Phase) => (p.startedAt && p.st !== "todo" ? fmtDur(secsBetween(p.startedAt, p.endedAt ?? (p.st === "cur" || p.st === "wait" ? new Date(ctx.now).toISOString() : p.startedAt))) : "");
  const phases: SnapPhase[] = phasesFull.map((p) => ({ key: p.key, group: p.group, label: p.label, st: p.st, dur: durOf(p), lines: p.lines }));
  if (r?.status === "rolled_back") {
    phases.push({
      key: "rb",
      group: "롤백",
      label: "원복",
      st: "done",
      dur: r.endedAt ? fmtDur(secsBetween(r.startedAt, r.endedAt)) : "",
      lines: events.filter((e) => e.kind === "rollback" || e.kind === "halt" || e.kind === "done" || (e.kind === "status_changed" && e.data?.status === "rolled_back")).map(runLine),
    });
  }
  const curPhase = cur >= 0 ? phasesFull[cur] : undefined;

  // KPI
  const srcShort = ENV[src].short;
  const tgtShort = ENV[tgt].short;
  const writeText = write === "source" ? srcShort : write === "target" ? tgtShort : write === "held" ? "보류 중" : "확인 필요";
  const pill: [string, string] = r
    ? [stale ? "idle" : r.status === "succeeded" ? (r.observe?.passed === false ? "no" : "ok") : r.status === "awaiting_switch" ? "wa" : r.status === "running" ? "info" : r.status === "aborted" ? "idle" : "no", stale ? "연결 끊김 · 마지막 수신" : statusText(r.status, r.phase)]
    : v.stage === "setup"
      ? ["idle", "이전 전"]
      : v.stage === "ai"
        ? ["info", "AI 작업 중"]
        : v.plan?.status === "approved"
          ? [v.preflight?.blocked ? "no" : "wa", v.preflight?.blocked ? "시작 막힘" : "승인됨 · 시작 전"]
          : rehearsing(v)
            ? ["info", "리허설 중"]
            : approvalBlock(v.plan)
            ? ["no", "승인 불가 · 리허설 미통과"]
            : ["wa", "승인 대기"];
  const phaseTitle = r?.status === "succeeded" ? "완료" : r?.status === "rolled_back" ? "롤백" : r?.status === "halted" ? "멈춤" : v.stage === "setup" ? "이전 설정" : (curPhase?.label ?? (r ? statusText(r.status, r.phase) : "-"));
  const slo = f?.slo;
  const errEdge = !!slo && slo.errorRate > PLATFORM_GATE.maxErrorRate && sh > 0;
  const syncMode = f?.sync ?? "none";
  const kpi: MapSnapshot["kpi"] = {
    phase: phaseTitle,
    pill,
    weights: share === undefined ? "? / ?" : 100 - sh + " / " + sh,
    weightsSub: srcShort + " / " + tgtShort + " (%) · 쓰기 → " + writeText,
    split: share === undefined ? [0, 0] : [100 - sh, sh],
    weightsFrom: fromGateway ? "게이트웨이 실시간" : r ? "run 기록 기준" : v.live ? "게이트웨이 정보 없음 · 이전 전" : "이전 전 · 원본이 모두 처리",
    sync:
      syncMode === "copy"
        ? ["초기 복사", "DB 초기 복사" + (files === false ? "" : " · 파일 rclone")]
        : syncMode === "cdc"
          ? [f?.lag !== undefined ? bytes(f.lag) : "-", "복제 지연 (바이트)" + (f?.lagAt ? " · " + clock(f.lagAt) : " · 측정 전")]
          : f?.steps.delta === "succeeded"
            ? ["완료", "변경분 동기화 완료"]
            : ["-", r ? "동기화 전" : "이전 시작 전"],
    slo: slo
      ? [(slo.errorRate * 100).toFixed(2) + "% · " + Math.round(slo.p95Millis) + "ms", "오류율 · p95 (게이트 " + PLATFORM_GATE.maxErrorRate * 100 + "% · " + PLATFORM_GATE.maxP95Millis + "ms) · " + (slo.from === "gateway" ? "게이트웨이 30초" : "마지막 게이트 " + (slo.at ? clock(slo.at) : "")), errEdge]
      : ["-", sh > 0 ? "측정 안 됨" : "대상에 트래픽 없음", false],
  };

  // banners
  const banners: MapSnapshot["banners"] = [];
  if (stale) banners.push({ cls: "wab", title: "상태 연결이 끊겼습니다. 아래는 마지막으로 받은 상태입니다.", text: v.stream?.error ?? "재연결을 기다리는 중입니다." });
  if (r && ctx.hero) banners.push({ cls: r.status === "awaiting_switch" ? "wab" : r.status === "succeeded" && r.observe?.passed !== false ? "okb" : r.status === "running" ? "inb" : "", title: ctx.hero[0], text: ctx.hero[1] });
  else if (v.stage === "ai") {
    const s = v.sessions[0];
    banners.push({ cls: "inb", title: s?.kind === "rehearsal" ? "AI가 샌드박스에서 리허설하고 있습니다" : s?.kind === "diagnose" ? "리허설이 실패해 AI가 원인을 진단하고 있습니다" : "AI가 두 클러스터를 조회해 계획을 만들고 있습니다", text: s ? s.title + (s.summary ? " · " + s.summary : "") : "AI 세션을 시작하고 있습니다." });
  } else if (v.stage === "review" && v.plan) {
    banners.push(
      v.plan.status === "approved"
        ? { cls: v.preflight?.blocked ? "" : "wab", title: v.preflight?.blocked ? "시작 전 검사에서 막혔습니다" : "승인됐지만 아직 시작하지 않았습니다", text: v.preflight?.blocked ? "검사 결과의 이유를 해결한 뒤 다시 시작하세요." : "다시 시작할 수 있습니다." }
        : rehearsing(v)
          ? { cls: "inb", title: "리허설 중 · Plan " + v.plan.ref + " (revision " + v.plan.revision + ")", text: "AI 실행기가 이 Plan을 샌드박스에서 리허설하고 있습니다(1~2분). 통과하면 승인할 수 있습니다." }
          : approvalBlock(v.plan)
          ? { cls: "", title: "승인할 수 없음 · Plan " + v.plan.ref + " (revision " + v.plan.revision + ")", text: "AI 계획이 리허설을 통과하지 않았습니다. AI 실행기로 다시 리허설하거나 반려하세요. (" + approvalBlock(v.plan) + ")" }
          : { cls: "wab", title: "사람 승인 필요 · Plan " + v.plan.ref + " (revision " + v.plan.revision + ")", text: "승인하면 시작 전 검사를 거쳐 엔진이 실행합니다. [승인 ✓]을 누르거나 오른쪽 승인 카드에서 옵션을 고르세요." },
    );
  }

  // detail panel
  const detail: MapSnapshot["detail"] =
    r?.status === "succeeded" && !curPhase
      ? { title: "이주 완료", desc: "모든 트래픽과 쓰기가 대상에서 처리됩니다. 원본은 읽기 전용으로 남아 있어 같은 방법으로 되돌릴 수 있습니다.", checks: [] }
      : curPhase
        ? {
            title: String(cur + 1).padStart(2, "0") + " · " + curPhase.label,
            desc: curPhase.desc,
            checks: curPhase.checks.length ? curPhase.checks.map(([n, ev, st]) => [n, ev, PILL[st][0], PILL[st][1]]) : [[curPhase.st === "todo" ? "아직 시작 전입니다" : "이 단계의 증거를 아직 받지 못했습니다", "", PILL[curPhase.st][0], PILL[curPhase.st][1]]],
          }
        : v.stage === "setup"
          ? { title: "이전 설정", desc: "옮겨 갈 환경을 고르고 AI 계획을 시작하면, 계획 · 리허설 · 승인 · 실행이 이 지도에 이어서 나타납니다.", checks: [] }
          : { title: r ? statusText(r.status, r.phase) : "-", desc: ctx.hero?.[1] ?? "", checks: [] };

  // engine events panel: what the AI did and what the run did, in time order
  const all: { t: number; id: string; ts: string; kind: string; cls: string; text: string }[] = [];
  const AG_CLS: Record<LineCls, string> = { cmd: "a", m: "m", ok: "g", w: "w", err: "e", a: "a" };
  for (const s of v.sessions)
    for (const e of v.sessionEvents(s.id)) all.push({ t: Date.parse(e.time), id: "a" + s.id + ":" + e.seq, ts: clock(e.time), kind: "ai." + e.type, cls: AG_CLS[agentCls(e)], text: agentText(e) });
  for (const e of events) all.push({ t: Date.parse(e.time), id: "r" + e.runId + ":" + e.seq, ts: clock(e.time), kind: e.kind, cls: AG_CLS[runCls(e)], text: (e.step ? "[" + e.step + "] " : "") + runEventText(e) });
  all.sort((a, b) => a.t - b.t);

  // the real commands the state allows
  const actions: MapSnapshot["actions"] = [];
  if (!r && v.stage === "review" && v.plan && (v.plan.status === "pending_approval" || v.plan.status === "approved") && !approvalBlock(v.plan))
    actions.push({ key: "approve", label: v.plan.status === "approved" ? "다시 시작" : "승인 ✓", cls: "attn" });
  if (r) {
    if (r.status === "awaiting_switch") actions.push({ key: "switch", label: "전환", cls: "attn" });
    if (active && !r.engine.promoteRequested) actions.push({ key: "abort", label: "중단", cls: "ghost" });
    if (r.status === "failed" || r.status === "aborted" || r.status === "interrupted" || r.status === "halted") actions.push({ key: "resume", label: "이어서 실행", cls: "" });
    if (r.status === "succeeded" && !r.observe?.rollbackRunId) actions.push({ key: "rollback", label: "롤백", cls: "danger" });
    if (!active) actions.push({ key: "reset", label: "다른 경로로 이전", cls: "ghost" });
  }

  return {
    v: 1,
    scope: v.plan?.ref ?? r?.runId ?? v.sessions.find((s) => s.kind === "plan")?.id ?? v.app + ":setup",
    src,
    tgt,
    source: !v.live ? "시뮬레이션 데이터" : stale ? "연결 끊김 · 마지막 수신 상태" : active ? "엔진 상태 수신 중" : r ? "종료된 실행 기록" : "플랫폼 상태",
    stale,
    lanes,
    nodes,
    app: v.app || "앱",
    share,
    cross: !!f && !f.cutover && write === "source" && sh > 0 && active,
    crossLabel: "쓰기 → " + srcShort + " primary",
    sync: {
      mode: syncMode,
      label: syncMode === "copy" ? "초기 복사" : syncMode === "cdc" ? "변경분 복제" : f?.steps.delta === "succeeded" ? "복제 종료" : "동기화",
      num: syncMode === "cdc" && f?.lag !== undefined ? "lag " + bytes(f.lag) : syncMode === "copy" ? (files === false ? "DB" : "DB + 파일") : "",
      files: files !== false,
    },
    activity: pre?.activity ?? "none",
    errRate: slo?.errorRate ?? 0,
    errEdge,
    kpi,
    phases,
    cur,
    banners,
    detail,
    validations: [
      {
        title: "동등성 검증",
        purpose: "옮겨 간 환경에서도 원본에 필요한 운영 기능을 제공하는지 확인합니다.",
        criteria: "인증·권한 / 시크릿 / 감사 로그 / 모니터링·알림 / 백업·복구",
        status: !v.preflight?.parity ? "결과 미수신" : ({ pass: "통과", fail: "불일치", unknown: "확인 불가", info: "참고", skip: "검사 안 함" } as const)[v.preflight.parity.status],
        tone: !v.preflight?.parity ? "idle" : ({ pass: "ok", fail: "no", unknown: "wa", info: "info", skip: "idle" } as const)[v.preflight.parity.status],
        summary: v.preflight?.parity?.summary ?? "시작 또는 롤백 요청의 검사 기록을 아직 받지 못했습니다. 이전 완료나 샌드박스 리허설 성공만으로 동등성 통과를 판단하지 않습니다.",
        evidence: v.preflight?.parity ? [
          "검사 시각: " + new Date(v.preflight.at).toLocaleString("ko-KR"),
          ...v.preflight.parity.items.map(i => i.label + ": " + i.detail),
          ...(v.preflight.parity.digest ? ["설정 digest: " + v.preflight.parity.digest] : []),
          "기록 전용: 결과와 상관없이 이전 시작을 막지 않습니다.",
        ] : ["원본의 운영 요구사항과 대상 환경의 실제 점검 결과를 비교합니다.", "검사 결과와 적용 모드에 따른 시작 차단 여부는 플랫폼 기록에서 확인해야 합니다."],
      },
      {
        title: "레지던시 검증",
        purpose: "원본 데이터를 목적지 국가로 옮겨도 되는지 정책에 대조합니다.",
        criteria: "원본 전체 테이블·버킷 / 데이터 분류 / 목적지 국가의 허용 여부",
        status: !v.preflight ? "검사 기록 없음" : ({ pass: "허용", fail: "차단", unknown: "확인 불가", info: "참고", skip: "검사 안 함" } as const)[v.preflight.residency.status],
        tone: !v.preflight ? "idle" : ({ pass: "ok", fail: "no", unknown: "wa", info: "info", skip: "idle" } as const)[v.preflight.residency.status],
        summary: v.preflight?.residency.summary ?? "시작 또는 롤백 요청의 검사 기록을 아직 받지 못했습니다. 기록 없음은 허용을 뜻하지 않습니다.",
        evidence: v.preflight ? [
          "검사 시각: " + new Date(v.preflight.at).toLocaleString("ko-KR"),
          ...v.preflight.residency.items.map(i => i.label + (i.detail ? " · " + i.detail : "")),
          ...(v.preflight.residency.digest ? ["정책 digest: " + v.preflight.residency.digest] : []),
        ] : ["시작 직전에 플랫폼이 검사하며, 정책 위반 시 이전을 시작하지 않습니다.", "정책 미설정·롤백 면제는 실제 검사 통과와 구분합니다."],
      },
    ],
    events: all.slice(-120).map(({ t: _t, ...x }) => x),
    actions,
    busy: v.busy,
  };
}
