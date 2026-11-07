// Demo simulation state machine. Time advances in tick() (called every 100ms);
// deploy, onboarding, AI plan and rehearsal advance 1 simulated second per tick.
// The migration lives in mig.ts and the GitHub deploys in deploy.ts; both produce the same shapes as the platform API.
import { ENV, ONB_END, ONB_LOG, SAMPLE, onbFinishLog, sampleBucketName, type EnvKey, type LogEntry, type OnbStep } from "./data";
import * as dep from "./deploy";
import { dur, fmt, mmss } from "./format";
import * as mig from "./mig";
import * as sec from "./secrets";
import type { AppCreateRequest, AppSecretsUpdate, Run } from "../api/types";

/** [mm:ss, message] */
export type LogLine = [string, string];
/** [commit, message, when, duration] */
export type DeployRow = [string, string, string, string];
/** [kind, name, detail] */
export type ResRow = [string, string, string];

/** An app with one live copy behind the gateway that can be migrated (PLATFORM_APPS_FILE in the platform). */
export interface App {
  id: string;
  repo: string;
  loc: EnvKey;
  prev?: EnvKey;
  deploys: DeployRow[];
  res: ResRow[];
}

interface Feed {
  t: number;
  log: LogLine[];
  li: number;
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
  /** apps registered from GitHub and their deployments */
  deploy: dep.DeploySim;
  onb: OnbState;
  mig: mig.MigSim;
  /** last message for the migration page (e.g. a stale approval) */
  migNotice: string;
}

