// Demo simulation state machine. Time advances in tick() (called every 100ms);
// deploy, onboarding, AI plan, rehearsal, migration prep and cleanup advance 1 simulated second per tick,
// switchover 0.2s per tick (the banner says it's faster than real).
import {
  CL_END,
  CL_LOG,
  DEP_LOG,
  DEP_READY,
  ENV,
  ENV_ORDER,
  FILE_RATE,
  ONB_END,
  ONB_LOG,
  PLAN_END,
  PREP_END,
  RATE,
  REH_END,
  REPOS,
  SAMPLE,
  SW_CATCHUP,
  SW_END,
  SW_FLIP,
  SW_HOLD_START,
  SW_LOG,
  planLog,
  prepLog,
  rehLog,
  routeKey,
  type EnvKey,
  onbFinishLog,
  type LogEntry,
  type OnbStep,
} from "./data";
import { dur, fmt, mmss } from "./format";

/** [mm:ss, message] */
export type LogLine = [string, string];
/** [commit, message, when, duration] */
export type DeployRow = [string, string, string, string];
/** [kind, name, detail] */
export type ResRow = [string, string, string];

export interface App {
  id: string;
  repo: string;
  /** platform: one copy per chosen env. service: one live copy behind the gateway, can be migrated. */
  kind: "platform" | "service";
  envs?: EnvKey[];
  loc?: EnvKey;
  prev?: EnvKey;
  deploys: DeployRow[];
  res: ResRow[];
}

interface Feed {
  t: number;
  log: LogLine[];
  li: number;
}

export interface DepState extends Feed {
  phase: "form" | "run" | "done";
  repo: string;
  envs: Record<EnvKey, boolean>;
}

export interface OnbState extends Feed {
  step: OnbStep;
  run: boolean;
  /** cluster the imported app is first deployed to; its sandbox runs there too */
  env: EnvKey;
  done: Record<2 | 3 | 4, boolean>;
  approved: boolean;
}

export type MigPhase = "idle" | "plan" | "rehearse" | "approve" | "prep" | "switch" | "cleanup" | "done";

export interface MigState extends Feed {
  phase: MigPhase;
  src: EnvKey;
  tgt: EnvKey;
  /** AI plan + rehearsal log, separate from the engine's log */
  ai: Feed;
  tPrep: number;
  tSw: number;
  tCl: number;
  ok: number;
  held: number;
  heldDone: number;
  flipped: boolean;
  files: number;
  del: boolean;
}

export interface RouteResult {
  total: number;
  sw: number;
  hold: number;
  failed: number;
  ok: number;
  lostRows: number;
  lostFiles: number;
  when: string;
}

export interface SimState {
  apps: Record<string, App>;
  appOrder: string[];
  /** [when, message] */
  act: [string, string][];
  dep: DepState;
  onb: OnbState;
  mig: MigState;
  results: Record<string, RouteResult>;
}

function freshMig(src: EnvKey): MigState {
  return {
    phase: "idle", src, tgt: ENV_ORDER.find((k) => k !== src)!, t: 0, log: [], li: 0,
    ai: { t: 0, log: [], li: 0 },
    tPrep: 0, tSw: 0, tCl: 0, ok: 0, held: 0, heldDone: 0, flipped: false, files: SAMPLE.files, del: false,
  };
}

export function fresh(): SimState {
  return {
    apps: {
      "todo-api": {
        id: "todo-api",
        repo: "team-charlie/todo-api",
        kind: "platform",
        envs: ["aws", "gcp", "onprem"],
        deploys: [
          ["a41c9e2", "할 일 정렬 기능 추가", "12분 전", "2분 41초"],
          ["7be03d1", "헬스 체크 경로 추가", "어제", "1분 58초"],
        ],
        res: [["PostgreSQL", "todo-api-db", "환경마다 1개 (CloudNativePG)"]],
      },
    },
    appOrder: ["todo-api"],
    act: [
      ["12분 전", "todo-api 배포 완료 (3개 환경, 2분 41초)"],
      ["어제", "Tailscale로 클러스터 3개 연결"],
      ["어제", "온프레미스 k3s 환경 등록"],
    ],
    dep: { phase: "form", repo: "notice-board", envs: { aws: true, gcp: true, onprem: true }, t: 0, log: [], li: 0 },
    onb: { step: 1, run: false, t: 0, log: [], li: 0, env: "aws", done: { 2: false, 3: false, 4: false }, approved: false },
    mig: freshMig("aws"),
    results: {},
  };
}

