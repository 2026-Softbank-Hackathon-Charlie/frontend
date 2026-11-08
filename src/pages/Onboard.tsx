// "기존 앱 가져오기": onboarding an app that runs with docker compose on one VM (platform ADR 0042).
// Live mode follows GET /v1/onboardings/{id}/events; demo mode shows the same screens over sim/onboard.ts.
import "../styles/onboard.css";
import { useState, type ReactNode } from "react";
import { ApiError, approveOnboarding, cutOverOnboarding, decommissionOnboarding, deleteOnboarding, resumeOnboarding, startOnboarding } from "../api/client";
import { useEnvironments, useOnboarding, useOnboardings, useRun } from "../api/hooks";
import type {
  Onboarding,
  OnboardingEvent,
  OnboardingFindingCode,
  OnboardingFinding,
  OnboardingLegacyChangeKind,
  OnboardingRequest,
  OnboardingState,
} from "../api/types";
import { Icon } from "../components/Icon";
import { Chip, LoadError, LogBox, PageHead, Skeleton, Table, td, type ChipKind } from "../components/ui";
import { errorText, useLive } from "../data/live";
import { navigate } from "../router";
import { ENV, ENV_ORDER, type EnvKey } from "../sim/data";
import { statusText } from "../sim/mig";
import { DEMO_REPO, DEMO_URL, deletable, ONB_STATE_LABEL, ONB_STATES } from "../sim/onboard";
import type { LogLine } from "../sim/state";
import { useSim } from "../sim/store";

/** The domain every app answers under; the service URL's label is the app's name. */
export const APP_DOMAIN = "hopcharlie.dev";
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const URL_RE = new RegExp("^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?)\\." + APP_DOMAIN.replace(/\./g, "\\.") + "/?$");

/** What the form says about the repo field; empty when it is fine. */
export function repoProblem(repo: string): string {
  const v = repo.trim().replace(/\.git$/, "");
  if (!v) return "owner/name 형식으로 적으세요";
  if (v.startsWith("https://") || v.startsWith("git@")) return "주소가 아니라 owner/name만 적으세요 (예: " + DEMO_REPO + ")";
  return REPO_RE.test(v) ? "" : "owner/name 형식이 아닙니다";
}
/** The app name a service URL gives, or the problem with it. */
export function urlCheck(url: string): { app?: string; problem: string } {
  const v = url.trim();
  if (!v) return { problem: "https://<앱 이름>." + APP_DOMAIN + " 형식으로 적으세요" };
  if (v.startsWith("http://")) return { problem: "https 주소만 가져올 수 있습니다" };
  const m = URL_RE.exec(v.toLowerCase());
  if (!m) return { problem: "https://<앱 이름>." + APP_DOMAIN + " 형식이어야 합니다. 경로나 다른 도메인은 쓸 수 없습니다" };
  return { app: m[1], problem: "" };
}

/* ---------- texts ---------- */

export const FINDING_TEXT: Record<OnboardingFindingCode, string> = {
  instance_not_found: "서비스 주소가 가리키는 VM 인스턴스를 찾지 못했습니다",
  gcp_inspection_not_yet: "GCP VM 조사는 아직 지원하지 않습니다",
  vm_not_ssm_managed: "VM이 SSM으로 관리되지 않아 안을 읽을 수 없습니다",
  vm_in_autoscaling_group: "VM이 Auto Scaling 그룹에 속해 있습니다 (VM 한 대만 가져올 수 있습니다)",
  vm_is_eks_node: "VM이 EKS 노드입니다",
  no_compose_project: "VM에서 docker compose 프로젝트를 찾지 못했습니다",
  db_not_postgres_container: "DB가 PostgreSQL 컨테이너가 아닙니다",
  managed_database: "관리형 DB(RDS, Cloud SQL)를 씁니다. 이 흐름은 VM 안의 PostgreSQL 컨테이너만 옮깁니다",
  storage_out_of_scope: "파일 저장소가 가져올 수 있는 범위 밖입니다",
  data_volume_out_of_scope: "DB 말고도 데이터가 담긴 볼륨이 있습니다",
  domain_out_of_scope: "서비스 주소가 플랫폼 앱 도메인 밖입니다",
  not_https: "서비스 주소가 https가 아닙니다",
  image_unavailable: "원본 PostgreSQL 버전에 맞는 CNPG 이미지가 없습니다",
  icu_version_unavailable: "원본과 같은 ICU 버전의 이미지가 없습니다",
  collation_dependent_constraint: "정렬 규칙에 기대는 제약이 있어 물리 복제 뒤 깨질 수 있습니다",
  auto_conf_settings: "postgresql.auto.conf에 옮길 수 없는 설정이 있습니다",
  role_read_only_setting: "role에 default_transaction_read_only 설정이 있습니다",
  wal_keep_size_command_line: "wal_keep_size가 명령줄로 정해져 있어 바꿀 수 없습니다",
  no_superuser: "DB superuser로 접속할 수 없습니다",
  disk_too_small: "VM 디스크 여유가 부족합니다 (WAL 보존에 필요)",
  hold_budget_exceeded: "예상 쓰기 보류 시간이 보류 예산을 넘습니다",
  app_code_change_required: "앱 코드를 사람이 고쳐야 합니다",
  check_failed: "PR 브랜치 시험 배포가 실패했습니다",
  alter_system_disabled: "allow_alter_system이 꺼져 있어 원본을 읽기 전용으로 바꿀 수 없습니다",
  wal_level_minimal: "wal_level이 minimal이라 복제할 수 없습니다",
  max_wal_senders_zero: "max_wal_senders가 0이라 복제할 수 없습니다",
  password_encryption_md5: "password_encryption이 md5입니다 (복제 계정은 scram-sha-256이 필요합니다)",
  name_too_long: "앱 이름이 길어 만들 리소스 이름이 63자를 넘습니다",
  drift_running_revision: "실행 중인 이미지가 기본 브랜치 head와 다릅니다",
  drift_last_deploy: "마지막 배포 커밋이 기본 브랜치 head와 다릅니다",
  glibc_release_mismatch: "원본과 대상 이미지의 C 라이브러리(glibc, musl)가 달라 일부 인덱스를 다시 만들어야 합니다",
  reindex_required: "전환 뒤 다시 만들 인덱스가 있습니다",
  app_account_superuser: "앱이 DB superuser 계정으로 접속합니다",
  legacy_deploy_stopped: "원본 배포 workflow가 꺼져 있습니다",
  db_unreadable: "DB 컨테이너에서 psql로 데이터베이스를 읽지 못했습니다",
  pending_config: "재시작을 기다리는 설정이나 설정 파일 오류가 있습니다. 원본 연결의 reload가 그 설정까지 적용하거나 실패합니다",
  config_not_writable: "pg_hba.conf나 postgresql.conf를 고칠 수 없습니다 (읽기 전용)",
  collation_other_database: "다른 데이터베이스에 정렬 규칙에 기대는 인덱스가 있어 전환 뒤 다시 만들 수 없습니다",
  vm_image_pull_failed: "VM이 플랫폼이 고정한 openssl 이미지를 받지 못했습니다",
};

