// Demo simulation state machine. Time advances in tick() (called every 100ms);
// deploy and onboarding advance 1 simulated second per tick, migration prep and
// cleanup 1s per tick, switchover 0.2s per tick (the banner says it's faster than real).
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
  PREP_END,
  RATE,
  REPOS,
  SW_CATCHUP,
  SW_END,
  SW_FLIP,
  SW_HOLD_START,
  SW_LOG,
  prepLog,
  type EnvKey,
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
  kind: "platform" | "legacy";
  envs?: EnvKey[];
  loc?: "legacy" | EnvKey;
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
  sbx: EnvKey;
  done: Record<2 | 3 | 4, boolean>;
  approved: boolean;
}

export type MigPhase = "idle" | "prep" | "ready" | "confirm" | "switch" | "switched" | "cleanup" | "done";

export interface MigState extends Feed {
  phase: MigPhase;
  target: EnvKey;
  auto: boolean;
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

export interface SimState {
  apps: Record<string, App>;
  appOrder: string[];
  /** [when, message] */
  act: [string, string][];
  dep: DepState;
  onb: OnbState;
  mig: MigState;
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
          ["c1d88f0", "첫 배포", "3일 전", "3분 12초"],
        ],
        res: [["PostgreSQL", "todo-api-db", "환경마다 1개 (CloudNativePG)"]],
      },
    },
    appOrder: ["todo-api"],
    act: [
      ["12분 전", "todo-api 배포 완료 (3개 환경, 2분 41초)"],
      ["어제", "todo-api 배포 완료 (3개 환경, 1분 58초)"],
      ["3일 전", "온프레미스 k3s 환경 등록"],
    ],
    dep: { phase: "form", repo: "notice-board", envs: { aws: true, gcp: true, onprem: true }, t: 0, log: [], li: 0 },
    onb: { step: 1, run: false, t: 0, log: [], li: 0, sbx: "gcp", done: { 2: false, 3: false, 4: false }, approved: false },
    mig: {
      phase: "idle", target: "gcp", auto: false, t: 0, tPrep: 0, tSw: 0, tCl: 0, ok: 0, held: 0, heldDone: 0,
      flipped: false, files: 1284, log: [], li: 0, del: false,
    },
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
  if (S.apps.shop) return;
  S.apps.shop = {
    id: "shop",
    repo: "team-charlie/shop",
    kind: "legacy",
    loc: "legacy",
    deploys: [["9d2b71f", "플랫폼 배포 형태로 변경 (PR #14, AI)", "방금", "1분 12초 (빌드만)"]],
    res: [
      ["PostgreSQL", "shop-db", "기존 RDS (플랫폼 밖)"],
      ["파일 저장소", "shop-files", "기존 S3 버킷 (플랫폼 밖, 파일 1,284개)"],
    ],
  };
  S.appOrder.push("shop");
  S.act.unshift(["방금", "shop 가져오기 완료 (PR #14 머지, 사용자 요청은 기존 AWS에서 처리 중)"]);
}
function startOnb(S: SimState): void {
  const o = S.onb;
  o.t = 0;
  o.li = 0;
  o.log = [];
  o.run = true;
  feed(o, ONB_LOG[o.step as 2 | 3 | 4], 0);
}
function skipOnboard(S: SimState): void {
  const o = S.onb;
  o.step = 4;
  o.run = false;
  o.approved = true;
  o.done = { 2: true, 3: true, 4: true };
  o.log = ONB_LOG[4].map((l) => [mmss(l[0]), l[1]]);
  o.li = ONB_LOG[4].length;
  finishOnboard(S);
}

/* ---------- migration (derived values) ---------- */

export const MIG_LABEL: Record<Exclude<MigPhase, "idle">, string> = {
  prep: "준비 중",
  ready: "전환 대기",
  confirm: "전환 대기",
  switch: "전환 중",
  switched: "정리 대기",
  cleanup: "정리 중",
  done: "이전 완료",
};

