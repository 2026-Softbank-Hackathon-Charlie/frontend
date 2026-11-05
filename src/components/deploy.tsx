// Pieces of the GitHub deploy screens (new app, app list and detail, deployment) that more than one page uses.
import type { SpecCheck } from "../api/hooks";
import { isFinalDeploymentStatus } from "../api/sse";
import type { App, AppInstance, AppSpec, AppSpecFieldError, Deployment, DeploymentEnvironmentStatus, DeploymentStatus, DeploymentTrigger } from "../api/types";
import { instancesOf } from "../data/deploy";
import { errorText } from "../data/live";
import { ENV, ENV_ORDER } from "../sim/data";
import { envName } from "./shared";
import { Chip, ProgItem, Table, td, type ChipKind } from "./ui";

/* ---------- labels ---------- */

export const DEPLOY_LABEL: Record<DeploymentStatus, string> = {
  queued: "대기열",
  building: "이미지 빌드",
  committing: "gitops 커밋",
  syncing: "Argo CD 동기화",
  healthy: "정상",
  failed: "실패",
  superseded: "대체됨",
};
const DEPLOY_CHIP: Record<DeploymentStatus, [ChipKind, string]> = {
  queued: ["run", "대기 중"],
  building: ["run", "빌드 중"],
  committing: ["run", "커밋 중"],
  syncing: ["run", "동기화 중"],
  healthy: ["ok", "정상"],
  failed: ["bad", "실패"],
  superseded: ["", "대체됨"],
};
export function DeployChip({ s }: { s: DeploymentStatus }) {
  const [kind, text] = DEPLOY_CHIP[s];
  return <Chip kind={kind}>{text}</Chip>;
}

export const ENV_STATUS: Record<DeploymentEnvironmentStatus, [ChipKind, string]> = {
  pending: ["", "대기"],
  syncing: ["run", "동기화 중"],
  healthy: ["ok", "정상"],
  degraded: ["bad", "저하"],
  failed: ["bad", "실패"],
};
export function EnvChip({ s, env }: { s: DeploymentEnvironmentStatus; env?: string }) {
  const [kind, text] = ENV_STATUS[s];
  return <Chip kind={kind}>{env ? envName(env) + " " + text : text}</Chip>;
}

export const TRIGGER_LABEL: Record<DeploymentTrigger, string> = { register: "등록", manual: "수동", push: "push", redeploy: "재배포" };

export const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : "-");

/** Epoch ms of an RFC 3339 time; the server's nanoseconds are cut to milliseconds, which Date.parse takes everywhere. */
export const ms = (t: string) => Date.parse(t.replace(/(\.\d{3})\d*/, "$1"));

/** "방금", "12분 전", "3시간 전", "어제" or a date. */
export function ago(t: string | undefined, now: number): string {
  if (!t) return "-";
  const s = Math.max(0, (now - ms(t)) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return Math.floor(s / 60) + "분 전";
  if (s < 86_400) return Math.floor(s / 3600) + "시간 전";
  if (s < 172_800) return "어제";
  return new Date(ms(t)).toLocaleDateString("ko-KR");
}

/** Seconds from creation to the end, or to `now` while the deployment runs. */
export function elapsedSec(d: Deployment, now: number): number {
  const end = d.finishedAt ? ms(d.finishedAt) : now;
  return Math.max(0, (end - ms(d.createdAt)) / 1000);
}

export function ExtLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {href}
    </a>
  );
}

/* ---------- platform.yaml ---------- */

const RESOURCE: Record<string, [string, string]> = {
  postgres: ["PostgreSQL (CloudNativePG)", "DATABASE_URL"],
  s3: ["S3 버킷", "S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_PATH_STYLE, S3_ACCESS_KEY, S3_SECRET_KEY"],
};

export const publicUrl = (spec: AppSpec) => (spec.services.some((s) => s.public) ? "https://" + spec.name + ".hopcharlie.dev" : undefined);

function counts(spec: AppSpec): string {
  const r = (spec.resources ?? []).map((x) => (x.type === "postgres" ? "PostgreSQL" : x.type === "s3" ? "S3 버킷" : x.type) + " 1개");
  return ["서비스 " + spec.services.length + "개", ...r].join(", ");
}