/** Append every log entry whose time has come. */
export function feed(o: Feed, list: LogEntry[], t: number, off = 0): void {
  while (o.li < list.length && list[o.li][0] <= t + 1e-9) {
    o.log.push([mmss(off + list[o.li][0]), list[o.li][1]]);
    o.li++;
  }
}

/* ---------- deploy ---------- */

export function depEnvs(S: SimState): EnvKey[] {
  return ENV_ORDER.filter((k) => S.dep.envs[k]);
}
export function depEnd(S: SimState): number {
  const e = depEnvs(S).map((k) => DEP_READY[k]);
  return e.length ? Math.max(...e) : 55;
}
function depLog(S: SimState): LogEntry[] {
  const extra: LogEntry[] = depEnvs(S).map((k) => [DEP_READY[k], ENV[k].name + " 준비 완료 (Pod 2/2)"]);
  return DEP_LOG.concat(extra)
    .concat([[depEnd(S), "배포 완료, 웹 접속 가능"]])
    .sort((a, b) => a[0] - b[0]);
}
function firstFreeRepo(S: SimState): string {
  for (const k of Object.keys(REPOS)) if (REPOS[k].ok && !S.apps[k]) return k;
  return "analytics-worker";
}
function finishDeploy(S: SimState): void {
  const k = S.dep.repo;
  S.apps[k] = {
    id: k,
    repo: REPOS[k].label,
    kind: "platform",
    envs: depEnvs(S),
    deploys: [[REPOS[k].commit ?? "", "첫 배포", "방금", dur(depEnd(S))]],
    res: [["PostgreSQL", k + "-db", "환경마다 1개 (CloudNativePG)"]],
  };
  S.appOrder.push(k);
  S.act.unshift(["방금", k + " 배포 완료 (" + depEnvs(S).length + "개 환경, " + dur(depEnd(S)) + ")"]);
}

/* ---------- onboarding ---------- */

function finishOnboard(S: SimState): void {
  if (S.apps[SAMPLE.id]) return;
  const env = S.onb.env;
  S.apps[SAMPLE.id] = {
    id: SAMPLE.id,
    repo: SAMPLE.repo,
    kind: "service",
    loc: env,
    deploys: [["9d2b71f", "플랫폼 배포 형태로 변경 (PR #14, AI 수정안)", "방금", dur(ONB_END[4])]],
    res: [
      ["서비스", SAMPLE.services.join(", "), "Deployment " + SAMPLE.services.length + "개, 이미지는 ECR"],
      ["PostgreSQL", SAMPLE.db, "CloudNativePG, " + ENV[env].name],
      ["파일 저장소", SAMPLE.bucket, ENV[env].storage + ", 파일 " + fmt(SAMPLE.files) + "개"],
      ["기존 AWS", "shop-app-1, shop-db, shop-files", "EC2·RDS·S3, 읽기 전용 보존"],
    ],
  };
  S.appOrder.unshift(SAMPLE.id);
  S.act.unshift(["방금", SAMPLE.id + " 가져오기 완료 (PR #14 머지, " + ENV[env].name + "에 배포)"]);
  if (S.mig.phase === "idle" || S.mig.phase === "done") S.mig = freshMig(env);
}
function startOnb(S: SimState): void {
  const o = S.onb;
  o.t = 0;
  o.li = 0;
  o.log = [];
  o.run = true;
  feed(o, onbLog(S), 0);
}
function onbLog(S: SimState): LogEntry[] {
  return S.onb.step === 4 ? onbFinishLog(S.onb.env) : ONB_LOG[S.onb.step as 2 | 3];
}
function skipOnboard(S: SimState): void {
  const o = S.onb;
  o.step = 4;
  o.run = false;
  o.approved = true;
  o.done = { 2: true, 3: true, 4: true };
  o.log = onbFinishLog(o.env).map((l) => [mmss(l[0]), l[1]]);
  o.li = o.log.length;
  finishOnboard(S);
}

/* ---------- migration (derived values) ---------- */