export function migActive(S: SimState): boolean {
  return S.mig.phase !== "idle" && S.mig.phase !== "done";
}
export function migLabel(S: SimState): string {
  return S.mig.phase === "idle" ? "" : MIG_LABEL[S.mig.phase];
}

/** Share of traffic still going to the old environment, in %. */
export function oldShare(S: SimState): number {
  const m = S.mig;
  if (m.phase === "switch") return m.t >= SW_FLIP - 1e-9 ? 0 : 100;
  return m.phase === "switched" || m.phase === "cleanup" || m.phase === "done" ? 0 : 100;
}
function lagN(): number {
  return Math.round(RATE * 0.4);
}
/** Orders replicated to the new DB. */
export function rep(S: SimState): number {
  const m = S.mig;
  switch (m.phase) {
    case "idle":
      return 0;
    case "prep":
      if (m.t < 70) return 0;
      if (m.t < 110) return Math.round((m.ok * (m.t - 70)) / 40);
      return Math.max(0, m.ok - lagN());
    case "ready":
    case "confirm":
      return m.ok - lagN();
    case "switch":
      if (m.t >= SW_CATCHUP) return m.ok;
      if (m.t < SW_HOLD_START) return m.ok - lagN();
      return m.ok - Math.round((lagN() * (SW_CATCHUP - m.t)) / 3.3);
    default:
      return m.ok;
  }
}
export function lagText(S: SimState): string {
  const m = S.mig;
  switch (m.phase) {
    case "idle":
      return "시작 전";
    case "prep":
      if (m.t < 52) return "시작 전";
      if (m.t < 110) return "초기 복사 중";
      return (0.4 + ((Math.floor(m.t) % 3) - 1) * 0.1).toFixed(1) + "초";
    case "ready":
    case "confirm":
      return "0.4초";
    case "switch":
      return m.t >= SW_CATCHUP ? "0초" : "0.4초";
    default:
      return "새 DB가 기준";
  }
}
export function filesTotal(S: SimState): number {
  return Math.floor(S.mig.files + 1e-9);
}
export function filesCopied(S: SimState): number {
  const m = S.mig;
  const tot = filesTotal(S);
  if (m.phase === "idle") return 0;
  if (m.phase === "prep") {
    if (m.t < 40) return 0;
    if (m.t < 118) return Math.min(tot, Math.floor((1284 * (m.t - 40)) / 78));
    return tot - (Math.floor(m.t) % 5 === 0 ? 1 : 0);
  }
  return tot;
}
/** Seconds writes have been held at the gateway. */
export function holdT(S: SimState): number {
  const m = S.mig;
  if (m.phase === "switch") return m.t < SW_HOLD_START ? 0 : Math.min(5.6, m.t - SW_HOLD_START);
  return m.flipped ? 5.6 : 0;
}
function startSwitch(S: SimState): void {
  const m = S.mig;
  m.phase = "switch";
  m.t = 0;
  m.li = 0;
  m.flipped = false;
  m.held = 0;
  feed(m, SW_LOG, 0, PREP_END);
}

/* ---------- overview helpers ---------- */

export function appsIn(S: SimState, k: EnvKey): number {
  let n = 0;
  for (const id of S.appOrder) {
    const a = S.apps[id];
    if (a.kind === "platform" && a.envs?.includes(k)) n++;
    if (a.kind === "legacy" && a.loc === k) n++;
  }
  return n;
}

/** Work in progress, as [label, href]. */
export function running(S: SimState): [string, string][] {
  const l: [string, string][] = [];
  if (S.dep.phase === "run") l.push([S.dep.repo + " 배포 중", "#new"]);
  if (S.onb.run) l.push(["기존 앱 가져오기: " + ["", "", "AI 점검 중", "샌드박스 테스트 중", "머지와 빌드 중"][S.onb.step], "#onboard"]);
  else if (S.onb.step === 4 && !S.onb.approved) l.push(["기존 앱 가져오기: PR 승인 대기", "#onboard"]);
  if (migActive(S)) l.push(["shop 이전: " + migLabel(S), "#migrate-shop"]);
  return l;
}