/** The parsed spec: public URL, services and resources. */
export function SpecSummary({ spec }: { spec: AppSpec }) {
  const url = publicUrl(spec);
  const res = spec.resources ?? [];
  return (
    <>
      <dl className="kv">
        <dt>앱 이름</dt>
        <dd className="m">{spec.name}</dd>
        <dt>공개 주소</dt>
        <dd>{url ? <ExtLink href={url} /> : "없음 (public: true인 서비스가 없습니다)"}</dd>
      </dl>
      <Table
        head={["서비스", "빌드", "포트", "헬스 체크", "공개", "복제 수", "환경 변수"]}
        rows={spec.services.map((s) => [
          td(s.name, "m"),
          td((s.path === "." ? "" : s.path + "/") + s.dockerfile, "m"),
          td(s.port, "m"),
          td(s.healthCheck ?? "-", "m"),
          td(s.public ? "공개" : "-"),
          td(s.replicas, "m"),
          td(Object.keys(s.env ?? {}).join(", ") || "-", "m"),
        ])}
      />
      {res.length > 0 && (
        <Table head={["리소스", "종류", "앱에 넣는 변수"]} rows={res.map((r) => [td(r.name, "m"), td(RESOURCE[r.type]?.[0] ?? r.type), td(RESOURCE[r.type]?.[1] ?? "-", "m")])} />
      )}
      <p className="hint">
        모든 서비스에 PORT를 넣어 줍니다. postgres는 환경마다 CloudNativePG로 만들고, 접속 정보를 DATABASE_URL로 넣어 줍니다. s3는 환경마다 버킷을 만들고 S3_로 시작하는 변수로 넣어 줍니다.
      </p>
    </>
  );
}

/**
 * Fields that have the value appspec fills in when they are left out. The
 * answer carries the spec with defaults applied, not the file, so a field
 * written out with the default value is listed too.
 */
export function specDefaults(spec: AppSpec): [string, string][] {
  const out: [string, string][] = [];
  spec.services.forEach((s, i) => {
    const p = "services[" + i + "].";
    if (s.path === ".") out.push([p + "path", "."]);
    if (s.dockerfile === "Dockerfile") out.push([p + "dockerfile", "Dockerfile"]);
    if (s.replicas === 1) out.push([p + "replicas", "1"]);
    if (!s.public) out.push([p + "public", "false"]);
  });
  return out;
}

const HINTS: [RegExp, string][] = [
  [/^name$/, "name은 소문자와 숫자, -로 32자 안에 적고 api, console, app은 피하세요."],
  [/^services$/, "서비스를 1개에서 5개까지 적으세요."],
  [/^services\[\d+\]\.name$/, "서비스 이름은 소문자로 시작해 소문자와 숫자, -로 24자 안에 적고 겹치지 않게 하세요."],
  [/^services\[\d+\]\.port$/, "port에는 서비스가 듣는 포트를 1에서 65535 사이로 적으세요."],
  [/^services\[\d+\]\.replicas$/, "replicas는 1에서 5 사이로 적으세요."],
  [/^services\[\d+\]\.public$/, "public: true는 서비스 하나에만 둘 수 있습니다."],
  [/^services\[\d+\]\.healthCheck$/, "healthCheck는 /healthz처럼 /로 시작하는 경로로 적으세요."],
  [/^services\[\d+\]\.(path|dockerfile)$/, "레포 안의 상대 경로로 적고(.. 금지), 그 위치에 Dockerfile이 있는지 확인하세요."],
  [/^services\[\d+\]\.env/, "env 값은 따옴표로 감싼 문자열로 적고, 이름에 PORT, DATABASE_URL, S3_로 시작하는 것은 쓰지 마세요."],
  [/^resources$/, "리소스는 종류마다 하나까지만 둘 수 있습니다."],
  [/^resources\[\d+\]\.type$/, "type은 postgres나 s3로 적으세요."],
  [/^resources\[\d+\]\.name$/, "리소스 이름은 소문자로 시작해 소문자와 숫자, -로 24자 안에 적고 겹치지 않게 하세요."],
];

/** One sentence on what to change for a platform.yaml error. */
export function specHint(e: AppSpecFieldError): string {
  if (!e.path) {
    if (/branch/i.test(e.message)) return "브랜치 이름이 맞는지 확인하세요.";
    if (/not visible|installation/i.test(e.message)) return "GitHub App 설치에 이 레포가 들어 있는지 확인하세요.";
    if (/not found|no such|missing/i.test(e.message)) return "레포 루트에 platform.yaml을 두세요. 서비스마다 Dockerfile도 있어야 합니다.";
    if (/unknown|field/i.test(e.message)) return "규칙에 없는 키를 지우세요. 키 이름의 오타도 확인하세요.";
    return "platform.yaml이 YAML 형식인지, 규칙에 없는 키가 없는지 확인하세요.";
  }
  return HINTS.find(([re]) => re.test(e.path))?.[1] ?? "이 위치의 값을 platform.yaml 규칙에 맞게 고치세요.";
}