export const MIG_LABEL: Record<Exclude<MigPhase, "idle">, string> = {
  plan: "AI 계획 중",
  rehearse: "리허설 중",
  approve: "승인 대기",
  prep: "복사 중",
  switch: "전환 중",
  cleanup: "정리 중",
  done: "이전 완료",
};

export function migActive(S: SimState): boolean {
  return S.mig.phase !== "idle" && S.mig.phase !== "done";
}
/** The engine is running against production (load is flowing through the migration). */
export function migExec(S: SimState): boolean {
  const p = S.mig.phase;
  return p === "prep" || p === "switch" || p === "cleanup";
}
export function migLabel(S: SimState): string {
  return S.mig.phase === "idle" ? "" : MIG_LABEL[S.mig.phase];
}
export function routeLabel(s: EnvKey, t: EnvKey): string {
  return ENV[s].name + " → " + ENV[t].name;
}

/** Share of traffic still going to the source environment, in %. */
export function oldShare(S: SimState): number {
  const m = S.mig;
  if (m.phase === "switch") return m.t >= SW_FLIP - 1e-9 ? 0 : 100;
  return m.phase === "cleanup" || m.phase === "done" ? 0 : 100;
}
/** Has the target started accepting writes? After this, failures halt instead of rolling back. */
export function pastPointOfNoReturn(S: SimState): boolean {
  const m = S.mig;
  return (m.phase === "switch" && m.flipped) || m.phase === "cleanup" || m.phase === "done";
}
function lagN(): number {
  return Math.round(RATE * 0.4);
}
/** Writes replicated to the target DB. */
export function rep(S: SimState): number {
  const m = S.mig;
  switch (m.phase) {
    case "prep":
      if (m.t < 20) return 0;
      if (m.t < 50) return Math.round((m.ok * (m.t - 20)) / 30);
      return Math.max(0, m.ok - lagN());
    case "switch":
      if (m.t >= SW_CATCHUP) return m.ok;
      if (m.t < SW_HOLD_START) return m.ok - lagN();
      return m.ok - Math.round((lagN() * (SW_CATCHUP - m.t)) / 3.3);
    case "cleanup":
    case "done":
      return m.ok;
    default:
      return 0;
  }
}
export function lagText(S: SimState): string {
  const m = S.mig;
  switch (m.phase) {
    case "prep":
      if (m.t < 20) return "시작 전";
      if (m.t < 50) return "초기 복사 중";
      return (0.4 + ((Math.floor(m.t) % 3) - 1) * 0.1).toFixed(1) + "초";
    case "switch":
      return m.t >= SW_CATCHUP ? "0초" : "0.4초";
    case "cleanup":
    case "done":
      return "새 DB가 기준";
    default:
      return "시작 전";
  }
}
export function filesTotal(S: SimState): number {
  return Math.floor(S.mig.files + 1e-9);
}
export function filesCopied(S: SimState): number {
  const m = S.mig;
  const tot = filesTotal(S);
  if (m.phase === "prep") {
    if (m.t < 15) return 0;
    if (m.t < 70) return Math.min(tot, Math.floor((SAMPLE.files * (m.t - 15)) / 55));
    return tot - (Math.floor(m.t) % 5 === 0 ? 1 : 0);
  }
  return migExec(S) || m.phase === "done" ? tot : 0;
}
/** Seconds writes have been held at the gateway. */
export function holdT(S: SimState): number {
  const m = S.mig;
  if (m.phase === "switch") return m.t < SW_HOLD_START ? 0 : Math.min(SW_FLIP - SW_HOLD_START, m.t - SW_HOLD_START);
  return m.flipped ? SW_FLIP - SW_HOLD_START : 0;
}
/** Engine time so far: prep + switch + cleanup. */
export function execT(S: SimState): number {
  return S.mig.tPrep + S.mig.tSw + S.mig.tCl;
}

