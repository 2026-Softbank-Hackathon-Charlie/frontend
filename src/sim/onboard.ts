// Demo onboarding (ADR 0042): the sample app moimroom running with docker compose on an EC2 VM is brought onto a
// cluster through the same states, fields and events as GET /v1/onboardings/{id}. Time advances in onbTick, one
// simulated second per tick; the states that wait for a person (awaiting_approval, the DNS record in syncing,
// ready, decommissioning) stop until the page's button dispatches the action.
// MOCK: VM, 커밋, 다이제스트, 수치는 시뮬레이션 값이다. 실제 값은 일반 모드에서 플랫폼이 준다.
import type { Onboarding, OnboardingEvent, OnboardingLegacyChangeKind, OnboardingPlannedChange, OnboardingRequest, OnboardingState } from "../api/types";
import { ENV, SAMPLE, type EnvKey } from "./data";

export interface OnbSim {
  /** Something advances on its own right now (false while it waits for a person, and before the start). */
  run: boolean;
  /** The target cluster picked on the start form. */
  env: EnvKey;
  /** The onboarding as the API would show it; undefined before the start. */
  doc?: Onboarding;
  events: OnboardingEvent[];
  /** Simulated seconds in the current state. */
  t: number;
}

/** The states in order, as the console names them; failed is shown at the state it failed in. */
export const ONB_STATES: OnboardingState[] = ["discovering", "patching", "checking", "awaiting_approval", "connecting", "registering", "syncing", "ready", "cutting_over", "decommissioning", "done"];
export const ONB_STATE_LABEL: Record<OnboardingState, string> = {
  discovering: "조사",
  patching: "계약 PR",
  checking: "시험",
  awaiting_approval: "승인",
  connecting: "원본 연결",
  registering: "등록",
  syncing: "동기화",
  ready: "전환 준비",
  cutting_over: "전환",
  decommissioning: "정리",
  done: "완료",
  failed: "실패",
};

export const DEMO_ONB_ID = "onb-3f9a1c2b7d4e";
export const DEMO_REPO = SAMPLE.repo;
export const DEMO_URL = "https://" + SAMPLE.domain;
const HEAD = "9d2b71f3c0a4e5b6d7f8091a2b3c4d5e6f708192";
const PR_HEAD = "c07e4b8a1d2e3f405162738495a6b7c8d9e0f1a2";
const LAST_DEPLOY = "5be0c31d9a8f7e6d5c4b3a291807f6e5d4c3b2a1";
const RUN_ID = "run_onb3f9a1c2b7d4e1";
const INSTANCE = "i-0abc1234def567890";

export function freshOnb(env: EnvKey = "aws"): OnbSim {
  return { run: false, env, events: [], t: 0 };
}

/** Seconds each automatic state takes before the next one. */
const DUR: Partial<Record<OnboardingState, number>> = { discovering: 10, patching: 12, checking: 14, connecting: 12, registering: 8, cutting_over: 14 };

const PLANNED: OnboardingPlannedChange[] = [
  { kind: "workflow_disabled", target: ".github/workflows/deploy.yml", detail: "GitHub Actions workflow 끄기 (정리할 때까지)" },
  { kind: "instance_tagged", target: INSTANCE, detail: "hopcharlie-onboarding=" + DEMO_ONB_ID },
  { kind: "replication_role_created", target: "hopcharlie_replicator", detail: "CREATE ROLE hopcharlie_replicator WITH REPLICATION LOGIN" },
  { kind: "hba_line_added", target: "pg_hba.conf", detail: "host replication hopcharlie_replicator 172.18.0.0/16 scram-sha-256" },
  { kind: "wal_keep_size_added", target: "postgresql.auto.conf", detail: "wal_keep_size = '1GB'" },
  { kind: "tailscale_volume_created", target: "moimroom_tailscale-state", detail: "docker volume" },
  { kind: "tailscale_container_started", target: "hopcharlie-tailscale", detail: "tailscale/tailscale:v1.90.6@sha256:4f1c9a0e7b2d" },
  { kind: "tailscale_device_joined", target: "legacy-moimroom", detail: "tailnet 장치" },
  { kind: "db_route_created", target: "db-legacy-moimroom", detail: "관리 클러스터 Service, 5432" },
];

const now = () => new Date().toISOString();

