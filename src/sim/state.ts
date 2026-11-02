// Demo simulation state machine. Time advances in tick() (called every 100ms);
// deploy, onboarding, AI plan and rehearsal advance 1 simulated second per tick.
// The migration itself lives in mig.ts and produces the same shapes as the platform API.
import { DEP_LOG, DEP_READY, ENV, ENV_ORDER, ONB_END, ONB_LOG, REPOS, SAMPLE, onbFinishLog, type EnvKey, type LogEntry, type OnbStep } from "./data";
import { dur, fmt, mmss } from "./format";
import * as mig from "./mig";
import type { Run } from "../api/types";

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

export interface SimState {
  apps: Record<string, App>;
  appOrder: string[];
  /** [when, message] */
  act: [string, string][];
  dep: DepState;
  onb: OnbState;
  mig: mig.MigSim;
  /** last message for the migration page (e.g. a stale approval) */
  migNotice: string;
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
    mig: mig.freshMig("aws"),
    migNotice: "",
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
  if (!migActive(S)) S.mig = mig.freshMig(env, S.mig);
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

/** Something is in progress on the migration page (AI work, waiting for approval, or a live run). */
export function migActive(S: SimState): boolean {
  const m = S.mig;
  if (m.stage === "ai" || m.stage === "review") return true;
  return m.stage === "run" && !!m.run && (m.run.status === "running" || m.run.status === "awaiting_switch");
}
export function migLabel(S: SimState): string {
  const m = S.mig;
  if (m.stage === "ai") return m.aiT < mig.AI_PLAN_END ? "AI 계획 중" : "리허설 중";
  if (m.stage === "review") return "승인 대기";
  if (m.stage === "run" && m.run) return mig.statusText(m.run.status, m.run.phase);
  return "";
}
export function routeLabel(s: EnvKey, t: EnvKey): string {
  return ENV[s].name + " → " + ENV[t].name;
}

function finishMigration(S: SimState, r: Run): void {
  const m = S.mig;
  const shop = S.apps[SAMPLE.id];
  if (!shop) return;
  const tg = ENV[m.tgt];
  const total = (r.result.durationMillis ?? 0) / 1000;
  shop.prev = m.src;
  shop.loc = m.tgt;
  shop.res = [
    shop.res[0],
    ["PostgreSQL", SAMPLE.db, "CloudNativePG, " + tg.name],
    ["파일 저장소", SAMPLE.bucket, tg.storage + ", 파일 " + fmt(SAMPLE.files) + "개"],
    ["원본 (" + ENV[m.src].name + ")", SAMPLE.db + ", " + SAMPLE.bucket, "읽기 전용 보존"],
  ];
  const what = r.rollbackOf ? "롤백" : "이전";
  shop.deploys.unshift([r.runId, what + ": " + routeLabel(m.src, m.tgt), "방금", dur(total)]);
  S.act.unshift(["방금", SAMPLE.id + " " + what + " 완료 (" + routeLabel(m.src, m.tgt) + ", " + dur(total) + ", 실패 0건, 누락 0건)"]);
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
  const ended = mig.migTick(S.mig);
  if (ended) finishMigration(S, ended);
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
  | { type: "mig-approve"; revision: number }
  | { type: "mig-reject"; comment?: string }
  | { type: "mig-switch" }
  | { type: "mig-abort" }
  | { type: "mig-resume" }
  | { type: "mig-rollback" }
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
      if (a.env !== m.src && m.stage === "setup") m.tgt = a.env;
      break;
    case "mig-plan":
      if (!S.apps[SAMPLE.id] || m.stage !== "setup") break;
      S.migNotice = "";
      mig.startAi(m);
      break;
    case "mig-approve": {
      const r = mig.approve(m, a.revision);
      if (r === "stale") {
        S.migNotice = "보고 있던 Plan(revision " + a.revision + ")이 그사이 바뀌었습니다. 다시 확인하고 승인하세요.";
        break;
      }
      if (r !== "ok") break;
      S.migNotice = "";
      mig.start(m);
      S.act.unshift(["방금", "운영자가 Plan " + m.plan!.ref + " 승인, 이전 시작 (" + routeLabel(m.src, m.tgt) + ")"]);
      break;
    }
    case "mig-reject":
      if (!m.plan) break;
      mig.reject(m, a.comment);
      S.act.unshift(["방금", "운영자가 Plan " + m.plan.ref + " 반려 (" + routeLabel(m.src, m.tgt) + ")"]);
      S.mig = mig.freshMig(m.src, m);
      S.mig.tgt = m.tgt;
      break;
    case "mig-switch":
      mig.doSwitch(m);
      break;
    case "mig-abort":
      mig.abort(m);
      break;
    case "mig-resume":
      mig.resume(m);
      break;
    case "mig-rollback":
      mig.rollback(m);
      S.act.unshift(["방금", SAMPLE.id + " 롤백 시작 (" + routeLabel(m.src, m.tgt) + ")"]);
      break;
    case "mig-new":
      S.mig = mig.freshMig(S.apps[SAMPLE.id]?.loc ?? "aws", m);
      S.migNotice = "";
      break;
  }
}