const CHANGE_TEXT: Record<OnboardingLegacyChangeKind, string> = {
  workflow_disabled: "배포 workflow 끄기",
  instance_tagged: "인스턴스 태그",
  postgres_role_created: "postgres role 만들기",
  replication_role_created: "복제 계정 만들기",
  tailscale_volume_created: "Tailscale 상태 볼륨",
  tailscale_container_started: "Tailscale 컨테이너",
  tailscale_device_joined: "tailnet 장치",
  hba_line_added: "pg_hba 줄 추가",
  wal_keep_size_added: "wal_keep_size 줄 추가",
  db_route_created: "관리 클러스터 DB 경로",
};

const STATE_KIND: Record<OnboardingState, ChipKind> = {
  discovering: "run",
  patching: "run",
  checking: "run",
  awaiting_approval: "warn",
  connecting: "run",
  registering: "run",
  syncing: "run",
  ready: "warn",
  cutting_over: "run",
  decommissioning: "warn",
  done: "ok",
  failed: "bad",
};

const short = (sha?: string) => (sha ? sha.slice(0, 7) : "");
const hms = (t: string) => new Date(t).toLocaleTimeString("ko-KR", { hour12: false });
const secs = (n: number) => (Math.round(n * 10) / 10).toLocaleString("ko-KR") + "초";
const stateOf = (o: Onboarding) => (o.state === "failed" ? (o.failedState ?? "discovering") : o.state);

/** The deploy workflows connecting turned off: from the facts, else from what it did. */
const stoppedWorkflows = (o: Onboarding) => o.facts?.deployWorkflows ?? o.legacyChanges.filter((c) => c.kind === "workflow_disabled").map((c) => c.target);

function StateChip({ o }: { o: Onboarding }) {
  if (o.deleting) return <Chip kind="run">삭제 중</Chip>;
  if (o.state === "failed") return <Chip kind="bad">{"실패 (" + ONB_STATE_LABEL[stateOf(o)] + ")"}</Chip>;
  return <Chip kind={STATE_KIND[o.state]}>{ONB_STATE_LABEL[o.state]}</Chip>;
}

/** A short Korean message for an onboarding API error. */
export function onbErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "not_implemented":
        return "이 서버에는 기존 앱 가져오기 실행기가 설정되어 있지 않습니다 (501). 데모 모드에서 흐름을 볼 수 있습니다";
      case "app_exists":
        return "그 이름의 앱이 이미 등록되어 있습니다";
      case "onboarding_exists":
        return "이 앱에 끝나지 않은 가져오기가 있습니다. 그 가져오기를 이어서 하거나 삭제하세요";
      case "env_not_found":
        return "대상 환경이 없습니다";
      case "github_not_configured":
        return "서버에 GitHub App이 설정되어 있지 않습니다";
      case "secrets_not_configured":
        return "서버에 비밀값 암호화 키가 설정되어 있지 않습니다";
      case "pr_head_mismatch":
        return "PR이 그사이 바뀌었습니다. 플랫폼이 브랜치를 다시 만들고 시험부터 다시 합니다. 새 결과를 확인하고 다시 승인하세요";
      case "onboarding_deleting":
        return "삭제하는 중이라 할 수 없습니다";
      case "onboarding_state_conflict":
        return "상태가 그사이 바뀌었습니다. 화면을 새 상태로 다시 확인하세요";
      case "cluster_busy":
        return "다른 이전이 진행 중입니다. 끝난 뒤 다시 전환하세요";
      case "github_unreachable":
        return "GitHub에 닿지 않습니다. 잠시 뒤 다시 승인하세요";
    }
    if (e.status === 404 && e.code === "not_found") return "서버에서 기존 앱 가져오기가 꺼져 있습니다 (PLATFORM_ONBOARDING)";
  }
  return errorText(e);
}