/* ---------- time ---------- */

export function tick(S: SimState): void {
  const d = S.dep;
  const o = S.onb;
  const m = S.mig;
  if (d.phase === "run") {
    d.t += 1;
    feed(d, depLog(S), d.t);
    if (d.t >= depEnd(S)) {
      d.phase = "done";
      finishDeploy(S);
    }
  }
  if (o.run) {
    const step = o.step as 2 | 3 | 4;
    o.t += 1;
    feed(o, ONB_LOG[step], o.t);
    if (o.t >= ONB_END[step]) {
      o.run = false;
      o.done[step] = true;
      if (step === 4) finishOnboard(S);
    }
  }
  if (migActive(S)) {
    // Load generator: successful orders keep arriving; during the hold they queue at the gateway.
    const dt = m.phase === "switch" ? 0.2 : 1;
    const holding = m.phase === "switch" && m.t >= SW_HOLD_START - 1e-9 && m.t < SW_FLIP - 1e-9;
    if (holding) m.held += RATE * dt;
    else {
      m.ok += RATE * dt;
      m.files += FILE_RATE * dt;
    }
  }
  if (m.phase === "prep") {
    m.t += 1;
    m.tPrep = Math.min(m.t, PREP_END);
    feed(m, prepLog(m.target), m.t, 0);
    if (m.t >= PREP_END) {
      if (m.auto) startSwitch(S);
      else m.phase = "ready";
    }
  } else if (m.phase === "switch") {
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
      m.phase = "switched";
      S.apps.shop.loc = m.target;
      S.act.unshift(["방금", "shop 전환 완료 (" + ENV[m.target].name + ", 13.6초, 실패 0건)"]);
    }
  } else if (m.phase === "cleanup") {
    m.t += 1;
    m.tCl = Math.min(m.t, CL_END);
    feed(m, CL_LOG, m.t, PREP_END + SW_END);
    if (m.t >= CL_END) {
      m.phase = "done";
      const tg = ENV[m.target];
      S.apps.shop.res = [
        ["PostgreSQL", "shop-db", "CloudNativePG, " + tg.name],
        ["파일 저장소", "shop-files", tg.storage + ", 파일 " + fmt(filesTotal(S)) + "개"],
        ["기존 RDS, S3", "shop-db, shop-files", "접근 차단됨, 삭제는 운영자 확인 후"],
      ];
      S.apps.shop.deploys.unshift(["9d2b71f", "이전 완료: 기존 AWS(EC2)에서 " + tg.name + "로", "방금", "3분 52초"]);
      S.act.unshift(["방금", "shop 이전 완료 (전체 3분 52초, 누락 0건)"]);
    }
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
  | { type: "onb-sbx-env"; env: EnvKey }
  | { type: "mig-target"; env: EnvKey }
  | { type: "mig-auto"; on: boolean }
  | { type: "mig-start" }
  | { type: "mig-switch" }
  | { type: "mig-cancel" }
  | { type: "mig-go" }
  | { type: "mig-clean" }
  | { type: "mig-del" };

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
    case "onb-sbx-env":
      S.onb.sbx = a.env;
      break;
    case "mig-target":
      m.target = a.env;
      break;
    case "mig-auto":
      m.auto = a.on;
      break;
    case "mig-start":
      m.phase = "prep";
      m.t = 0;
      m.li = 0;
      m.log = [];
      m.ok = 0;
      m.files = 1284;
      m.tPrep = 0;
      m.tSw = 0;
      m.tCl = 0;
      m.heldDone = 0;
      m.flipped = false;
      feed(m, prepLog(m.target), 0, 0);
      break;
    case "mig-switch":
      m.phase = "confirm";
      break;
    case "mig-cancel":
      m.phase = "ready";
      break;
    case "mig-go":
      startSwitch(S);
      break;
    case "mig-clean":
      m.phase = "cleanup";
      m.t = 0;
      m.li = 0;
      feed(m, CL_LOG, 0, PREP_END + SW_END);
      break;
    case "mig-del":
      m.del = true;
      break;
  }
}