export function fresh(): SimState {
  return {
    apps: {},
    appOrder: [],
    act: [
      ["12분 전", "todo-api 배포 완료 (3개 환경, 2분 41초)"],
      ["어제", "Tailscale로 클러스터 3개 연결"],
      ["어제", "온프레미스 k3s 환경 등록"],
    ],
    deploy: dep.freshDeploy(),
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

/* ---------- onboarding ---------- */

// The onboarding draft imports shop from EC2 (3장 7번 결정 전 시안); the migration continues with the team's
// sample app, so what came from the draft says so instead of reading as moimroom's own history.
function finishOnboard(S: SimState): void {
  if (S.apps[SAMPLE.id]) return;
  const env = S.onb.env;
  S.apps[SAMPLE.id] = {
    id: SAMPLE.id,
    repo: SAMPLE.repo,
    loc: env,
    deploys: [["9d2b71f", "가져오기 시안(shop): 플랫폼 배포 형태로 변경 (PR #14, AI 수정안)", "방금", dur(ONB_END[4])]],
    res: [
      ["서비스", SAMPLE.services.join(", "), "Deployment " + SAMPLE.services.length + "개, 레플리카 " + SAMPLE.replicas + "개, 이미지는 ECR"],
      ["PostgreSQL", SAMPLE.db, "CloudNativePG, " + ENV[env].name],
      ["파일 저장소", sampleBucketName(env), ENV[env].storage + ", 파일 " + fmt(SAMPLE.files) + "개"],
      ["가져오기 시안 (shop)", "shop-app-1, shop-db, shop-files", "기존 EC2·RDS·S3, 읽기 전용 보존"],
    ],
  };
  S.appOrder.unshift(SAMPLE.id);
  S.act.unshift(["방금", "가져오기 시안(shop) 완료, 샘플 앱 " + SAMPLE.id + " 배포 (" + ENV[env].name + ")"]);
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
  const app = S.apps[SAMPLE.id];
  if (!app) return;
  const tg = ENV[m.tgt];
  const total = (r.result.durationMillis ?? 0) / 1000;
  app.prev = m.src;
  app.loc = m.tgt;
  app.res = [
    app.res[0],
    ["PostgreSQL", SAMPLE.db, "CloudNativePG, " + tg.name],
    ["파일 저장소", sampleBucketName(m.tgt), tg.storage + ", 파일 " + fmt(SAMPLE.files) + "개"],
    ["원본 (" + ENV[m.src].name + ")", SAMPLE.db + ", " + sampleBucketName(m.src), "읽기 전용 보존"],
  ];
  const what = r.rollbackOf ? "롤백" : "이전";
  app.deploys.unshift([r.runId, what + ": " + routeLabel(m.src, m.tgt), "방금", dur(total)]);
  S.act.unshift(["방금", SAMPLE.id + " " + what + " 완료 (" + routeLabel(m.src, m.tgt) + ", " + dur(total) + ", 실패 0건, 누락 0건)"]);
}

/* ---------- overview helpers ---------- */

export function appsIn(S: SimState, k: EnvKey): number {
  let n = 0;
  for (const id of S.appOrder) if (S.apps[id].loc === k) n++;
  for (const a of S.deploy.apps) if (a.deploy?.environments.includes(ENV[k].id)) n++;
  return n;
}

/** Work in progress, as [label, href]. */
export function running(S: SimState): [string, string][] {
  const l: [string, string][] = [];
  for (const d of dep.activeDeployments(S.deploy)) l.push([d.instance + " 배포 중", "#deploy-" + d.id]);
  if (S.onb.run) l.push(["기존 앱 가져오기: " + ["", "", "AI 점검 중", "샌드박스 테스트 중", "머지와 배포 중"][S.onb.step], "#onboard"]);
  else if (S.onb.step === 4 && !S.onb.approved) l.push(["기존 앱 가져오기: PR 승인 대기", "#onboard"]);
  if (migActive(S)) l.push([SAMPLE.id + " 이전 (" + routeLabel(S.mig.src, S.mig.tgt) + "): " + migLabel(S), "#migrate-app"]);
  return l;
}

/* ---------- time ---------- */

export function tick(S: SimState): void {
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
  for (const line of dep.deployTick(S.deploy)) S.act.unshift(["방금", line]);
  const ended = mig.migTick(S.mig);
  if (ended) finishMigration(S, ended);
}

/* ---------- actions ---------- */

export type Action =
  | { type: "app-create"; req: AppCreateRequest }
  | { type: "app-redeploy"; name: string; branch?: string }
  | { type: "app-redeploy-nobuild"; name: string; branch: string }
  | { type: "secrets-update"; name: string; body: AppSecretsUpdate }
  | { type: "app-delete"; name: string }
  | { type: "instance-create"; name: string; branch: string; autoDeploy: boolean }
  | { type: "instance-delete"; name: string; instance: string }
  | { type: "env-add"; name: string; env: string }
  | { type: "env-remove"; name: string; env: string }
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
    case "app-create":
      dep.createApp(S.deploy, a.req);
      break;
    case "app-redeploy":
      dep.redeploy(S.deploy, a.name, a.branch);
      break;
    case "app-redeploy-nobuild":
      dep.redeployNoBuild(S.deploy, a.name, a.branch);
      break;
    case "secrets-update":
      sec.updateSecrets(S.deploy, a.name, a.body);
      break;
    case "app-delete": {
      const dirs = (S.deploy.apps.find((x) => x.name === a.name)?.deploy?.instances ?? []).map((i) => "apps/" + i.name + "/").join(", ");
      if (dep.deleteApp(S.deploy, a.name)) S.act.unshift(["방금", a.name + " 삭제 (gitops에서 " + dirs + " 제거)"]);
      break;
    }
    case "instance-create":
      if (dep.addInstance(S.deploy, a.name, a.branch, a.autoDeploy)) S.act.unshift(["방금", a.name + "에 " + a.branch + " 브랜치 추가 (인스턴스 " + dep.instanceName(a.name, a.branch) + ")"]);
      break;
    case "env-add":
      dep.addEnvironment(S.deploy, a.name, a.env);
      break;
    case "env-remove":
      dep.removeEnvironment(S.deploy, a.name, a.env);
      break;
    case "instance-delete":
      if (dep.removeInstance(S.deploy, a.name, a.instance)) S.act.unshift(["방금", a.instance + " 삭제 (gitops에서 apps/" + a.instance + "/ 제거)"]);
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