/* ---------- page ---------- */

export function Onboard({ id }: { id?: string }) {
  const live = useLive();
  return (
    <div className="page onboard-page">
      <PageHead
        icon="download"
        title="기존 앱 가져오기"
        crumb={id ? <a href="#onboard">기존 앱 가져오기</a> : undefined}
        sub="플랫폼 밖에서 docker compose로 돌던 앱을 조사하고, 계약 PR과 DB 물리 복제로 무중단으로 클러스터에 가져옵니다. 원본 VM과 DB는 승인한 뒤에만 바꿉니다."
      />
      {live ? id ? <LiveDetail id={id} /> : <LiveList /> : <DemoOnboard />}
    </div>
  );
}

/* ---------- live ---------- */

function LiveList() {
  const list = useOnboardings(5000);
  const [open, setOpen] = useState(false);
  const off = list.error instanceof ApiError && (list.error.code === "not_implemented" || list.error.status === 404);
  const rows = list.data ?? [];
  return (
    <>
      <StartForm live onStarted={(o) => navigate("#onboard-" + o.id)} />
      <section className="box" aria-label="가져오기 목록">
        <div className="bh">
          <b>가져오기 목록</b>
          {list.data && <Chip>{rows.length + "개"}</Chip>}
        </div>
        {list.loading ? (
          <Skeleton rows={2} />
        ) : list.error && !list.data ? (
          off ? (
            <div className="bb">
              <p className="hint">{onbErrorText(list.error)}</p>
            </div>
          ) : (
            <LoadError title="가져오기 목록을 불러오지 못했습니다" error={onbErrorText(list.error)} retry={list.reload} />
          )
        ) : rows.length === 0 ? (
          <div className="bb">
            <p className="hint">아직 가져오기가 없습니다. 위에서 레포와 서비스 주소로 시작하세요.</p>
          </div>
        ) : (
          <Table
            head={["앱", "레포", "상태", "대상", "만든 때", ""]}
            rows={(open ? rows : rows.slice(0, 20)).map((o) => [
              td(<b>{o.app}</b>),
              td(o.repo, "m"),
              td(<StateChip o={o} />),
              td(o.targetEnv || "결정 전"),
              td(new Date(o.createdAt).toLocaleString("ko-KR")),
              td(<a href={"#onboard-" + o.id}>열기</a>),
            ])}
          />
        )}
        {rows.length > 20 && !open && (
          <div className="bb">
            <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
              모두 보기
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function LiveDetail({ id }: { id: string }) {
  const w = useOnboarding(id);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  if (w.gone)
    return (
      <div className="box fillbox" role="status">
        <div className="bb">
          <p>이 가져오기는 없습니다. 삭제가 끝났거나 잘못된 주소입니다.</p>
          <a className="btn ghost" href="#onboard">
            목록으로
          </a>
        </div>
      </div>
    );
  if (!w.onboarding) return w.error ? <LoadError title="가져오기를 불러오지 못했습니다" error={onbErrorText(w.error)} /> : <Skeleton rows={4} box />;
  const call = (what: string, f: () => Promise<Onboarding>, after?: (o: Onboarding) => void) => async () => {
    setBusy(what);
    setNotice("");
    try {
      const o = await f();
      w.replace(o);
      after?.(o);
    } catch (e) {
      setNotice(onbErrorText(e));
    } finally {
      setBusy("");
    }
  };
  const acts: Actions = {
    approve: (sha) => void call("approve", () => approveOnboarding(id, sha))(),
    resume: () => void call("resume", () => resumeOnboarding(id))(),
    cutover: () => void call("cutover", () => cutOverOnboarding(id))(),
    decommission: () => void call("decommission", () => decommissionOnboarding(id))(),
    remove: () => void call("delete", () => deleteOnboarding(id))(),
  };
  return <Detail o={w.onboarding} events={w.events} acts={acts} busy={busy} notice={notice} run={<LiveRun o={w.onboarding} />} />;
}

/** The cutover's migration run, from its own stream; the migration page has the whole run. */
function LiveRun({ o }: { o: Onboarding }) {
  const w = useRun(o.runId);
  const r = w.run;
  return (
    <>
      <dt>상태</dt>
      <dd>{r ? <Chip kind={r.status === "succeeded" ? "ok" : r.status === "running" ? "run" : "bad"}>{statusText(r.status, r.phase)}</Chip> : w.error ? onbErrorText(w.error) : "불러오는 중"}</dd>
    </>
  );
}

/* ---------- demo ---------- */

function DemoOnboard() {
  const { S, dispatch } = useSim();
  const o = S.onb;
  if (!o.doc)
    return (
      <>
        <p className="hint">데모의 가상 VM과 레포로 가져오기 흐름을 보여 줍니다. 자격 증명은 받지 않습니다.</p>
        <StartForm onStarted={() => {}} />
        <div className="actrow">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              dispatch({ type: "onb-skip" });
              navigate("#migrate-app");
            }}
          >
            가져오기 완료 상태로 건너뛰기
          </button>
        </div>
      </>
    );
  const acts: Actions = {
    approve: (headSha) => dispatch({ type: "onb-approve", headSha }),
    resume: () => dispatch({ type: "onb-resume" }),
    cutover: () => dispatch({ type: "onb-cutover" }),
    decommission: () => dispatch({ type: "onb-decommission" }),
    remove: () => dispatch({ type: "onb-delete" }),
  };
  return (
    <>
      <p className="hint">데모: 시뮬레이션입니다. 다시 확인을 누르면 DNS 레코드를 지운 것으로 봅니다.</p>
      <Detail o={o.doc} events={o.events} acts={acts} busy="" notice={S.onbNotice} demo />
    </>
  );
}

/* ---------- start form ---------- */

function StartForm({ live, onStarted }: { live?: boolean; onStarted: (o: Onboarding) => void }) {
  const { S, dispatch } = useSim();
  const [repo, setRepo] = useState(live ? "" : DEMO_REPO);
  const [url, setUrl] = useState(live ? "" : DEMO_URL);
  const [env, setEnv] = useState(live ? "" : ENV[S.onb.env].id);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const envs = useEnvironments(0, !!live);
  const rp = repoProblem(repo);
  const uc = urlCheck(url);
  const ok = !rp && !uc.problem;
  const submit = async () => {
    setTouched(true);
    if (!ok) return;
    const req: OnboardingRequest = { repo: repo.trim().replace(/\.git$/, ""), serviceUrl: url.trim().replace(/\/$/, "").toLowerCase(), ...(env ? { targetEnv: env } : {}) };
    if (!live) {
      const k = ENV_ORDER.find((x) => ENV[x].id === env);
      if (k) dispatch({ type: "onb-env", env: k as EnvKey });
      dispatch({ type: "onb-start", req });
      return;
    }
    setBusy(true);
    setError("");
    try {
      onStarted(await startOnboarding(req));
    } catch (e) {
      setError(onbErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const envOptions = live ? (envs.data ?? []).map((e) => e.name) : ENV_ORDER.map((k) => ENV[k].id);
  return (
    <section className="box" aria-label="가져오기 시작">
      <div className="bh">
        <b>새로 가져오기</b>
      </div>
      <div className="bb">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor="onb-repo">GitHub 레포</label>
            <input id="onb-repo" value={repo} placeholder={DEMO_REPO} spellCheck={false} autoComplete="off" onChange={(e) => setRepo(e.target.value)} />
            <small>{touched && rp ? rp : "owner/name. 플랫폼 GitHub App이 이 레포를 읽을 수 있어야 합니다"}</small>
          </div>
          <div className="field">
            <label htmlFor="onb-url">서비스 주소</label>
            <input id="onb-url" value={url} placeholder={"https://moimroom-legacy." + APP_DOMAIN} spellCheck={false} autoComplete="off" onChange={(e) => setUrl(e.target.value)} />
            <small>{touched && uc.problem ? uc.problem : uc.app ? "앱 이름: " + uc.app : "지금 앱이 답하는 주소, https://<앱 이름>." + APP_DOMAIN}</small>
          </div>
          <div className="field">
            <label htmlFor="onb-env">대상 환경 (선택)</label>
            <select id="onb-env" value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="">VM의 클라우드에 맞춰 (AWS는 eks, GCP는 gke)</option>
              {envOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="hint">
              {error}
            </p>
          )}
          <div className="actrow">
            <button type="submit" className="btn primary" disabled={busy}>
              <Icon name="play" size={16} />
              {busy ? "시작하는 중" : "조사 시작"}
            </button>
            <span className="hint">조사는 읽기만 합니다. 원본은 승인한 뒤에만 바꿉니다.</span>
          </div>
        </form>
      </div>
    </section>
  );
}

/* ---------- detail (both modes) ---------- */

interface Actions {
  approve(headSha: string): void;
  resume(): void;
  cutover(): void;
  decommission(): void;
  remove(): void;
}

function Detail({ o, events, acts, busy, notice, run, demo }: { o: Onboarding; events: OnboardingEvent[]; acts: Actions; busy: string; notice: string; run?: ReactNode; demo?: boolean }) {
  const st = stateOf(o);
  const at = ONB_STATES.indexOf(st);
  const waiting = o.humanActions.some((h) => !h.done);
  return (
    <>
      <section className="box" aria-label="가져오기 요약">
        <div className="bh">
          <b>{o.app}</b>
          <StateChip o={o} />
        </div>
        <div className="bb">
          <dl className="kv">
            <dt>레포</dt>
            <dd className="m">{o.repo}</dd>
            <dt>서비스 주소</dt>
            <dd className="m">{o.serviceUrl}</dd>
            <dt>대상 환경</dt>
            <dd>{o.targetEnv || "조사 뒤 결정"}</dd>
            <dt>가져오기 id</dt>
            <dd className="m">{o.id}</dd>
          </dl>
        </div>
      </section>
      {o.legacyDeployStopped && (
        <div className="box fillbox" role="status" aria-label="원본 배포 멈춤">
          <div className="bb">
            <b>원본 배포가 멈춰 있습니다.</b>
            <p>
              원본 레포의 배포 workflow({stoppedWorkflows(o).join(", ") || "배포 workflow"})를 껐습니다. 정리가 끝나거나 이 가져오기를 삭제할 때까지 원본 VM에는 다시 배포되지 않습니다.
            </p>
          </div>
        </div>
      )}
      {o.deleting && (
        <div className="box fillbox" role="status">
          <div className="bb">
            <b>삭제하는 중입니다.</b>
            <p>{o.failure ? "되돌리기 한 단계가 실패했습니다: " + o.failure + ". 삭제를 다시 누르면 이어서 합니다." : "원본에 더한 것을 거꾸로 되돌리고 있습니다. 끝나면 이 화면은 없어집니다."}</p>
          </div>
        </div>
      )}
      {o.state === "failed" && !o.deleting && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <b>{ONB_STATE_LABEL[st]} 단계에서 멈췄습니다.</b>
            <p>{o.failure || "이유를 아래 기록에서 확인하세요."}</p>
            {o.report.blockers.length === 0 && (
              <div className="actrow">
                <button type="button" className="btn" disabled={!!busy} onClick={acts.resume}>
                  <Icon name="refresh-cw" size={16} />
                  {busy === "resume" ? "다시 시도하는 중" : "다시 시도"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {notice && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <p>{notice}</p>
          </div>
        </div>
      )}

      <ol className="onboard-steps" aria-label="가져오기 단계">
        {ONB_STATES.map((s, i) => {
          const done = i < at || o.state === "done";
          const cur = !done && i === at;
          return (
            <li key={s} className={done ? "done" : cur ? "cur" : ""} aria-current={cur ? "step" : undefined}>
              <span className="step-number">{i + 1}</span>
              <span className="step-text">
                <b>{ONB_STATE_LABEL[s]}</b>
                <small>{done ? "완료" : cur ? (o.state === "failed" ? "실패" : "진행 중") : "대기"}</small>
              </span>
            </li>
          );
        })}
      </ol>

      {o.humanActions.length > 0 && <HumanActions o={o} busy={busy} waiting={waiting} onResume={acts.resume} />}
      {o.report.drift && <Drift o={o} />}
      <Findings o={o} />
      {o.facts && <Facts o={o} />}
      {(o.pr || o.check) && <PrAndCheck o={o} />}
      {o.state === "awaiting_approval" && !o.deleting && <Approval o={o} busy={busy} onApprove={acts.approve} />}
      {(st === "syncing" || (st === "ready" && o.state === "ready")) && <Syncing events={events} ready={o.state === "ready"} />}
      {o.state === "ready" && !o.deleting && (
        <div className="actrow">
          <button type="button" className="btn primary" disabled={!!busy} onClick={acts.cutover}>
            <Icon name="arrow-right-left" size={16} />
            {busy === "cutover" ? "시작하는 중" : "전환"}
          </button>
          <span className="hint">쓰기를 잠깐 보류하고 DB를 승격한 뒤 게이트웨이가 모든 요청을 클러스터로 보냅니다.</span>
        </div>
      )}
      {o.runId && (
        <section className="box" aria-label="전환 run">
          <div className="bh">
            <b>전환 run</b>
            {!demo && (
              <a href={"#migrate-app?app=" + encodeURIComponent(o.app)}>
                이전 화면에서 보기
              </a>
            )}
          </div>
          <div className="bb">
            <dl className="kv">
              <dt>run id</dt>
              <dd className="m">{o.runId}</dd>
              {run}
            </dl>
            <p className="hint">전환 run은 롤백 없이 진행합니다. 승격 뒤 멈추면 이전 화면에서 run을 이어서 합니다.</p>
          </div>
        </section>
      )}
      {o.state === "decommissioning" && !o.deleting && <Decommission o={o} busy={busy} onConfirm={acts.decommission} demo={demo} events={events} />}
      {o.legacyChanges.length > 0 && <LegacyChanges o={o} />}
      {o.state === "done" && (
        <div className="box okbox" role="status">
          <div className="bb">
            <b>{o.app}을(를) 가져왔습니다.</b>
            <p>원본 인스턴스는 중지했고 지우지 않았습니다. 디스크와 원본 버킷은 확인한 뒤 클라우드에서 지우세요. 다른 클러스터에도 띄우려면 앱 상세에서 환경을 더하세요.</p>
            <div className="actrow">
              <a className="btn primary" href={"#app-" + o.app}>
                {o.app} 보기
              </a>
              {demo && (
                <a className="btn ghost" href="#migrate-app">
                  이전하러 가기
                </a>
              )}
            </div>
          </div>
        </div>
      )}
      <section className="box" aria-label="가져오기 기록">
        <div className="bh">
          <b>기록</b>
        </div>
        <div className="bb">
          <LogBox lines={events.filter((e) => !isMetric(e)).map((e): LogLine => [hms(e.time), "[" + ONB_STATE_LABEL[e.state] + "] " + (e.kind === "error" ? "오류: " : "") + (e.message ?? e.kind)])} empty="첫 기록을 기다리는 중입니다." />
        </div>
      </section>
      {deletable(o) && <Delete o={o} busy={busy} onConfirm={acts.remove} />}
    </>
  );
}

function HumanActions({ o, busy, waiting, onResume }: { o: Onboarding; busy: string; waiting: boolean; onResume: () => void }) {
  return (
    <section className={"box" + (waiting ? " fillbox" : "")} aria-label="사람이 할 일">
      <div className="bh">
        <b>사람이 할 일</b>
        {waiting ? <Chip kind="warn">기다리는 중</Chip> : <Chip kind="ok">모두 끝남</Chip>}
      </div>
      <div className="bb">
        <ul className="prog">
          {o.humanActions.map((h, i) => (
            <li key={i}>
              <span className={"ind " + (h.done ? "ok" : "wait")} aria-hidden="true" />
              <div>
                {h.kind === "install_github_app" ? (
                  <>
                    <b>GitHub App 설치</b>
                    <small>
                      플랫폼 GitHub App이 {o.repo}를 읽을 수 있어야 합니다.{" "}
                      {h.url && (
                        <a href={h.url} target="_blank" rel="noreferrer">
                          GitHub App 설치하기
                        </a>
                      )}
                    </small>
                  </>
                ) : (
                  <>
                    <b>DNS 레코드 지우기</b>
                    <small>
                      도메인 관리 화면에서 아래 레코드를 지우면 와일드카드가 이 주소를 게이트웨이로 보냅니다. 플랫폼은 DNS 자격 증명을 갖지 않습니다.
                    </small>
                    {h.record && <code className="m">{h.record.name + " " + h.record.type + " " + h.record.value}</code>}
                  </>
                )}
              </div>
              <span className="t">{h.done ? "확인됨" : "확인 전"}</span>
            </li>
          ))}
        </ul>
        {waiting && (
          <div className="actrow">
            <button type="button" className="btn" disabled={!!busy || o.deleting} onClick={onResume}>
              <Icon name="refresh-cw" size={16} />
              {busy === "resume" ? "확인하는 중" : "다시 확인"}
            </button>
            <span className="hint">플랫폼도 주기적으로 확인합니다. 다시 확인은 지금 바로 확인합니다.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function Drift({ o }: { o: Onboarding }) {
  const d = o.report.drift!;
  const rows: [string, string | undefined][] = [
    ["기본 브랜치 head", d.head],
    ["실행 중인 이미지", d.runningRevision],
    ["마지막 배포", d.lastDeployCommit],
  ];
  return (
    <div className="box fillbox" role="status" aria-label="실행 중인 코드 차이">
      <div className="bb">
        <b>지금 도는 코드가 기본 브랜치와 다를 수 있습니다.</b>
        <p>계약 PR은 기본 브랜치 head를 기준으로 만듭니다. 승인 전에 차이를 확인하세요. 막지는 않습니다.</p>
        <dl className="kv sm">
          {rows
            .filter((r) => r[1])
            .map((r) => (
              <Pair key={r[0]} k={r[0]} v={<span className="m">{short(r[1]) + (r[1] !== d.head ? " (다름)" : "")}</span>} />
            ))}
        </dl>
      </div>
    </div>
  );
}

function Pair({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

const findingRow = (f: OnboardingFinding, kind: ChipKind, label: string) => [
  td(<Chip kind={kind}>{label}</Chip>),
  td(
    <>
      {FINDING_TEXT[f.code] ?? f.code}
      <small className="hint"> {f.message}</small>
    </>,
  ),
  td(f.subject ?? "", "m"),
];

function Findings({ o }: { o: Onboarding }) {
  const { blockers, warnings } = o.report;
  if (blockers.length + warnings.length === 0) return null;
  return (
    <section className={"box" + (blockers.length ? " badbox" : "")} aria-label="차단 사유와 경고">
      <div className="bh">
        <b>조사 결과</b>
        {blockers.length > 0 && <Chip kind="bad">{"차단 " + blockers.length + "개"}</Chip>}
        {warnings.length > 0 && <Chip kind="warn">{"경고 " + warnings.length + "개"}</Chip>}
      </div>
      <Table head={["", "내용", "대상"]} rows={[...blockers.map((f) => findingRow(f, "bad", "차단")), ...warnings.map((f) => findingRow(f, "warn", "경고"))]} />
    </section>
  );
}

function Facts({ o }: { o: Onboarding }) {
  const f = o.facts!;
  const gib = (b?: number) => (b === undefined ? undefined : (b / 1024 ** 3).toFixed(1) + " GiB");
  const rows: [string, ReactNode][] = [
    ["VM", [f.cloud?.toUpperCase(), f.region, f.instanceId, f.publicIp].filter(Boolean).join(", ")],
    ["SSM", f.ssmManaged === undefined ? undefined : f.ssmManaged ? "관리됨" : "관리 안 됨"],
    ["compose", f.composeProject && f.composeProject + (f.containers?.length ? " (" + f.containers.join(", ") + ")" : "")],
    ["원본 DB", [f.dbImage, f.dbLibc, f.dbDatabase && "DB " + f.dbDatabase, f.dbOwner && "소유자 " + f.dbOwner, gib(f.dbSizeBytes)].filter(Boolean).join(", ")],
    ["대상 DB 이미지", f.image && <span className="m">{f.image}</span>],
    ["대상 저장 용량", f.storageSize],
    ["다시 만들 인덱스", f.reindex?.length ? f.reindex.join(", ") : undefined],
    ["파일", f.bucket && f.bucket + (f.objectCount !== undefined ? ", 파일 " + f.objectCount.toLocaleString("ko-KR") + "개" : "")],
    ["기본 브랜치", f.defaultBranch && f.defaultBranch + (f.head ? " (" + short(f.head) + ")" : "")],
    ["배포 workflow", f.deployWorkflows?.length ? f.deployWorkflows.join(", ") : undefined],
  ];
  return (
    <section className="box" aria-label="조사한 사실">
      <div className="bh">
        <b>조사한 사실</b>
      </div>
      <div className="bb">
        <dl className="kv">
          {rows
            .filter((r) => r[1])
            .map((r) => (
              <Pair key={r[0]} k={r[0]} v={r[1]} />
            ))}
        </dl>
      </div>
    </section>
  );
}

function PrAndCheck({ o }: { o: Onboarding }) {
  const { pr, check } = o;
  const budget = o.report.holdBudgetSeconds;
  return (
    <section className="box" aria-label="계약 PR과 시험">
      <div className="bh">
        <b>계약 PR과 시험</b>
      </div>
      <div className="bb">
        <dl className="kv">
          {pr && (
            <>
              <dt>PR</dt>
              <dd>
                <a href={pr.url} target="_blank" rel="noreferrer">
                  {"PR #" + pr.number}
                </a>{" "}
                <a href={pr.url + "/files"} target="_blank" rel="noreferrer">
                  변경 보기
                </a>{" "}
                {pr.merged ? <Chip kind="ok">머지됨</Chip> : <Chip>머지 전</Chip>}
              </dd>
              <dt>PR head</dt>
              <dd className="m">{short(pr.headSha)}</dd>
            </>
          )}
          {check && (
            <>
              <dt>시험</dt>
              <dd>
                {check.result === "passed" ? <Chip kind="ok">통과</Chip> : check.result === "failed" ? <Chip kind="bad">실패</Chip> : <Chip kind="run">시험 중</Chip>}
                {" " + check.attempts + "회째 (최대 2회)"}
                {check.message ? ", " + check.message : ""}
              </dd>
              {check.startSeconds !== undefined && (
                <>
                  <dt>앱 시작 시간</dt>
                  <dd>
                    {secs(check.startSeconds)}
                    {budget !== undefined && (check.startSeconds <= budget ? " (보류 예산 " + secs(budget) + " 안)" : " (보류 예산 " + secs(budget) + " 넘음)")}
                  </dd>
                </>
              )}
            </>
          )}
          {o.report.holdSeconds !== undefined && (
            <>
              <dt>예상 쓰기 보류</dt>
              <dd>
                {secs(o.report.holdSeconds)}
                {budget !== undefined ? " / 예산 " + secs(budget) : ""}
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

function Approval({ o, busy, onApprove }: { o: Onboarding; busy: string; onApprove: (sha: string) => void }) {
  const planned = o.plannedLegacyChanges ?? [];
  const sha = o.pr?.headSha;
  return (
    <section className="box" aria-label="승인">
      <div className="bh">
        <b>승인하면 원본에 할 일</b>
        <Chip kind="warn">승인 대기</Chip>
      </div>
      {planned.length > 0 ? (
        <Table head={["순서", "할 일", "대상", "값"]} rows={planned.map((c, i) => [td(String(i + 1)), td(CHANGE_TEXT[c.kind] ?? c.kind), td(c.target, "m"), td(c.detail ?? "", "m")])} />
      ) : (
        <div className="bb">
          <p className="hint">원본에 더할 변경 목록이 아직 없습니다.</p>
        </div>
      )}
      <div className="bb">
        <p>
          승인하면 원본 레포의 배포 workflow를 끕니다. 정리가 끝날 때까지 원본 VM에는 배포되지 않습니다. 삭제하면 위 변경을 거꾸로 되돌리지만, 머지한 PR은 남습니다.
        </p>
        <p className="hint">Tailscale 컨테이너가 붙어 있는 동안에는 손으로 docker compose down을 해도 compose 네트워크가 지워지지 않습니다.</p>
        <div className="actrow">
          <button type="button" className="btn primary" disabled={!sha || !!busy} onClick={() => sha && onApprove(sha)}>
            <Icon name="check" size={16} />
            {busy === "approve" ? "승인하는 중" : "PR head " + short(sha) + "로 승인"}
          </button>
          <span className="hint">화면에 보이는 PR head로 승인합니다. 그사이 PR이 바뀌었으면 다시 시험합니다.</span>
        </div>
      </div>
    </section>
  );
}

const METRIC_LABEL: Record<string, [string, (v: unknown) => string]> = {
  lagSeconds: ["복제 지연", (v) => (typeof v === "number" ? secs(v) + " (기준 2초)" : String(v))],
  filesCopied: ["복사한 파일", (v) => (typeof v === "number" ? v.toLocaleString("ko-KR") + "개" : String(v))],
  filesPending: ["남은 파일", (v) => (typeof v === "number" ? v.toLocaleString("ko-KR") + "개" : String(v))],
  dnsToGateway: ["DNS", (v) => (v ? "게이트웨이를 가리킴" : "아직 VM을 가리킴")],
  streaming: ["DB 복제", (v) => (v ? "streaming" : "연결 전")],
};

/** A syncing check with its numbers (sent on every poll): shown as metrics, not as log lines. */
const isMetric = (e: OnboardingEvent) => e.state === "syncing" && e.kind === "step" && !!e.data && "lagSeconds" in e.data;

/** The newest step of syncing that carries numbers. The keys are what the platform's syncing step sends (internal/onboard/job, lagSeconds, filesCopied, filesPending, dnsToGateway, streaming). */
function Syncing({ events, ready }: { events: OnboardingEvent[]; ready: boolean }) {
  const last = [...events].reverse().find((e) => e.state === "syncing" && e.data && Object.keys(e.data).length > 0);
  return (
    <section className="box" aria-label="동기화">
      <div className="bh">
        <b>동기화</b>
        {ready ? <Chip kind="ok">기준 안</Chip> : <Chip kind="run">따라가는 중</Chip>}
      </div>
      {last?.data ? (
        <div className="metrics">
          {Object.entries(last.data).map(([k, v]) => {
            const m = METRIC_LABEL[k];
            return (
              <div className="metric" key={k}>
                <span>{m ? m[0] : k}</span>
                <strong>{m ? m[1](v) : String(v)}</strong>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bb">
          <p className="hint">복제 지연, 파일 차이, DNS를 확인하고 있습니다.</p>
        </div>
      )}
    </section>
  );
}

function Decommission({ o, busy, onConfirm, demo, events }: { o: Onboarding; busy: string; onConfirm: () => void; demo?: boolean; events: OnboardingEvent[] }) {
  const [asked, setAsked] = useState(false);
  // In the demo the button waits for the cleanup steps; live, the server answers 409 until they are done.
  const cleaning = demo && !events.some((e) => e.state === "decommissioning" && e.kind === "human");
  const inst = o.facts?.instanceId ?? "원본 인스턴스";
  return (
    <section className="box" aria-label="정리">
      <div className="bh">
        <b>정리</b>
        {cleaning ? <Chip kind="run">legacy 백엔드와 tailnet 장치 지우는 중</Chip> : <Chip kind="warn">확인 대기</Chip>}
      </div>
      <div className="bb">
        <p>전환이 끝났습니다. 원본 인스턴스 {inst}을(를) 중지합니다. 지우지는 않습니다. 디스크와 원본 버킷은 남으니 확인한 뒤 클라우드에서 지우세요.</p>
        {!asked ? (
          <div className="actrow">
            <button type="button" className="btn primary" disabled={!!busy || cleaning} onClick={() => setAsked(true)}>
              원본 중지
            </button>
          </div>
        ) : (
          <div className="box badbox" role="group" aria-label="원본 중지 확인">
            <div className="bb">
              <b>{inst}을(를) 중지할까요?</b>
              <div className="actrow">
                <button type="button" className="btn primary" disabled={!!busy} onClick={onConfirm}>
                  {busy === "decommission" ? "중지하는 중" : "중지"}
                </button>
                <button type="button" className="btn ghost" disabled={!!busy} onClick={() => setAsked(false)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LegacyChanges({ o }: { o: Onboarding }) {
  return (
    <section className="box" aria-label="원본에 더한 것">
      <div className="bh">
        <b>원본에 더한 것</b>
        <Chip>{o.legacyChanges.length + "개"}</Chip>
      </div>
      <Table
        head={["할 일", "대상", "한 때", "되돌림"]}
        rows={o.legacyChanges.map((c) => [td(CHANGE_TEXT[c.kind] ?? c.kind), td(c.target, "m"), td(hms(c.at)), td(c.undoneAt ? hms(c.undoneAt) : "")])}
      />
    </section>
  );
}

/** What DELETE does in this state (ADR 0042), for the confirmation. */
export function deleteText(o: Onboarding): string {
  const s = stateOf(o);
  if (ONB_STATES.indexOf(s) <= ONB_STATES.indexOf("awaiting_approval"))
    return "진행 중인 hopai 작업과 임시 앱을 멈추고 지운 뒤, 계약 PR" + (o.pr ? " #" + o.pr.number : "") + "을 닫고 이 가져오기를 지웁니다. 원본은 아직 바꾸지 않았습니다.";
  return (
    "원본에 더한 " +
    o.legacyChanges.length +
    "개(Tailscale 컨테이너, hba 줄, 복제 계정, 인스턴스 태그 등)를 거꾸로 되돌리고 배포 workflow를 다시 켠 뒤, 게이트웨이 앱과 등록한 앱 " +
    o.app +
    "을(를) 지웁니다. 머지한 PR은 되돌리지 않습니다."
  );
}

function Delete({ o, busy, onConfirm }: { o: Onboarding; busy: string; onConfirm: () => void }) {
  const [asked, setAsked] = useState(false);
  if (!asked)
    return (
      <div className="actrow">
        <button type="button" className="btn ghost" disabled={!!busy} onClick={() => setAsked(true)}>
          <Icon name="x" size={16} />
          {o.deleting ? "삭제 다시 시도" : "가져오기 삭제"}
        </button>
      </div>
    );
  return (
    <div className="box badbox" role="group" aria-label="가져오기 삭제 확인">
      <div className="bb">
        <b>{o.app} 가져오기를 삭제할까요?</b>
        <p>{deleteText(o)}</p>
        <div className="actrow">
          <button
            type="button"
            className="btn primary"
            disabled={!!busy}
            onClick={() => {
              setAsked(false);
              onConfirm();
            }}
          >
            {busy === "delete" ? "삭제하는 중" : "삭제"}
          </button>
          <button type="button" className="btn ghost" disabled={!!busy} onClick={() => setAsked(false)}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
