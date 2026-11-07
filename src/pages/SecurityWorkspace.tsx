import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EnvLabel } from "../components/shared";
import { Chip, LoadError, PageHead, Skeleton, Table, Tabs, td, type ChipKind } from "../components/ui";
import { SecurityStorageKeys } from "../components/SecurityStorageKeys";
import { SecurityExceptionPanel, exceptionLabel } from "../components/SecurityException";
import { SecurityOCSF } from "../components/SecurityOCSF";
import { CATEGORIES, CATEGORY_LABEL } from "../data/securityMatrix";
import {
  DEPLOYED_STATE, DOMAINS, SCAN_STATE, activeException, environmentLabel as envLabel, controlCounts, filterControls, filterVulnerabilities, summarizeVulnerabilities,
  type ControlEvaluation, type DeployedState, type ExceptionInfo, type RunningImageRow, type SecurityDataset, type SecurityFindingRow, type SecuritySeverity, type VulnerabilityFinding,
} from "../data/security";
import type { SecurityControlCoverage } from "../api/types";
import { epssLabel, kevLabel, priorityReasons, sortByPriority } from "../data/vulnPriority";
import "../styles/security.css";

type Environment = ControlEvaluation["environment"];
type Scope = "all" | Environment;
type Tab = "overview" | "controls" | "vulnerabilities" | "findings" | "sources" | "ocsf";
const TABS = [
  { id: "overview", label: "개요" }, { id: "controls", label: "통제 점검" }, { id: "vulnerabilities", label: "취약점" },
  { id: "findings", label: "발견 항목" }, { id: "sources", label: "수집 상태" }, { id: "ocsf", label: "OCSF 내보내기" },
];
const SEVERITY: Record<SecuritySeverity, [string, ChipKind]> = {
  critical: ["치명", "bad"], high: ["높음", "bad"], medium: ["중간", "warn"], low: ["낮음", ""], info: ["정보", ""], unknown: ["미확인", ""],
};
const STATUS: Record<ControlEvaluation["status"], [string, ChipKind]> = {
  pass: ["통과", "ok"], fail: ["실패", "bad"], unknown: ["미확인", "warn"], not_applicable: ["해당 없음", ""],
};
const SOURCE_STATUS = { ok: ["수집 완료", "ok"], error: ["수집 실패", "bad"], unavailable: ["응답 없음", "warn"], not_configured: ["미연결", "warn"], stale: ["오래된 결과", "warn"], unsupported: ["미지원", ""], idle: ["조회 대상 없음", ""] } as const;
const KIND = { configuration: "설정", vulnerability: "취약점", threat: "위협", governance: "거버넌스" } as const;
const tabHref = (tab: string) => tab === "overview" ? "#security" : "#security/" + tab;
const detailHref = (tab: string, id: string) => "#security/" + tab + "/" + id;
const domainLabel = (id: string) => DOMAINS.find((d) => d.id === id)?.label ?? id;
const date = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " KST" : "미확인";
const matches = (search: string, ...values: (string | null | undefined)[]) => values.join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
const unique = (values: string[]) => [...new Set(values)];
function SecurityEnvLabel({ env, label = envLabel(env) }: { env: string; label?: string }) {
  const iconEnv = env === "aws-account" ? "aws" : env === "gcp-project" ? "gcp" : env;
  return <EnvLabel env={iconEnv} label={label} />;
}
function SecurityEnvList({ environments }: { environments: string[] }) {
  const byLabel = new Map(environments.map((env) => [envLabel(env), env]));
  return [...byLabel].map(([label, env], i) => <Fragment key={label}>{i > 0 && " · "}<SecurityEnvLabel env={env} label={label} /></Fragment>);
}
/** SEC-08 exception filter: exclude (default) hides active exceptions, include shows all, only shows just them. */
type ExceptionMode = "exclude" | "include" | "only";
const exceptionShown = (mode: ExceptionMode, e?: ExceptionInfo) => mode === "include" || (mode === "only") === activeException(e);
function ExceptionFilter({ value, onChange }: { value: ExceptionMode; onChange: (v: ExceptionMode) => void }) {
  return <label>예외<select aria-label="예외" value={value} onChange={(e) => onChange(e.target.value as ExceptionMode)}><option value="exclude">제외</option><option value="include">포함</option><option value="only">예외만</option></select></label>;
}
function ExceptionChip({ value }: { value?: ExceptionInfo }) {
  return value && activeException(value) ? <Chip>{exceptionLabel(value)}</Chip> : null;
}

const NO_SCAN_TIME = "이 출처는 자체 검사를 언제 했는지 알려주지 않습니다. 수집 시각은 플랫폼이 결과를 가져온 시각입니다.";

function ScanTimes({ collected, scanned }: { collected: string | null; scanned: string | null }) {
  const tipId = useId();
  return <><b className="block sp-collected">수집 {date(collected)}</b>{scanned
    ? <small className="block">검사 {date(scanned)}</small>
    : <small className="block sp-no-scan"><span>(검사 시각 미확인)</span> <span className="sp-info" tabIndex={0} role="img" aria-label="설명" aria-describedby={tipId} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}>ⓘ</span><span role="tooltip" id={tipId} className="sp-tip">{NO_SCAN_TIME}</span></small>}</>;
}

function groupVulnerabilities(values: VulnerabilityFinding[]): VulnerabilityFinding[][] {
  const groups = new Map<string, VulnerabilityFinding[]>();
  for (const value of values) {
    const group = groups.get(value.advisory) ?? [];
    group.push(value);
    groups.set(value.advisory, group);
  }
  return [...groups.values()];
}

function unknownWorkloads(values: VulnerabilityFinding[]): number {
  return unique(values.flatMap((v) => v.occurrences.filter((o) => o.running === null).map((o) => `${o.environment}/${o.namespace}/${o.workload}`))).length;
}