function startPhase(m: MigState, phase: MigPhase): void {
  m.phase = phase;
  m.t = 0;
  m.li = 0;
}
function startAi(m: MigState, phase: "plan" | "rehearse"): void {
  m.phase = phase;
  m.ai.t = 0;
  m.ai.li = 0;
  if (phase === "plan") m.ai.log = [];
  feed(m.ai, phase === "plan" ? planLog(m.src, m.tgt) : rehLog(m.src, m.tgt), 0, phase === "plan" ? 0 : PLAN_END);
}
function finishMigration(S: SimState): void {
  const m = S.mig;
  const shop = S.apps[SAMPLE.id];
  if (!shop) return;
  const tg = ENV[m.tgt];
  const total = PREP_END + SW_END + CL_END;
  S.results[routeKey(m.src, m.tgt)] = {
    total, sw: SW_END, hold: SW_FLIP - SW_HOLD_START, failed: 0, ok: Math.round(m.ok), lostRows: 0, lostFiles: 0, when: "방금",
  };
  shop.prev = m.src;
  shop.loc = m.tgt;
  shop.res = [
    shop.res[0],
    ["PostgreSQL", SAMPLE.db, "CloudNativePG, " + tg.name],
    ["파일 저장소", SAMPLE.bucket, tg.storage + ", 파일 " + fmt(filesTotal(S)) + "개"],
    ["원본 (" + ENV[m.src].name + ")", SAMPLE.db + ", " + SAMPLE.bucket, "읽기 전용 보존, 삭제는 운영자 승인 후"],
  ];
  shop.deploys.unshift(["b7e21c4", "이전: " + routeLabel(m.src, m.tgt), "방금", dur(total)]);
  S.act.unshift(["방금", SAMPLE.id + " 이전 완료 (" + routeLabel(m.src, m.tgt) + ", " + dur(total) + ", 실패 0건, 누락 0건)"]);
}

/* ---------- overview helpers ---------- */

export function appsIn(S: SimState, k: EnvKey): number {
  let n = 0;
  for (const id of S.appOrder) {
    const a = S.apps[id];
    if (a.kind === "platform" && a.envs?.includes(k)) n++;
    if (a.kind === "service" && a.loc === k) n++;
  }
  return n;
}

/** Work in progress, as [label, href]. */
export function running(S: SimState): [string, string][] {
  const l: [string, string][] = [];
  if (S.dep.phase === "run") l.push([S.dep.repo + " 배포 중", "#new"]);
  if (S.onb.run) l.push(["기존 앱 가져오기: " + ["", "", "AI 점검 중", "샌드박스 테스트 중", "머지와 배포 중"][S.onb.step], "#onboard"]);
  else if (S.onb.step === 4 && !S.onb.approved) l.push(["기존 앱 가져오기: PR 승인 대기", "#onboard"]);
  if (migActive(S)) l.push([SAMPLE.id + " 이전 (" + routeLabel(S.mig.src, S.mig.tgt) + "): " + migLabel(S), "#migrate-shop"]);
  return l;
}

/* ---------- time ---------- */

export function tick(S: SimState): void {
  const d = S.dep;
  const o = S.onb;
  const m = S.mig;
  if (o.run) {
    const step = o.step as 2 | 3 | 4;
    o.t += 1;
    feed(o, onbLog(S), o.t);
    if (o.t >= ONB_END[step]) {
      o.run = false;
      o.done[step] = true;
      if (step === 4) finishOnboard(S);
    }
  }
  if (d.phase === "run") {
    d.t += 1;
    feed(d, depLog(S), d.t);
    if (d.t >= depEnd(S)) {
      d.phase = "done";
      finishDeploy(S);
    }
  }
  if (migExec(S)) {
    // k6: successful writes keep arriving; during the hold they queue at the gateway.
    const dt = m.phase === "switch" ? 0.2 : 1;
    const holding = m.phase === "switch" && m.t >= SW_HOLD_START - 1e-9 && m.t < SW_FLIP - 1e-9;
    if (holding) m.held += RATE * dt;
    else {
      m.ok += RATE * dt;
      m.files += FILE_RATE * dt;
    }
  }
  switch (m.phase) {
    case "plan":
      m.ai.t += 1;
      feed(m.ai, planLog(m.src, m.tgt), m.ai.t);
      if (m.ai.t >= PLAN_END) startAi(m, "rehearse");
      break;
    case "rehearse":
      m.ai.t += 1;
      feed(m.ai, rehLog(m.src, m.tgt), m.ai.t, PLAN_END);
      if (m.ai.t >= REH_END) m.phase = "approve";
      break;
    case "prep":
      m.t += 1;
      m.tPrep = Math.min(m.t, PREP_END);
      feed(m, prepLog(m.src, m.tgt), m.t);
      if (m.t >= PREP_END) {
        startPhase(m, "switch");
        m.held = 0;
        m.flipped = false;
        feed(m, SW_LOG, 0, PREP_END);
      }
      break;
    case "switch":
      m.t = Math.round((m.t + 0.2) * 10) / 10;
      m.tSw = Math.min(m.t, SW_END);
      feed(m, SW_LOG, m.t, PREP_END);
      if (m.t >= SW_FLIP - 1e-9 && !m.flipped) {
        m.flipped = true;
        m.ok += m.held;
        m.heldDone = m.held;
        m.held = 0;
      }
      if (m.t >= SW_END - 1e-9) {
        startPhase(m, "cleanup");
        feed(m, CL_LOG, 0, PREP_END + SW_END);
      }
      break;
    case "cleanup":
      m.t += 1;
      m.tCl = Math.min(m.t, CL_END);
      feed(m, CL_LOG, m.t, PREP_END + SW_END);
      if (m.t >= CL_END) {
        m.phase = "done";
        finishMigration(S);
      }
      break;
  }
}