function SpecErrors({ errors }: { errors: AppSpecFieldError[] }) {
  return (
    <div className="box">
      <div className="bh">
        <b>직접 고쳐야 하는 항목</b>
        <Chip kind="bad">{errors.length}개</Chip>
      </div>
      <Table head={["위치", "내용", "고칠 방법"]} rows={errors.map((e) => [td(e.path || "platform.yaml", "m"), td(e.message), td(specHint(e))])} />
    </div>
  );
}

function SpecDefaults({ spec }: { spec: AppSpec }) {
  const rows = specDefaults(spec);
  if (rows.length === 0) return null;
  return (
    <div className="box">
      <div className="bh">
        <b>플랫폼 기본값을 쓰는 항목</b>
        <span className="hint">적지 않으면 이 값으로 채웁니다</span>
      </div>
      <Table head={["위치", "값"]} rows={rows.map(([p, v]) => [td(p, "m"), td(v, "m")])} />
    </div>
  );
}

/** The check of a repository's platform.yaml: what will be deployed, or what to fix. */
export function SpecResult({ check }: { check: SpecCheck }) {
  const v = check.data;
  if (check.error) {
    return (
      <div className="box badbox" role="alert">
        <div className="bb">
          <b>레포를 확인하지 못했습니다.</b>
          <p>{errorText(check.error)}</p>
          <div className="actrow">
            <button type="button" className="btn" onClick={check.reload}>
              다시 확인
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!v) {
    if (!check.loading) return null;
    return (
      <div className="box">
        <div className="bh">
          <b>레포 확인 결과</b>
          <Chip kind="run">확인 중</Chip>
        </div>
        <div className="bb">
          <p className="hint">platform.yaml과 서비스마다의 Dockerfile을 확인하고 있습니다.</p>
        </div>
      </div>
    );
  }
  if (!v.valid) {
    return (
      <>
        <div className="box badbox" role="alert">
          <div className="bb">
            <b>이 레포는 바로 배포할 수 없습니다.</b>
            <p>
              레포 루트에 platform.yaml이 있고, 서비스마다 Dockerfile이 있어야 합니다. 아래 항목을 고쳐 push한 뒤 다시 확인을 누르세요. 두 파일이 아직 없다면 기존 앱 가져오기를 쓰세요. AI가 두 파일을 만들어 PR로 올립니다.
            </p>
            <div className="actrow">
              <button type="button" className="btn" onClick={check.reload}>
                다시 확인
              </button>
              <a className="btn ghost" href="#onboard">
                기존 앱 가져오기
              </a>
            </div>
          </div>
        </div>
        <SpecErrors errors={v.errors} />
        {v.spec && <SpecDefaults spec={v.spec} />}
      </>
    );
  }
  const spec = v.spec!;
  return (
    <>
      <div className="box">
        <div className="bh">
          <b>레포 확인 결과</b>
          <Chip kind="ok">배포 가능</Chip>
        </div>
        <div className="bb">
          <ul className="prog">
            <ProgItem st="ok" title="Dockerfile" sub={"서비스 " + spec.services.length + "개 모두 있음"} />
            <ProgItem st="ok" title="platform.yaml" sub={counts(spec)} right={v.commit ? short(v.commit) : undefined} />
          </ul>
          <SpecSummary spec={spec} />
        </div>
      </div>
      <SpecDefaults spec={spec} />
    </>
  );
}

/* ---------- app list ---------- */

export type AppHealth = "healthy" | "problem" | "deploying";

/** Where one instance stands. */
export function instanceHealth(i: AppInstance): AppHealth {
  if (i.lastDeployment && !isFinalDeploymentStatus(i.lastDeployment.status)) return "deploying";
  if (i.lastDeployment?.status === "failed" || i.status.some((s) => s.status === "failed" || s.status === "degraded")) return "problem";
  if (i.status.length > 0 && i.status.every((s) => s.status === "healthy")) return "healthy";
  return "deploying";
}

/**
 * Where a registered app stands over all its instances: a problem in any of
 * them first, so another instance's deployment does not hide it, then
 * deploying, then healthy. Undefined for an app only in PLATFORM_APPS_FILE,
 * which has no deploy status.
 */
export function appHealth(a: App): AppHealth | undefined {
  if (!a.deploy) return undefined;
  const all = instancesOf(a).map(instanceHealth);
  if (all.includes("problem")) return "problem";
  if (all.includes("deploying")) return "deploying";
  return "healthy";
}

/**
 * Where an app is, as one short chip per platform environment: the default
 * instance's state for a registered app (pending reads as deploying while its
 * deployment runs), green where a file app runs, grey where the app is not.
 */
function envChips(a: App, def: AppInstance | undefined) {
  const deploying = !!def?.lastDeployment && !isFinalDeploymentStatus(def.lastDeployment.status);
  return ENV_ORDER.map((k) => {
    const id = ENV[k].id;
    let st: [ChipKind, string] = ["", "그 환경에 없음"];
    const s = def?.status.find((x) => x.env === id);
    if (s) st = s.status === "pending" && deploying ? ["run", "배포 중"] : ENV_STATUS[s.status];
    else if (!def && a.environments.some((e) => e.env === id)) st = ["ok", "실행 중"];
    return (
      <Chip key={id} kind={st[0]}>
        {ENV[k].short}
        <span className="sr-only"> {st[1]}</span>
      </Chip>
    );
  });
}

/** File apps and registered apps in one table, as GET /v1/apps lists them. */
export function AppsList({ apps, now, busy = {}, full }: { apps: App[]; now: number; busy?: Record<string, string>; full: boolean }) {
  const rows = apps.map((a) => {
    const d = a.deploy;
    const last = d?.lastDeployment;
    const insts = instancesOf(a);
    const name = (
      <span className="chips">
        <a href={"#app-" + a.name}>{a.name}</a>
        {d && <Chip>GitHub</Chip>}
        {insts.length > 1 && <Chip>브랜치 {insts.length}</Chip>}
      </span>
    );
    // The chips are the default instance's; another instance shows up only when it is not healthy.
    const others = insts.filter((i) => !i.default).map((i) => [i, instanceHealth(i)] as const);
    const envs = (
      <div className="chips">
        <span className="envchips">{envChips(a, insts.find((i) => i.default))}</span>
        {others.map(([i, h]) =>
          h === "healthy" ? null : (
            <Chip key={i.name} kind={h === "problem" ? "bad" : "run"}>
              {i.branch} 브랜치 {h === "problem" ? "문제 있음" : "배포 중"}
            </Chip>
          ),
        )}
        {/* busy is only a label: one that waits on a person ("승인 대기", "전환 승인 대기") is amber, machine work blue */}
        {busy[a.name] && <Chip kind={busy[a.name].includes("승인 대기") ? "warn" : "run"}>{busy[a.name]}</Chip>}
      </div>
    );
    const r = [td(name)];
    if (full) r.push(td(d?.repo ?? "-", "m"));
    r.push(
      td(envs),
      td(d?.url ? <ExtLink href={d.url} /> : "-", "nw"),
      td(
        last ? (
          <span className="chips">
            <a href={"#deploy-" + last.id} aria-label={a.name + " 최근 배포"}>
              <DeployChip s={last.status} />
            </a>
            <span className="hint">{ago(last.createdAt, now)}</span>
          </span>
        ) : (
          "-"
        ),
        "nw",
      ),
    );
    if (full)
      r.push(
        td(
          a.environments.length > 0 ? (
            <a className="btn ghost" href="#migrate-app">
              이전
            </a>
          ) : (
            ""
          ),
        ),
      );
    return r;
  });
  const head = full ? ["이름", "레포", "환경별 상태", "주소", "최근 배포", ""] : ["이름", "환경별 상태", "주소", "최근 배포"];
  return (
    <div className="box">
      <Table head={head} rows={rows} />
      <div className="legend envlegend">
        {LEGEND.map(([kind, text]) => (
          <span key={text}>
            <Chip kind={kind}>EKS</Chip> {text}
          </span>
        ))}
      </div>
    </div>
  );
}

const LEGEND: [ChipKind, string][] = [
  ["ok", "정상"],
  ["run", "배포 중"],
  ["bad", "문제 있음"],
  ["", "그 환경에 없음"],
];