function Severity({ value }: { value: SecuritySeverity }) {
  return <Chip kind={SEVERITY[value][1]}>{SEVERITY[value][0]}</Chip>;
}

function EvidenceLink({ href, children = "공식 근거 보기" }: { href: string; children?: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children} <span aria-hidden="true">↗</span></a>;
}

function Section({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="sec sp-section"><div className="sech"><div><h2>{title}</h2>{sub && <p className="hint">{sub}</p>}</div>{action}</div>{children}</section>;
}

function Empty({ children, reset }: { children: string; reset?: () => void }) {
  return <div className="sp-empty"><p>{children}</p><small className="hint">현재 선택한 범위의 조회 결과입니다. 전체 환경이 안전하다는 의미는 아닙니다.</small>{reset && <button className="btn ghost sm" type="button" onClick={reset}>검색 초기화</button>}</div>;
}

function Stats({ items }: { items: { label: string; value: ReactNode; note: string; href?: string; tone?: string }[] }) {
  return <div className="sp-stats">{items.map((item) => {
    const body = <><span className="sp-stat-label">{item.label}</span><strong className={item.tone ?? ""}>{item.value}</strong><small>{item.note}</small></>;
    return item.href ? <a className="sp-stat" href={item.href} key={item.label}>{body}</a> : <div className="sp-stat" key={item.label}>{body}</div>;
  })}</div>;
}

function GroupCounts({ controls }: { controls: ControlEvaluation[] }) {
  if (!controls.length) return <span className="hint">범위에 없음</span>;
  const c = controlCounts(controls);
  return <span className="sp-counts"><span className="sp-count-pass">통과 {c.pass}</span><span className={c.fail ? "sp-count-fail" : ""}>실패 {c.fail}</span><span className={c.unknown ? "sp-count-unknown" : ""}>미확인 {c.unknown}</span>{c.notApplicable > 0 && <span>해당 없음 {c.notApplicable}</span>}</span>;
}

function ControlMatrix({ environments, controls, coverage, findings, onSelect }: { environments: SecurityDataset["environments"]; controls: ControlEvaluation[] | null; coverage?: SecurityControlCoverage[]; findings: SecurityFindingRow[]; onSelect: (environment: string, domain: string) => void }) {
  const unsupported = (environment: string, domain: string) => coverage?.find((c) => c.environment === environment && c.domain === domain && c.state === "unsupported");
  return <div className="box sp-table-box"><Table head={["환경", ...DOMAINS.map((d) => d.label)]} rows={environments.map((environment) => [
    td(<><b><SecurityEnvLabel env={environment.id} label={environment.label} /></b><small className="block">{environment.provider}</small></>),
    ...DOMAINS.map((domain) => td(controls === null
      ? <><span className="hint">평가 미연동</span><small className="block">수집 신호 {findings.filter((f) => f.environment === environment.id && f.domain === domain.id).length}건</small></>
      : unsupported(environment.id, domain.id) ? <span className="hint" title={unsupported(environment.id, domain.id)?.reason}>검사 통제 없음 · 통과 아님</span>
      : <a className="sp-matrix-cell" href="#security/controls" onClick={() => onSelect(environment.id, domain.id)}><GroupCounts controls={controls.filter((c) => c.environment === environment.id && c.domain === domain.id)} /></a>)),
  ])} /></div>;
}

function DeployedChip({ value }: { value?: DeployedState }) {
  if (!value) return <Chip>비교 안 함</Chip>;
  const [label, kind] = DEPLOYED_STATE[value.state];
  return <Chip kind={kind as ChipKind}>{label}</Chip>;
}

/** Every running container: whether its digest was scanned (SEC-04) and matches the deployment record (SEC-05). */
function RunningImages({ rows }: { rows: RunningImageRow[] }) {
  const count = (f: (r: RunningImageRow) => boolean) => rows.filter(f).length;
  const scanned = count((r) => r.scanState === "scanned"), failed = count((r) => r.scanState === "scan_failed");
  const drifted = count((r) => r.deployed?.state === "mismatch");
  return <section aria-label="실행 컨테이너 스캔 상태" className="sp-running">
    <h3>실행 컨테이너 스캔·배포 기록</h3>
    <p className="sp-list-meta">컨테이너 {rows.length}개 <span>· 스캔됨 {scanned} · 스캔 실패 {failed} · 미검사·digest 미확인 {rows.length - scanned - failed} · 배포 기록과 다름 {drifted}</span></p>
    <p className="hint">스캔 실패와 미검사는 취약점 0건이 아닙니다. 배포 기록과 다르면 롤아웃 중이거나 플랫폼 밖에서 바뀐 이미지일 수 있습니다.</p>
    <div className="box sp-table-box">{rows.length ? <Table head={["환경 / workload", "이미지 digest", "스캔", "배포 기록"]} rows={rows.map((r) => [
      td(<><b><SecurityEnvLabel env={r.environment} /></b><small className="block m">{r.namespace} / {r.workload}/{r.container}</small>{r.app && <small className="block">앱 {r.app}</small>}</>),
      td(<><span className="m sp-wrap">{r.digest ? `${r.digest.slice(0, 23)}…` : "digest 없음"}</span><small className="block sp-wrap">{r.image}</small></>),
      td(<><Chip kind={SCAN_STATE[r.scanState][1] as ChipKind}>{SCAN_STATE[r.scanState][0]}</Chip>{r.scannedAt && <small className="block">검사 {date(r.scannedAt)}</small>}{r.scanMessage && <small className="block">{r.scanMessage}</small>}</>),
      td(<><DeployedChip value={r.deployed} />{r.deployed?.deploymentId && <small className="block m">{r.deployed.deploymentId}</small>}{r.deployed?.reason && <small className="block">{r.deployed.reason}</small>}</>),
    ])} /> : <Empty>선택한 환경에서 읽은 실행 컨테이너가 없습니다.</Empty>}</div>
  </section>;
}

function Unavailable({ kind, reason }: { kind: "통제 평가" | "취약점"; reason?: string }) {
  if (reason) return <div className="box sp-empty"><h3>{kind} 결과 없음</h3><p>{reason}</p><p className="hint">시연 데이터로 채우거나 ‘0건’·‘안전’으로 판단하지 않습니다. 수집 상태 탭에서 원인을 확인하세요.</p><a href="#security/sources">수집 상태 보기</a></div>;
  return <div className="box sp-empty"><h3>{kind} 데이터 연동 준비 중</h3><p>현재 플랫폼 API는 {kind === "통제 평가" ? "기준별 평가 대상·통과·실패 결과" : "CVE·패키지·이미지 digest·실행 자산 관계"}를 제공하지 않습니다.</p><p className="hint">시연 데이터로 채우거나 ‘0건’·‘안전’으로 판단하지 않습니다. 수집된 실제 신호는 발견 항목에서 확인할 수 있습니다.</p><a href="#security/findings">발견 항목 보기</a></div>;
}

export function SecurityWorkspace({ route, data, loading = false, error, reload }: { route: string; data: SecurityDataset; loading?: boolean; error?: string; reload?: () => void }) {
  const [, segment = "overview", itemId] = route.split("/");
  const tab = segment as Tab;
  const [environment, setEnvironment] = useState<Scope>("all");
  const [app, setApp] = useState("all");
  const [controlSearch, setControlSearch] = useState("");
  const [controlStatus, setControlStatus] = useState("all");
  const [domain, setDomain] = useState("all");
  const [vulnSearch, setVulnSearch] = useState("");
  const [vulnSeverity, setVulnSeverity] = useState("all");
  const [vulnKev, setVulnKev] = useState("all");
  const [vulnException, setVulnException] = useState<ExceptionMode>("exclude");
  const [findingException, setFindingException] = useState<ExceptionMode>("exclude");
  const [findingSearch, setFindingSearch] = useState("");
  const [findingKind, setFindingKind] = useState("all");
  const [findingSeverity, setFindingSeverity] = useState("all");
  const [findingCategory, setFindingCategory] = useState("all");
  const focusRef = useRef<HTMLHeadingElement>(null);
  const previousDetail = useRef<{ id: string; tab: Tab; scroll: number } | null>(null);
  const controls = filterControls(data.controls ?? [], environment, app);
  const vulnerabilities = filterVulnerabilities(data.vulnerabilities ?? [], environment, app);
  const findings = data.findings.filter((f) => (environment === "all" || f.environment === environment) && (app === "all" || f.app === app));
  const sources = data.sources.filter((s) => environment === "all" || s.environment === environment);
  const missingSources = sources.filter((s) => s.status !== "ok" && s.status !== "idle");
  const counts = controlCounts(controls);
  const summary = summarizeVulnerabilities(vulnerabilities);
  const apps = data.apps;
  const activeControls = controls.filter((c) => matches(controlSearch, c.title, c.controlId) && (controlStatus === "all" || c.status === controlStatus) && (domain === "all" || c.domain === domain));
  const activeVulnerabilities = vulnerabilities.filter((v) => matches(vulnSearch, v.advisory, v.package, v.installedVersion) && (vulnSeverity === "all" || v.severity === vulnSeverity) && (vulnKev === "all" || (vulnKev === "yes" ? v.kev === true : v.kev === null && v.kevState !== "no_cve")) && exceptionShown(vulnException, v.exception));
  const vulnerabilityGroups = sortByPriority(groupVulnerabilities(activeVulnerabilities));
  const selectedControl = tab === "controls" ? controls.find((c) => c.id === itemId) : undefined;
  const selectedVulnerability = tab === "vulnerabilities" ? vulnerabilities.find((v) => v.id === itemId) : undefined;
  const selectedFinding = tab === "findings" ? findings.find((f) => f.id === itemId) : undefined;

  useEffect(() => {
    if (itemId) {
      previousDetail.current = { id: itemId, tab, scroll: previousDetail.current?.scroll ?? window.scrollY };
      focusRef.current?.focus();
      focusRef.current?.scrollIntoView?.({ block: "start" });
    } else if (previousDetail.current) {
      const previous = previousDetail.current;
      previousDetail.current = null;
      if (previous.tab === tab) {
        document.querySelector<HTMLAnchorElement>(`a[href="${detailHref(previous.tab, previous.id)}"]`)?.focus({ preventScroll: true });
        window.scrollTo(0, previous.scroll);
      }
    }
  }, [itemId, tab]);

  return <div className="page sp-page">
    <PageHead icon="shield-check" title="보안" sub="모든 환경을 같은 기준으로 살펴보고, 판정의 근거까지 확인합니다." acts={<a className="btn ghost sm" href="#security/sources">점검 범위 보기</a>} />
    <div className="sp-preview-note"><Chip kind={data.mode === "demo" ? "run" : "ok"}>{data.mode === "demo" ? "데모 보안 데이터" : "플랫폼 API 데이터"}</Chip><span>{data.mode === "demo" ? "통제·CVE·자산 관계는 설명을 위한 시연 데이터이며 실제 인프라 점검 결과가 아닙니다." : "수집된 신호를 그대로 표시합니다. 통제 평가·CVE의 미제공 정보는 미연동으로 남깁니다."}</span></div>

    <div className="sp-scope">
      <div className="sp-scope-fields"><label>환경<select aria-label="보안 환경" value={environment} onChange={(e) => setEnvironment(e.target.value as Scope)}><option value="all">전체 환경</option>{data.environments.map((env) => <option key={env.id} value={env.id}>{env.label}</option>)}</select></label>
      <label>앱<select aria-label="보안 앱" disabled={!data.appFilterAvailable} title={!data.appFilterAvailable ? "현재 API가 발견 항목과 앱의 관계를 제공하지 않습니다." : undefined} value={app} onChange={(e) => setApp(e.target.value)}><option value="all">전체 앱 · 계정 포함</option>{apps.map((name) => <option key={name}>{name}</option>)}</select></label>
      {(environment !== "all" || app !== "all") && <button type="button" className="linkbtn" onClick={() => { setEnvironment("all"); setApp("all"); }}>범위 초기화</button>}</div>
      <div className="sp-asof"><span>{data.mode === "demo" ? "시연 데이터 기준 시각" : "플랫폼 결과 수집 시각"}</span><b>{date(data.generatedAt)}</b></div>
    </div>
    <Tabs label="보안 메뉴" items={TABS} current={tab} hrefOf={tabHref} />
    {error && data.generatedAt && <LoadError title="최신 결과를 다시 읽지 못했습니다. 마지막 성공 결과를 표시합니다." error={error} retry={reload} />}
    {missingSources.length > 0 && <div className="sp-coverage-note"><div><b>점검이 완료되지 않은 출처 {missingSources.length}개</b><span> {unique(missingSources.map((s) => envLabel(s.environment))).join(", ")}의 일부 결과는 미확인·미연결 또는 오래된 상태입니다.</span></div><a href="#security/sources">범위 확인 →</a></div>}
    {app !== "all" && tab !== "ocsf" && <p className="hint sp-scope-note">앱에 연결된 평가·자산만 표시합니다. 계정 수준 통제는 ‘전체 앱’에서, 수집 상태는 선택한 환경 범위에서 확인합니다.</p>}

    {loading ? <Skeleton box rows={4} /> : error && !data.generatedAt ? <LoadError title="보안 점검 결과를 불러오지 못했습니다." error={error} retry={reload} /> : itemId ? <>
      <a className="sp-back" href={tabHref(tab)}><span aria-hidden="true">← </span>{TABS.find((t) => t.id === tab)?.label} 목록으로</a>
      {selectedControl ? <ControlDetail value={selectedControl} headingRef={focusRef} live={data.mode === "live"} /> : selectedVulnerability ? <VulnerabilityDetail values={vulnerabilities.filter((v) => v.advisory === selectedVulnerability.advisory)} selected={selectedVulnerability} headingRef={focusRef} live={data.mode === "live"} reload={reload} /> : selectedFinding ? <FindingDetail value={selectedFinding} headingRef={focusRef} live={data.mode === "live"} reload={reload} /> : <div className="box"><h2 ref={focusRef} tabIndex={-1}>현재 조회 범위에서 항목을 찾을 수 없습니다.</h2><p>필터 범위가 달라졌거나 현재 결과에 없는 ID입니다. 이것만으로 해결되었다고 판단하지 않습니다.</p></div>}
    </> : tab === "overview" ? <>
      <div className="sp-source-summary"><b>수집된 발견 항목 {findings.length}건</b><span>출처 조회 성공 {sources.filter((s) => s.status === "ok").length} / {sources.length}개</span><a href="#security/findings">발견 항목 보기 →</a></div>
      <Stats items={[
        { label: "실패한 통제 평가", value: data.controls === null ? "미연동" : <>{counts.fail}<small>건</small></>, note: data.controls === null ? "개별 통제 평가 API 필요" : `통과 ${counts.pass} · 미확인 ${counts.unknown}`, href: "#security/controls", tone: data.controls === null ? undefined : "sp-danger" },
        { label: "취약 이미지", value: data.vulnerabilities === null ? "미연동" : <>{summary.images}<small>개</small></>, note: data.vulnerabilities === null ? "이미지·패키지 검사 결과 미제공" : `고유 advisory ${summary.advisories}개 · digest 기준`, href: "#security/vulnerabilities" },
        { label: "영향 실행 workload", value: data.vulnerabilities === null ? "미연동" : <>{summary.workloads}<small>개</small></>, note: data.vulnerabilities === null ? "실행 자산과의 연결 정보 미제공" : `실행 확인 기준 · 미확인 ${unknownWorkloads(vulnerabilities)}개 별도`, href: "#security/vulnerabilities" },
        { label: "통제 평가 완료", value: data.controls === null ? "미연동" : <>{counts.completed}<small>/ {counts.total - counts.notApplicable}</small></>, note: data.controls === null ? "수집 성공을 평가 통과로 바꾸지 않음" : `개별 평가 기준 · 해당 없음 ${counts.notApplicable}건 제외`, href: "#security/controls" },
      ]} />
      <Section title="환경 × 공통 통제" sub="같은 목표, 환경별 증거. 각 칸은 개별 검사 결과이며 전체 표준 준수 인증이 아닙니다." action={<a className="linkbtn" href="#security/controls">개별 검사 보기 →</a>}>
        <ControlMatrix environments={data.environments.filter((e) => environment === "all" || e.id === environment)} controls={data.controls === null ? null : controls} coverage={data.coverage} findings={findings} onSelect={(id, domain) => { setEnvironment(id); setDomain(domain); }} />
        <p className="hint sp-footnote">실패와 미확인은 함께 남깁니다. 권한·암호화 같은 영역 하나를 검사 하나로 세지 않습니다.</p>
      </Section>
      <Section title="우선 확인" sub="심각도와 별개로, 먼저 살펴볼 이유를 보여줍니다." action={<a className="linkbtn" href="#security/findings">모든 발견 항목 →</a>}>
        <div className="box sp-priorities">
          {vulnerabilities.filter((v) => v.kev !== false).slice(0, 2).map((v) => <a href={detailHref("vulnerabilities", v.id)} className="sp-priority" key={v.id}><Severity value={v.severity} /><div><b>{v.advisory} · {v.package}</b><p><SecurityEnvList environments={v.occurrences.map((o) => o.environment)} /> · {v.occurrences.some((o) => o.running === true) ? "실행 중인 자산 포함" : "실행 관계 확인 필요"}</p></div><Chip kind="warn">{v.kev === true ? "KEV 등재" : "악용 정보 미확인"}</Chip><span aria-hidden="true">→</span></a>)}
          {controls.filter((c) => c.status === "fail" || c.status === "unknown").slice(0, 3).map((c) => <a className="sp-priority" href={detailHref("controls", c.id)} key={c.id}><Chip kind={STATUS[c.status][1]}>{STATUS[c.status][0]}</Chip><div><b>{c.title}</b><p><SecurityEnvLabel env={c.environment} /> · {c.controlId}</p></div><span className="hint">근거 확인</span><span aria-hidden="true">→</span></a>)}
          {data.mode === "live" && findings.slice(0, 5).map((f) => <a className="sp-priority" href={detailHref("findings", f.id)} key={f.id}><Severity value={f.severity} /><div><b>{f.title}</b><p><SecurityEnvLabel env={f.environment} /> · {f.source}</p></div><span className="hint">원본 신호</span><span aria-hidden="true">→</span></a>)}
          {!vulnerabilities.length && !findings.length && !controls.some((c) => c.status !== "pass" && c.status !== "not_applicable") && <Empty>현재 범위에서 우선 확인 항목이 없습니다.</Empty>}
        </div>
      </Section>
      <div className="sp-method"><b>판정은 근거와 함께</b><p>통제는 공식 기준·조건으로, CVE는 원본 CVSS로 설명합니다. KEV·EPSS·실행 여부는 조치 판단의 별도 근거입니다. ‘미확인’은 ‘문제 없음’이 아닙니다.</p><div><EvidenceLink href="https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final">NIST 통제</EvidenceLink><EvidenceLink href="https://www.first.org/cvss/v4.0/user-guide">CVSS</EvidenceLink><EvidenceLink href="https://www.first.org/epss/">EPSS</EvidenceLink></div></div>
    </> : tab === "controls" ? <Section title="통제 점검" sub="권한·암호화·감사·정책·취약점 관리의 개별 평가입니다.">
      {data.controls === null ? <Unavailable kind="통제 평가" reason={data.unavailable?.controls} /> : <>
      <Stats items={[{ label: "통과", value: counts.pass, note: "정의된 검사 조건을 충족" }, { label: "실패", value: counts.fail, note: "검사에서 위반을 확인", tone: "sp-danger" }, { label: "미확인", value: counts.unknown, note: "증거 부족 · 점검 미완료" }, { label: "해당 없음", value: counts.notApplicable, note: "적용 대상 제외 · 사유 보존" }]} />
      <div className="sp-filters"><label className="sp-search">통제 검색<input aria-label="통제 검색" placeholder="검사 이름 또는 기준 ID" value={controlSearch} onChange={(e) => setControlSearch(e.target.value)} /></label><label>영역<select aria-label="통제 영역" value={domain} onChange={(e) => setDomain(e.target.value)}><option value="all">전체 영역</option>{DOMAINS.map((d) => <option value={d.id} key={d.id}>{d.label}</option>)}</select></label><label>평가 결과<select aria-label="통제 평가 결과" value={controlStatus} onChange={(e) => setControlStatus(e.target.value)}><option value="all">전체 결과</option>{Object.entries(STATUS).map(([id, [label]]) => <option value={id} key={id}>{label}</option>)}</select></label></div>
      <p className="sp-list-meta">표시 {activeControls.length}건 <span>· 개별 통제 × 자산 평가{data.policyVersion && ` · 정책 ${data.policyVersion}`}</span></p>
      <div className="box sp-table-box">{activeControls.length ? <Table head={["평가", "검사 / 공식 기준", "환경 · 영역", "대상", "평가 시각"]} rows={activeControls.map((c) => [td(<Chip kind={STATUS[c.status][1]}>{STATUS[c.status][0]}</Chip>), td(<><a className="sp-row-link" href={detailHref("controls", c.id)}>{c.title}</a><small className="block m">{c.controlId}</small></>), td(<><SecurityEnvLabel env={c.environment} /><small className="block">{domainLabel(c.domain)}</small></>), td(<>{c.app ?? "계정 / 클러스터"}{c.asset && <small className="block m sp-wrap">{c.asset === "*" ? "전체 자산" : c.asset}</small>}</>), td(date(c.observedAt), "nw")])} /> : <Empty reset={() => { setControlSearch(""); setControlStatus("all"); setDomain("all"); }}>현재 필터에 해당하는 통제 점검이 없습니다.</Empty>}</div>
      </>}
    </Section> : tab === "vulnerabilities" ? <Section title="취약점" sub="CVE·GHSA 등 패키지 취약점과 실행 자산을 연결해 확인합니다.">
      {data.vulnerabilities === null ? <Unavailable kind="취약점" reason={data.unavailable?.vulnerabilities} /> : <>
      <Stats items={[{ label: "고유 advisory", value: summary.advisories, note: "식별자 기준 · 패키지 건수와 구분" }, { label: "영향 이미지", value: summary.images, note: "같은 digest의 환경 간 복제는 1개" }, { label: "실행 workload", value: summary.workloads, note: `실행 확인 기준 · 미확인 ${unknownWorkloads(vulnerabilities)}개 별도` }, { label: "패키지 발생 건", value: summary.occurrences, note: "취약점 · 버전 · 이미지별 발생" }]} />
      <div className="sp-filters"><label className="sp-search">취약점 검색<input aria-label="취약점 검색" placeholder="CVE, 패키지, 설치 버전" value={vulnSearch} onChange={(e) => setVulnSearch(e.target.value)} /></label><label>심각도<select aria-label="취약점 심각도" value={vulnSeverity} onChange={(e) => setVulnSeverity(e.target.value)}><option value="all">전체 심각도</option>{Object.entries(SEVERITY).map(([id, [label]]) => <option key={id} value={id}>{label}</option>)}</select></label><label>악용 근거<select aria-label="악용 근거" value={vulnKev} onChange={(e) => setVulnKev(e.target.value)}><option value="all">전체</option><option value="yes">KEV 등재</option><option value="unknown">KEV 미확인</option></select></label><ExceptionFilter value={vulnException} onChange={setVulnException} /></div>
      <p className="sp-list-meta">표시 {vulnerabilityGroups.length}개 advisory <span>· 필터 전 선택 범위 {summary.advisories}개 · 기본 정렬: KEV 등재 → 실행 중 → 심각도 → EPSS</span></p>
      <section aria-label="취약점 목록" className="box sp-table-box">{vulnerabilityGroups.length ? <Table head={["심각도", "취약점 / 패키지", "영향 자산", "악용 근거", "수정 버전"]} rowClass={(i) => activeException(vulnerabilityGroups[i][0].exception) ? "sp-excepted" : undefined} rows={vulnerabilityGroups.map((group) => {
        const v = group[0], s = summarizeVulnerabilities(group);
        return [
          td(<><Severity value={v.severity} /><small className="block">{v.cvss === null ? "CVSS 미확인" : `CVSS ${v.cvssVersion} · ${v.cvss.toFixed(1)}`}</small></>),
          td(<><a className="sp-row-link m" href={detailHref("vulnerabilities", v.id)}>{v.advisory}</a><small className="block">{unique(group.map((x) => `${x.package} ${x.installedVersion}`)).join(", ")}</small>{priorityReasons(group).length > 0 && <small className="block sp-reasons">{priorityReasons(group).join(" · ")}</small>}<ExceptionChip value={v.exception} /></>),
          td(<><b>이미지 {s.images}개 · 실행 확인 {s.workloads}개</b>{unknownWorkloads(group) > 0 && <small className="block">실행 미확인 {unknownWorkloads(group)}개</small>}<small className="block"><SecurityEnvList environments={group.flatMap((x) => x.occurrences.map((o) => o.environment))} /></small></>),
          td(<><Chip kind={v.kev === true ? "warn" : ""}>{kevLabel(v)}</Chip>{v.ransomware && <Chip kind="bad">랜섬웨어 사용</Chip>}{v.epssState !== "no_cve" && <small className="block">{epssLabel(v, data.mode === "demo")}</small>}</>),
          td(<>{v.fixedVersion ? <Chip kind="ok">수정 버전 제공</Chip> : <Chip>미확인</Chip>}<small className="block">{unique(group.map((x) => x.fixedVersion ?? "버전 확인 필요")).join(", ")}</small></>),
        ];
      })} /> : <Empty reset={() => { setVulnSearch(""); setVulnSeverity("all"); setVulnKev("all"); setVulnException("exclude"); }}>현재 필터에 해당하는 취약점이 없습니다.</Empty>}</section>
      <p className="hint sp-footnote">{data.mode === "demo" ? "이미지 패키지 검사 범위의 예시입니다." : "이미지 패키지 검사 범위입니다."} 노드 OS·커널·Kubernetes 자체의 CVE까지 검사했다는 의미는 아닙니다.</p>
      </>}
      {data.runningImages && <RunningImages rows={data.runningImages.filter((r) => environment === "all" || r.environment === environment)} />}
    </Section> : tab === "findings" ? <>
      <Section title="발견 항목" sub="우선순위 목록 밖의 항목까지, 모든 유형을 찾아봅니다.">
        <div className="sp-filters"><label className="sp-search">항목 검색<input aria-label="발견 항목 검색" placeholder="제목, 리소스 또는 출처" value={findingSearch} onChange={(e) => setFindingSearch(e.target.value)} /></label><label>유형<select aria-label="발견 항목 유형" value={findingKind} onChange={(e) => setFindingKind(e.target.value)}><option value="all">전체 유형</option>{Object.entries(KIND).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
        <div className="sp-filters">
          <label>심각도<select aria-label="발견 항목 심각도" value={findingSeverity} onChange={(e) => setFindingSeverity(e.target.value)}><option value="all">전체 심각도</option>{Object.entries(SEVERITY).map(([id, [label]]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>원본 분류<select aria-label="발견 항목 분류" value={findingCategory} onChange={(e) => setFindingCategory(e.target.value)}><option value="all">전체 분류</option>{CATEGORIES.map((id) => <option key={id} value={id}>{CATEGORY_LABEL[id]}</option>)}</select></label>
          <ExceptionFilter value={findingException} onChange={setFindingException} />
        </div>
        {data.mode === "live" && <p className="hint">심각도마다 산정 주체(벤더 등급 또는 HopCharlie 정책)와 정책 버전을 상세에 표시합니다. 설정 점검에는 임의 점수를 붙이지 않습니다.</p>}
        <FindingsList findings={findings} vulnerabilities={vulnerabilities} search={findingSearch} kind={findingKind} severity={findingSeverity} category={findingCategory} exception={findingException} reset={() => { setFindingSearch(""); setFindingKind("all"); setFindingSeverity("all"); setFindingCategory("all"); setFindingException("exclude"); }} />
      </Section>
      <SecurityStorageKeys keys={data.storageKeys?.filter((k) => (environment === "all" || k.environment === environment) && (app === "all" || k.app === app))} sources={data.storageKeySources.filter((s) => environment === "all" || s.environment === environment)} />
    </> : tab === "ocsf" ? <Section title="OCSF 내보내기">
      <SecurityOCSF live={data.mode === "live"} environment={environment === "all" ? undefined : environment} app={app === "all" ? undefined : app} />
    </Section> : <Section title="수집 상태" sub="결과를 읽었다는 것과 모든 검사를 통과했다는 것은 다릅니다.">
      <div className="sp-source-summary"><b>선택 환경의 출처 {sources.length}개</b><span>수집 완료 {sources.filter((s) => s.status === "ok").length} · 그 외 {missingSources.length}</span><small>앱 필터와 관계없이 환경 수준의 수집 범위를 표시합니다.</small></div>
      <div className="box sp-table-box"><Table head={["출처 / 환경", "상태", "점검 범위", "수집 / 검사 시각"]} rows={sources.map((s) => [td(<><b>{s.name}</b><small className="block"><SecurityEnvLabel env={s.environment} /></small></>), td(<Chip kind={SOURCE_STATUS[s.status][1]}>{SOURCE_STATUS[s.status][0]}</Chip>), td(<>{s.scope}<small className="block">{s.detail}</small>{s.scannerVersion && <small className="block m">엔진 {s.scannerVersion}</small>}{s.databaseUpdatedAt && <small className="block">DB 기준 {date(s.databaseUpdatedAt)}</small>}</>), td(<ScanTimes collected={s.lastCollected} scanned={s.lastScanned} />, "nw")])} /></div>
      <div className="sp-method"><b>미확인 상태를 숨기지 않습니다</b><p>스캔 실패나 미지원은 발견 0건이 아닙니다. 결과 조회와 실제 재검사는 별개이며, 이 화면은 스캔 Job이나 정책 변경을 실행하지 않습니다.</p></div>
    </Section>}
    <footer className="sp-footer"><span>HopCharlie · 보안·거버넌스</span><span>{data.mode === "demo" ? "시연 데이터" : "실제 API 조회"} · 읽기 전용 · 스캔 / 정책 변경 없음</span></footer>
  </div>;
}

function FindingsList({ findings, vulnerabilities, search, kind, severity, category, exception, reset }: { findings: SecurityFindingRow[]; vulnerabilities: VulnerabilityFinding[]; search: string; kind: string; severity: string; category: string; exception: ExceptionMode; reset: () => void }) {
  const shownFindings = findings.filter((f) => (kind === "all" || f.kind === kind) && (severity === "all" || f.severity === severity) && (category === "all" || f.category === category) && matches(search, f.title, f.resource, f.source) && exceptionShown(exception, f.exception));
  const shownVulnerabilities = vulnerabilities.filter((v) => (kind === "all" || kind === "vulnerability") && (severity === "all" || v.severity === severity) && category === "all" && matches(search, v.advisory, v.package) && exceptionShown(exception, v.exception));
  const excepted = [...shownFindings, ...shownVulnerabilities].map((x) => activeException(x.exception));
  const rows = [
    ...shownFindings.map((f) => [td(<Severity value={f.severity} />), td(<>{KIND[f.kind]}{f.category && <small className="block">{CATEGORY_LABEL[f.category]}</small>}</>), td(<><a className="sp-row-link" href={detailHref("findings", f.id)}>{f.title}</a><small className="block">{f.source}</small><ExceptionChip value={f.exception} /></>), td(<SecurityEnvLabel env={f.environment} />), td(<span className="m">{f.resource}</span>)]),
    ...shownVulnerabilities.map((v) => [td(<Severity value={v.severity} />), td("취약점"), td(<><a className="sp-row-link" href={detailHref("vulnerabilities", v.id)}>{v.advisory} · {v.package}</a><small className="block">패키지 발생 건 · {v.installedVersion}</small><ExceptionChip value={v.exception} /></>), td(<SecurityEnvList environments={v.occurrences.map((o) => o.environment)} />), td(<span className="m">{v.imageDigest.slice(0, 23)}…</span>)]),
  ];
  return <><p className="sp-list-meta">표시 {rows.length}건 <span>· 취약점은 이미지별 패키지 발생 건으로 포함</span></p><div className="box sp-table-box">{rows.length ? <Table head={["심각도", "유형", "항목 / 출처", "환경", "대상 리소스"]} rows={rows} rowClass={(i) => excepted[i] ? "sp-excepted" : undefined} /> : <Empty reset={reset}>현재 필터에 해당하는 발견 항목이 없습니다.</Empty>}</div></>;
}

type HeadingRef = { current: HTMLHeadingElement | null };
function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return <section className="box sp-detail-block"><h3>{title}</h3>{children}</section>;
}

function ControlDetail({ value: c, headingRef, live = false }: { value: ControlEvaluation; headingRef: HeadingRef; live?: boolean }) {
  return <div className="sp-detail"><div className="sp-detail-heading"><Chip kind={STATUS[c.status][1]}>{STATUS[c.status][0]}</Chip><h2 ref={headingRef} tabIndex={-1}>{c.title}</h2><p><SecurityEnvLabel env={c.environment} /> · {domainLabel(c.domain)} · {c.app ?? "계정 / 클러스터 수준"}</p></div>
    <div className="sp-detail-grid"><DetailBlock title="판정 근거"><dl><dt>기준</dt><dd className="m">{c.controlId}</dd><dt>관측 증거</dt><dd>{c.evidence}</dd><dt>평가 시각</dt><dd>{date(c.observedAt)}</dd></dl><EvidenceLink href={c.basisUrl} /></DetailBlock><DetailBlock title="권장 조치"><p>{c.recommendation}</p><p className="hint">공식 통제와 관련된 일부 증거입니다. 이 한 검사로 전체 프레임워크 준수를 보증하지 않습니다.</p></DetailBlock></div>
    <DetailBlock title="처리 이력"><p>{live ? "플랫폼 API의 최신 평가입니다. 예외 승인·수정·재검사 이력은 아직 연결하지 않았습니다." : "시연용 평가 상태입니다. 승인된 예외·실제 수정·재검사 이력은 연결하지 않았습니다."}</p></DetailBlock></div>;
}

function VulnerabilityDetail({ values, selected: v, headingRef, live = false, reload }: { values: VulnerabilityFinding[]; selected: VulnerabilityFinding; headingRef: HeadingRef; live?: boolean; reload?: () => void }) {
  return <div className="sp-detail"><div className="sp-detail-heading"><div className="chips"><Severity value={v.severity} /><Chip kind={v.kev === true ? "warn" : ""}>{kevLabel(v)}</Chip></div><h2 ref={headingRef} tabIndex={-1}>{v.advisory}</h2><p>{v.title}</p></div>
    <div className="sp-detail-grid"><DetailBlock title="판정 근거"><dl><dt>원본 CVSS</dt><dd>{v.cvss === null ? "미확인" : `${v.cvss.toFixed(1)} · v${v.cvssVersion}`}</dd><dt>산정 출처</dt><dd>{v.scoreSource}</dd>{v.cvssVector && <><dt>벡터</dt><dd className="m sp-wrap">{v.cvssVector}</dd></>}<dt>EPSS</dt><dd>{epssLabel(v, !live)}</dd></dl><EvidenceLink href={v.basisUrl}>취약점 원문 보기</EvidenceLink><p className="hint">CVSS는 기술적 심각도, EPSS는 악용 확률의 추정입니다. 우리 앱의 침해 확률을 뜻하지 않습니다.</p></DetailBlock><DetailBlock title="수정과 영향 판단"><p>{v.detail}</p><p>{v.recommendation}</p><dl>{values.map((item) => <div key={item.id}><dt>{item.package} {item.installedVersion}</dt><dd>수정 버전 {item.fixedVersion ?? "미확인 — 공식 배포판 공지 확인 필요"}</dd></div>)}</dl><p className="hint">{live ? "저장된 스캔 결과와 실행 중 digest의 관계입니다. 악용 가능성은 검증하지 않았습니다." : "모든 이미지·실행 관계는 시연용입니다. 실제 패키지 매칭이나 악용 가능성을 검증한 결과가 아닙니다."}</p></DetailBlock></div>
    <DetailBlock title="영향 자산"><p className="hint">같은 이미지는 한 번 세고, 실행 위치는 환경별로 보존합니다.</p>{values.map((item) => <div className="sp-asset-group" key={item.id}><b className="sp-wrap m">{item.imageDigest}</b><Table head={live ? ["앱", "환경", "Namespace / workload", "실행 관계", "배포 기록"] : ["앱", "환경", "Namespace / workload", "실행 관계"]} rows={item.occurrences.map((o) => [td(o.app), td(<SecurityEnvLabel env={o.environment} />), td(<span className="m">{o.namespace} / {o.workload}</span>), td(<Chip kind={o.running === true ? "run" : ""}>{o.running === true ? "실행 중" : o.running === false ? "현재 실행 안 함" : "미확인"}</Chip>), ...(live ? [td(<><DeployedChip value={o.deployed} />{o.deployed?.reason && <small className="block">{o.deployed.reason}</small>}</>)] : [])])} /></div>)}</DetailBlock>
    <DetailBlock title="조치 이력"><p>{live ? "재검사 이력은 아직 연결하지 않았습니다." : "미수정 시나리오입니다. 재검사나 예외 승인은 수행하지 않습니다."} 이미지가 목록에서 사라졌다는 이유만으로 ‘해결’로 처리하지 않습니다.</p>{live && <SecurityExceptionPanel key={v.id} targetType="vulnerability" targetId={v.id} exception={activeException(v.exception) ? v.exception : undefined} kev={v.kev === true} onChange={reload} />}</DetailBlock></div>;
}

function FindingDetail({ value: f, headingRef, live = false, reload }: { value: SecurityFindingRow; headingRef: HeadingRef; live?: boolean; reload?: () => void }) {
  return <div className="sp-detail"><div className="sp-detail-heading"><div className="chips"><Severity value={f.severity} /><Chip>{KIND[f.kind]}</Chip></div><h2 ref={headingRef} tabIndex={-1}>{f.title}</h2><p><SecurityEnvLabel env={f.environment} /> · {f.source}</p></div><div className="sp-detail-grid"><DetailBlock title="판정 근거"><p>{f.detail}</p><dl><dt>리소스</dt><dd className="sp-wrap m">{f.resource}</dd>{f.controlId && <><dt>관련 기준</dt><dd>{f.controlId}</dd></>}{f.check && <><dt>원본 검사 ID</dt><dd className="m">{f.check}</dd></>}{f.severityBasis && <><dt>심각도 근거</dt><dd>{f.severityBasis}</dd></>}<dt>관측 시각</dt><dd>{date(f.observedAt)}</dd></dl>{f.basisUrl ? <EvidenceLink href={f.basisUrl} /> : <p className="hint">원본 API가 공식 통제·문서 URL을 제공하지 않았습니다. 검사 ID는 등급 산정의 공식 표준 ID와 다릅니다.</p>}</DetailBlock><DetailBlock title="권장 조치"><p>{f.recommendation}</p><p className="hint">권장 절차만 표시합니다. 이 화면에서 권한이나 정책을 변경하지 않습니다.</p></DetailBlock></div>{live && <DetailBlock title="예외"><SecurityExceptionPanel key={f.id} targetType="finding" targetId={f.id} exception={activeException(f.exception) ? f.exception : undefined} onChange={reload} /></DetailBlock>}</div>;
}