/* ---------- actions ---------- */

export type Action =
  | { type: "dep-start" }
  | { type: "dep-again" }
  | { type: "dep-repo"; repo: string }
  | { type: "dep-env"; env: EnvKey; on: boolean }
  | { type: "onb-start" }
  | { type: "onb-sbx" }
  | { type: "onb-pr" }
  | { type: "onb-approve" }
  | { type: "onb-skip" }
  | { type: "onb-env"; env: EnvKey }
  | { type: "mig-target"; env: EnvKey }
  | { type: "mig-plan" }
  | { type: "mig-approve" }
  | { type: "mig-reject" }
  | { type: "mig-del" }
  | { type: "mig-new" };

export function apply(S: SimState, a: Action): void {
  const m = S.mig;
  switch (a.type) {
    case "dep-start": {
      const d = S.dep;
      d.phase = "run";
      d.t = 0;
      d.li = 0;
      d.log = [];
      feed(d, depLog(S), 0);
      break;
    }
    case "dep-again":
      S.dep = { phase: "form", repo: firstFreeRepo(S), envs: { aws: true, gcp: true, onprem: true }, t: 0, log: [], li: 0 };
      break;
    case "dep-repo":
      S.dep.repo = a.repo;
      break;
    case "dep-env":
      S.dep.envs[a.env] = a.on;
      break;
    case "onb-start":
      S.onb.step = 2;
      startOnb(S);
      break;
    case "onb-sbx":
      S.onb.step = 3;
      startOnb(S);
      break;
    case "onb-pr":
      S.onb.step = 4;
      S.onb.run = false;
      S.onb.log = [];
      S.onb.li = 0;
      break;
    case "onb-approve":
      S.onb.approved = true;
      startOnb(S);
      break;
    case "onb-skip":
      skipOnboard(S);
      break;
    case "onb-env":
      S.onb.env = a.env;
      break;
    case "mig-target":
      if (a.env !== m.src) m.tgt = a.env;
      break;
    case "mig-plan":
      if (!S.apps[SAMPLE.id]) break;
      startAi(m, "plan");
      break;
    case "mig-approve":
      if (m.phase !== "approve") break;
      startPhase(m, "prep");
      m.log = [];
      m.ok = 0;
      m.files = SAMPLE.files;
      m.tPrep = 0;
      m.tSw = 0;
      m.tCl = 0;
      m.heldDone = 0;
      m.flipped = false;
      feed(m, prepLog(m.src, m.tgt), 0);
      S.act.unshift(["방금", "운영자가 Plan 승인 (" + routeLabel(m.src, m.tgt) + ")"]);
      break;
    case "mig-reject":
      if (m.phase !== "approve") break;
      S.act.unshift(["방금", "운영자가 Plan 반려 (" + routeLabel(m.src, m.tgt) + ")"]);
      S.mig = freshMig(m.src);
      S.mig.tgt = m.tgt;
      break;
    case "mig-del":
      m.del = true;
      break;
    case "mig-new":
      S.mig = freshMig(S.apps[SAMPLE.id]?.loc ?? "aws");
      break;
  }
}