function emit(o: OnbSim, kind: OnboardingEvent["kind"], message: string, data?: Record<string, unknown>): void {
  const d = o.doc!;
  o.events.push({ seq: o.events.length + 1, onboardingId: d.id, time: now(), state: d.state, kind, message, ...(data ? { data } : {}) });
}

function enter(o: OnbSim, state: OnboardingState, message: string): void {
  const d = o.doc!;
  d.state = state;
  d.updatedAt = now();
  o.t = 0;
  o.run = DUR[state] !== undefined || state === "syncing" || state === "decommissioning";
  emit(o, "state", message);
}

export function onbStart(o: OnbSim, req: OnboardingRequest): void {
  const at = now();
  const app = req.serviceUrl.replace(/^https:\/\//, "").split(".")[0];
  o.events = [];
  o.doc = {
    id: DEMO_ONB_ID,
    repo: req.repo,
    serviceUrl: req.serviceUrl,
    app,
    targetEnv: req.targetEnv ?? "",
    state: "discovering",
    deleting: false,
    legacyDeployStopped: false,
    humanActions: [{ kind: "install_github_app", url: "https://github.com/apps/hopcharlie-platform/installations/new", done: true }],
    report: { blockers: [], warnings: [] },
    legacyChanges: [],
    createdBy: "admin",
    createdAt: at,
    updatedAt: at,
  };
  enter(o, "discovering", "조사 시작: GitHub, DNS, 클라우드, VM, DB를 읽기만 합니다");
}

/** Steps of the automatic states, at their second. */
const STEPS: Partial<Record<OnboardingState, [number, string][]>> = {
  discovering: [
    [1, "GitHub: " + DEMO_REPO + " 기본 브랜치 main, head 9d2b71f"],
    [2, "GitHub App이 레포를 읽을 수 있음"],
    [3, "DNS: " + SAMPLE.domain + " A 203.0.113.10"],
    [4, "AWS ap-northeast-2: " + INSTANCE + " (SSM 관리)"],
    [6, "compose 프로젝트 moimroom: moimroom-web-1, moimroom-db-1"],
    [7, "DB 컨테이너 postgres:17.11-alpine (musl), moimroom 2.1 GiB"],
    [8, "버킷 moimroom-legacy-files: 파일 1,284개"],
    [9, "실행 중인 이미지 리비전 9d2b71f, 마지막 배포 5be0c31"],
  ],
  patching: [
    [1, "hopai: 계약 브랜치 hopcharlie/onboard 만드는 중"],
    [4, "hopai: platform.yaml 추가 (서비스 web, 포트 8080, /healthz)"],
    [7, "hopai: DATABASE_URL, S3_ENDPOINT를 환경 변수로 읽게 변경"],
  ],
  checking: [
    [1, "임시 앱 " + DEMO_ONB_ID + " 배포 시작"],
    [5, "이미지 빌드 완료"],
    [10, "임시 배포 Ready, 앱 시작 14.2초"],
  ],
  connecting: [],
  registering: [
    [1, "PR #12 머지"],
    [3, "앱 등록: DB는 원본의 replica, 서비스 0개"],
    [5, "게이트웨이 백엔드 legacy 등록"],
    [7, "Cluster streaming, Argo synced"],
  ],
  cutting_over: [
    [1, "사전 확인: 원본 쓰기 가능, 대상 streaming, 지연 0.3초"],
    [3, "쓰기 보류 시작"],
    [5, "원본 fence (default_transaction_read_only on)"],
    [7, "대상 승격"],
    [9, "인덱스 다시 만들기: app.members_name_idx"],
    [11, "게이트웨이가 모든 요청을 대상으로 보냄, 보류 해제 (보류 6.8초)"],
    [13, "검증 통과"],
  ],
};

export function onbTick(o: OnbSim): void {
  const d = o.doc;
  if (!o.run || !d || d.deleting) return;
  o.t += 1;
  for (const [at, msg] of STEPS[d.state] ?? []) if (at === o.t) emit(o, "step", msg);
  switch (d.state) {
    case "discovering":
      if (o.t === 9) {
        d.targetEnv = d.targetEnv || ENV[o.env].id;
        d.facts = {
          cloud: "aws",
          region: "ap-northeast-2",
          instanceId: INSTANCE,
          publicIp: "203.0.113.10",
          ssmManaged: true,
          defaultBranch: "main",
          head: HEAD,
          deployWorkflows: [".github/workflows/deploy.yml"],
          composeProject: "moimroom",
          containers: ["moimroom-web-1", "moimroom-db-1"],
          dbImage: "postgres:17.11-alpine",
          dbServerVersionNum: 170011,
          dbLibc: "musl",
          dbDatabase: "moimroom",
          dbOwner: "moimroom",
          dbSizeBytes: 2254857830,
          image: "ghcr.io/cloudnative-pg/postgresql:17.11-standard-trixie@sha256:8e2d4c1b0a9f",
          storageSize: "5Gi",
          reindex: ["app.members_name_idx"],
          bucket: "moimroom-legacy-files",
          objectCount: 1284,
        };
        d.report = {
          blockers: [],
          warnings: [
            { code: "drift_last_deploy", message: "running image revision differs from the newest deploy run", subject: "deploy.yml" },
            { code: "glibc_release_mismatch", message: "source is musl, target image is glibc", subject: "moimroom-db-1" },
            { code: "reindex_required", message: "text index depends on collation", subject: "app.members_name_idx" },
          ],
          drift: { head: HEAD, runningRevision: HEAD, lastDeployCommit: LAST_DEPLOY },
          holdSeconds: 18,
          holdBudgetSeconds: 40,
        };
        d.updatedAt = now();
      }
      if (o.t >= DUR.discovering!) enter(o, "patching", "차단 사유 없음, 경고 3개. 계약 PR을 만듭니다");
      break;
    case "patching":
      if (o.t >= DUR.patching!) {
        d.pr = { number: 12, url: "https://github.com/" + d.repo + "/pull/12", headSha: PR_HEAD, merged: false };
        emit(o, "step", "PR #12 열림: moimroom을 플랫폼 계약에 맞춤");
        enter(o, "checking", "PR 브랜치를 임시 앱으로 시험합니다");
        d.check = { app: DEMO_ONB_ID, result: "running", attempts: 1 };
      }
      break;
    case "checking":
      if (o.t >= DUR.checking!) {
        d.check = { app: DEMO_ONB_ID, deploymentId: "dep_onb1", result: "passed", attempts: 1, startSeconds: 14.2, message: "healthy, 임시 앱 삭제" };
        d.plannedLegacyChanges = PLANNED.map((c) => ({ ...c }));
        enter(o, "awaiting_approval", "시험 통과. 운영자 승인을 기다립니다");
      }
      break;
    case "connecting": {
      // One planned change every second, in order; the deploy workflow goes first.
      const i = o.t - 1;
      const c = d.plannedLegacyChanges?.[i];
      if (c) {
        d.legacyChanges.push({ kind: c.kind, target: c.target, at: now() });
        if (c.kind === "workflow_disabled") d.legacyDeployStopped = true;
        emit(o, "step", CHANGE_DONE[c.kind] + ": " + c.target);
      }
      if (o.t >= DUR.connecting!) enter(o, "registering", "관리 클러스터에서 원본 DB에 replication 연결됨");
      break;
    }
    case "registering":
      if (o.t === 1 && d.pr) d.pr.merged = true;
      if (o.t >= DUR.registering!) {
        enter(o, "syncing", "DB streaming과 파일 복사가 따라오는지 봅니다");
        d.humanActions.push({ kind: "delete_dns_record", record: { name: SAMPLE.domain, type: "A", value: "203.0.113.10" }, done: false });
        emit(o, "human", "DNS에서 " + SAMPLE.domain + " A 203.0.113.10 레코드를 지워야 와일드카드가 게이트웨이로 보냅니다");
      }
      break;
    case "syncing": {
      const dns = d.humanActions.find((h) => h.kind === "delete_dns_record");
      if (o.t % 2 === 0) {
        const copied = Math.min(1284, 400 + o.t * 90);
        emit(o, "step", "동기화 확인", { lagSeconds: Math.max(0.3, 3.2 - o.t * 0.4), filesCopied: copied, filesPending: 1284 - copied, dnsToGateway: !!dns?.done });
      }
      if (dns?.done && o.t >= 12) enter(o, "ready", "복제 지연, 파일 차이, DNS 모두 기준 안. 전환할 수 있습니다");
      break;
    }
    case "cutting_over":
      if (o.t >= DUR.cutting_over!) enter(o, "decommissioning", "전환 성공. legacy 백엔드를 빼고 tailnet 장치를 지웁니다");
      break;
    case "decommissioning":
      if (o.t === 2) emit(o, "step", "게이트웨이에서 legacy 백엔드 제거");
      if (o.t === 4) {
        emit(o, "step", "tailnet 장치 legacy-moimroom과 경로 db-legacy-moimroom 제거");
        emit(o, "human", "원본 인스턴스 " + INSTANCE + " 중지를 확인해 주세요");
        o.run = false;
      }
      break;
  }
}

const CHANGE_DONE: Record<OnboardingLegacyChangeKind, string> = {
  workflow_disabled: "배포 workflow 끔",
  instance_tagged: "인스턴스 태그",
  postgres_role_created: "postgres role 생성",
  replication_role_created: "복제 계정 생성",
  tailscale_volume_created: "Tailscale 상태 볼륨 생성",
  tailscale_container_started: "Tailscale 컨테이너 시작",
  tailscale_device_joined: "tailnet 장치 참가",
  hba_line_added: "pg_hba 줄 추가",
  wal_keep_size_added: "wal_keep_size 추가",
  db_route_created: "DB 경로 생성",
};

/** What a button asks for; "stale" when the approval's head is not the PR's, "refused" when the state does not allow it. */
export type OnbResult = "ok" | "stale" | "refused";

export function onbApprove(o: OnbSim, headSha: string): OnbResult {
  const d = o.doc;
  if (!d || d.state !== "awaiting_approval" || !d.pr) return "refused";
  if (headSha !== d.pr.headSha) return "stale";
  d.approvedBy = "admin";
  d.approvedAt = now();
  d.approvedSha = headSha;
  enter(o, "connecting", "승인됨 (" + headSha.slice(0, 7) + "). 원본 배포 workflow를 끄고 원본 DB를 준비합니다");
  return "ok";
}

/** "다시 확인": in the demo the person has just done what was asked. */
export function onbResume(o: OnbSim): OnbResult {
  const d = o.doc;
  const open = d?.humanActions.filter((h) => !h.done) ?? [];
  if (!d || open.length === 0) return "refused";
  for (const h of open) h.done = true;
  emit(o, "step", "다시 확인: " + SAMPLE.domain + "이(가) 게이트웨이를 가리킴");
  d.updatedAt = now();
  return "ok";
}

export function onbCutover(o: OnbSim): OnbResult {
  const d = o.doc;
  if (!d || d.state !== "ready") return "refused";
  d.runId = RUN_ID;
  enter(o, "cutting_over", "전환 run " + RUN_ID + " 시작 (Plan " + d.id + "-1)");
  return "ok";
}

export function onbDecommission(o: OnbSim): OnbResult {
  const d = o.doc;
  if (!d || d.state !== "decommissioning" || o.run) return "refused";
  emit(o, "step", "원본 인스턴스 " + INSTANCE + " 중지 (디스크와 버킷은 남김)");
  d.humanActions = d.humanActions.map((h) => ({ ...h, done: true }));
  enter(o, "done", "가져오기 완료. 앱 상세에서 환경을 더할 수 있습니다");
  return "ok";
}

/** The demo deletes at once (the platform answers 202 and undoes in the background). */
export function onbDelete(o: OnbSim): OnbResult {
  const d = o.doc;
  if (!d || !deletable(d)) return "refused";
  Object.assign(o, freshOnb(o.env), { doc: undefined });
  return "ok";
}

const LATE: OnboardingState[] = ["cutting_over", "decommissioning", "done"];
/** DELETE is refused from cutting_over on, and for failed in those states. */
export function deletable(d: Onboarding): boolean {
  return !LATE.includes(d.state) && !(d.state === "failed" && d.failedState && LATE.includes(d.failedState));
}

/** Jump to done (the "skip" button of the demo): the app is registered so the migration demo can go on. */
export function onbSkip(o: OnbSim): void {
  if (!o.doc) onbStart(o, { repo: DEMO_REPO, serviceUrl: DEMO_URL, targetEnv: ENV[o.env].id });
  for (let i = 0; i < 400 && o.doc!.state !== "done"; i++) {
    const s = o.doc!.state;
    if (s === "awaiting_approval") onbApprove(o, o.doc!.pr!.headSha);
    else if (s === "syncing" && o.doc!.humanActions.some((h) => !h.done)) onbResume(o);
    else if (s === "ready") onbCutover(o);
    else if (s === "decommissioning" && !o.run) onbDecommission(o);
    else onbTick(o);
  }
}
