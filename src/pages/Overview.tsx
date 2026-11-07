import "../styles/overview.css";
import type { ReactNode } from "react";
import { deploymentRank, useAudit, useRuns, useSecurity } from "../api/hooks";
import { isFinalDeploymentStatus } from "../api/sse";
import type { App, AuditEntry, Run, RunResult } from "../api/types";
import { ago, AppsList, DEPLOY_LABEL, elapsedSec, ms } from "../components/deploy";
import { EnvGrid, EnvLabel, envName, RESULT_KIND, RouteMatrix, RUN_SHORT } from "../components/shared";
import { Icon } from "../components/Icon";
import { Chip, LoadError, PageHead, Skeleton, type ChipKind } from "../components/ui";
import { instancesOf, useLiveApps, useSimApps, type AppsModel } from "../data/deploy";
import { errorText, useLive } from "../data/live";
import { isPrioritySeverity, type SecurityFindingRow } from "../data/security";
import { PRIORITY_FINDINGS } from "../router";
import { SAMPLE } from "../sim/data";
import { dur, fmt } from "../sim/format";
import { iso, statusText, TARGET_SEC } from "../sim/mig";
import { DEMO_SECURITY_FINDINGS } from "../sim/securityWorkspace";
import { migLabel, type SimState } from "../sim/state";
import { useSim } from "../sim/store";

export function Overview() {
  return useLive() ? <LiveOverview /> : <SimOverview />;
}

/** `runs`: the live runs LiveOverview polls, so the route matrix shows the ones in progress too. */
function OverviewView({ now, apps, activity, runs }: { now: ReactNode; apps: AppsModel; activity: ReactNode; runs?: Run[] }) {
  return (
    <div className="page ov">
      <PageHead
        icon="layout-dashboard"
        title="개요"
        sub="team-charlie 프로젝트의 클러스터, 앱, 이전 결과입니다."
        acts={
          <>
            <a className="btn ghost" href="#new">
              <Icon name="upload" size={16} />
              새 앱 배포
            </a>
            <a className="btn primary" href="#migrate-app">
              <Icon name="arrow-right-left" size={16} />
              이전하기
            </a>
          </>
        }
      />
      {now}
      <section className="sec">
        <div className="sech">
          <h2 className="icon-label"><Icon name="server" /><span>클러스터</span></h2>
          <a className="more" href="#envs">
            환경 관리
          </a>
        </div>
        <EnvGrid />
      </section>
      <div className="ov-two">
        <section className="box ov-routes">
          <div className="bh">
            <h2 className="icon-label"><Icon name="route" /><span>경로별 결과</span></h2>
            <span className="hint">목표: {TARGET_SEC / 60}분 이내, 실패 0, 누락 0</span>
          </div>
          <div className="bb">
            <RouteMatrix active={runs?.filter(isActive)} />
          </div>
        </section>
        <section className="box">
          <div className="bh">
            <h2 className="icon-label"><Icon name="activity" /><span>최근 활동</span></h2>
          </div>
          {activity}
        </section>
      </div>
      <section className="sec">
        <div className="sech">
          <h2 className="icon-label"><Icon name="boxes" /><span>앱</span></h2>
          <a className="more" href="#apps">
            전체 보기
          </a>
        </div>
        {apps.error ? (
          <LoadError title="앱 목록을 불러오지 못했습니다." error={apps.error} />
        ) : apps.apps ? (
          <AppsList apps={apps.apps} now={apps.now} busy={apps.busy} full={false} />
        ) : (
          <Skeleton box />
        )}
      </section>
    </div>
  );
}

function SimOverview() {
  const { S } = useSim();
  const apps = useSimApps();
  const m = S.mig;
  const current = m.run;
  // the current run first; once it succeeds, history holds a copy of it
  const runs = current ? [current, ...m.history.filter((r) => r.runId !== current.runId)] : m.history;
  // run times are on the migration's simulated clock
  const items = [...simWork(S), ...deployItems(apps.apps ?? [], apps.now), ...runItems(runs, Date.parse(iso(m.now)), current?.runId), ...securityItems(DEMO_SECURITY_FINDINGS)];
  return <OverviewView now={<NowList items={items} />} apps={apps} activity={<SimActivity />} />;
}

function LiveOverview() {
  const apps = useLiveApps();
  const runs = useRuns(5_000);
  const sec = useSecurity(60_000);
  const items = [...deployItems(apps.apps ?? [], apps.now), ...runItems(runs.data ?? [], Date.now()), ...securityItems(sec.data?.findings)];
  const failed = [runs.error && !runs.data ? "이전 목록" : "", sec.error && !sec.data ? "보안 점검" : "", apps.error ? "앱 목록" : ""].filter(Boolean);
  const loading = runs.loading || sec.loading || (!apps.apps && !apps.error);
  return <OverviewView now={<NowList items={items} loading={loading} failed={failed} />} apps={apps} activity={<LiveActivity />} runs={runs.data} />;
}

/* ---------- what needs attention ---------- */

interface NowItem {
  kind: ChipKind;
  chip: string;
  /** one sentence */
  title: string;
  /** one muted line */
  sub?: ReactNode;
  href: string;
  go: string;
}

/** Waiting on a person first, then problems, work in progress, and finished work last. */
const RANK: Record<ChipKind, number> = { warn: 0, bad: 1, run: 2, "": 3, neu: 3, ok: 4 };

function NowList({ items, loading, failed = [] }: { items: NowItem[]; loading?: boolean; failed?: string[] }) {
  const sorted = [...items].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  // a finished migration is there to read, not to act on
  const open = items.filter((it) => it.kind !== "ok").length;
  return (
    <section className="box">
      <div className="bh">
        <h2 className="icon-label"><Icon name="clipboard-check" /><span>지금 볼 것</span></h2>
        {open > 0 && <span className="hint">{open}건</span>}
      </div>
      {sorted.length > 0 ? (
        <ul className="ov-now">
          {sorted.map((it) => (
            <li key={it.href + it.title}>
              <Chip kind={it.kind}>{it.chip}</Chip>
              <div className="txt">
                <b>{it.title}</b>
                {it.sub && <span>{it.sub}</span>}
              </div>
              <a className="btn ghost" href={it.href}>
                {it.go}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        // with a source missing, "nothing to check" could be wrong: the failure line below says why instead
        failed.length === 0 && (loading ? <Skeleton rows={2} /> : <p className="hint ov-none">지금 확인할 것이 없습니다.</p>)
      )}
      {failed.length > 0 && <p className="hint ov-none">{failed.join(", ")}을 불러오지 못해 빠진 항목이 있을 수 있습니다.</p>}
    </section>
  );
}

/** Deployments not finished yet, one per instance; a queued one waits its turn and is grey. */
function deployItems(apps: App[], now: number): NowItem[] {
  return apps.flatMap((a) =>
    instancesOf(a).flatMap((i): NowItem[] => {
      const d = i.lastDeployment;
      if (!d || isFinalDeploymentStatus(d.status)) return [];
      const queued = d.status === "queued";
      const step = DEPLOY_LABEL[d.status] + " (" + (deploymentRank(d.status) + 1) + "/4단계)";
      const where = "환경 " + (a.deploy?.environments.length ?? 0) + "곳";
      return [
        {
          kind: queued ? "neu" : "run",
          chip: queued ? "배포 대기" : "배포 중",
          title: i.name + (queued ? " 배포가 차례를 기다리고 있습니다" : " 배포가 진행 중입니다"),
          sub: step + ", " + where + ", " + dur(elapsedSec(d, now)) + " 경과",
          href: "#deploy-" + d.id,
          go: "진행 보기",
        },
      ];
    }),
  );
}

const isActive = (r: Run) => r.status === "running" || r.status === "awaiting_switch";
const routeOf = (source: string, target: string) => <><EnvLabel env={source} label={envName(source) + "에서"} /> <EnvLabel env={target} label={envName(target) + "로"} /></>;
// the namespace is the app's name
const whatOf = (r: Run) => r.source.namespace + (r.rollbackOf ? " 롤백" : " 이전");

/**
 * Runs in progress, and the newest finished one if it ended within a day of
 * `now`. `current` is the run the migration page shows (simulation), so its
 * result links to the report there; other finished runs link to the
 * per-route results.
 */
function runItems(runs: Run[], now: number, current?: string): NowItem[] {
  const out = runs.filter(isActive).map(activeItem);
  const last = runs.find((r) => !isActive(r));
  const ended = last && (last.endedAt ?? last.updatedAt);
  if (last && ended && now - ms(ended) < 86_400_000) {
    const item = finishedItem(last, last.runId === current);
    out.push({ ...item, sub: item.sub + ", " + ago(ended, now) + " 끝남" });
  }
  return out;
}

function activeItem(r: Run): NowItem {
  const base = { href: "#migrate-app", go: "진행 보기" };
  const route = routeOf(r.source.env, r.target.env);
  if (r.status === "awaiting_switch") return { ...base, kind: "warn", chip: "전환 대기", title: whatOf(r) + "이 전환 승인을 기다리고 있습니다", sub: <>{route}, 데이터를 맞췄고 전환할 수 있습니다</> };
  return { ...base, kind: "run", chip: r.rollbackOf ? "롤백 중" : "이전 중", title: whatOf(r) + "이 진행 중입니다", sub: <>{route}, {statusText(r.status, r.phase)}</> };
}

function finishedItem(r: Run, current: boolean): NowItem {
  const ok = r.status === "succeeded";
  const link = current ? { href: "#migrate-app", go: ok ? "리포트 보기" : "열기" } : { href: "#routes", go: "결과 보기" };
  const route = routeOf(r.source.env, r.target.env);
  if (ok) return { ...link, kind: "ok", chip: r.rollbackOf ? "롤백 완료" : "이전 완료", title: whatOf(r) + "을 마쳤습니다", sub: <>{route}{resultParts(r.result).map((part) => ", " + part).join("")}</> };
  return {
    ...link,
    kind: RESULT_KIND[r.status] || "neu",
    chip: RUN_SHORT[r.status],
    title: whatOf(r) + (r.status === "rolled_back" ? "이 원복되었습니다" : "이 멈췄습니다"),
    sub: <>{route}, {r.statusReason || statusText(r.status)}</>,
  };
}

export function resultParts(x: RunResult): string[] {
  const missing = (label: string, n: number | undefined) => (n !== undefined ? label + " 누락 " + fmt(n) + "건" : "");
  return [
    x.durationMillis !== undefined ? dur(x.durationMillis / 1000) : "",
    x.downtimeMillis !== undefined ? "쓰기 보류 " + (x.downtimeMillis / 1000).toFixed(1) + "초" : "",
    x.failedRequests !== undefined ? "실패 요청 " + fmt(x.failedRequests) + "건" : "",
    missing("행", x.missingRows),
    missing("쓰기", x.missingWrites),
    missing("파일", x.missingFiles),
  ].filter(Boolean);
}

/** One row for the findings of high severity or worse. */
function securityItems(findings: Pick<SecurityFindingRow, "severity" | "title" | "environment">[] = []): NowItem[] {
  const top = findings.filter((f) => isPrioritySeverity(f.severity));
  if (!top.length) return [];
  const critical = top.filter((f) => f.severity === "critical").length;
  const high = top.length - critical;
  const counts = [critical ? "치명 " + critical + "건" : "", high ? "높음 " + high + "건" : ""].filter(Boolean).join(", ");
  const names = top.slice(0, 2).map((f) => f.title + " (" + envName(f.environment) + ")");
  if (top.length > 2) names.push("외 " + (top.length - 2) + "건");
  return [{ kind: "bad", chip: "보안 발견 항목", title: "발견 항목 · " + counts, sub: names.join(", "), href: "#security/" + PRIORITY_FINDINGS, go: "치명·높음 발견 항목 " + top.length + "건 보기" }];
}

const ONB_STEP = ["", "", "AI 점검 중", "샌드박스 테스트 중", "머지와 배포 중"];

/** Simulation-only work: importing an app, and the AI planning or the plan waiting for approval before a run exists. */
function simWork(S: SimState): NowItem[] {
  const out: NowItem[] = [];
  const o = S.onb;
  if (o.run) out.push({ kind: "run", chip: "가져오는 중", title: "기존 앱 가져오기가 진행 중입니다", sub: ONB_STEP[o.step], href: "#onboard", go: "진행 보기" });
  else if (o.step === 4 && !o.approved)
    out.push({ kind: "warn", chip: "승인 대기", title: "기존 앱 가져오기 PR이 승인을 기다리고 있습니다", sub: "AI가 만든 PR을 확인하고 승인하면 머지와 배포를 시작합니다", href: "#onboard", go: "PR 보기" });
  const m = S.mig;
  const route = routeOf(m.src, m.tgt);
  if (m.stage === "ai") out.push({ kind: "run", chip: "AI 작업 중", title: SAMPLE.id + " 이전 계획을 AI가 만들고 있습니다", sub: <>{route}, {migLabel(S)}</>, href: "#migrate-app", go: "진행 보기" });
  else if (m.stage === "review" && m.plan)
    out.push({ kind: "warn", chip: "승인 대기", title: SAMPLE.id + " 이전 Plan이 승인을 기다리고 있습니다", sub: <>{route}, Plan {m.plan.ref} (revision {m.plan.revision})</>, href: "#migrate-app", go: "Plan 보기" });
  return out;
}

/* ---------- recent activity ---------- */

function SimActivity() {
  const { S } = useSim();
  return (
    <ul className="rows ov-act">
      {S.act.slice(0, 6).map((a, i) => (
        <li key={i}>
          <span className="when">{a[0]}</span>
          <span className="grow">{a[1]}</span>
        </li>
      ))}
    </ul>
  );
}

/** An audit entry in a line: no empty brackets without a role, and the path once (the target is the real one; the action may name its route with {name}). */
export function auditText(a: AuditEntry): string {
  const route = /^(\S+) \/\S*$/.exec(a.action);
  const what = route ? route[1] + " " + (a.target || a.action.slice(route[1].length + 1)) : [a.action, a.target].filter(Boolean).join(" ");
  return (a.role ? a.actor + " (" + a.role + ")" : a.actor) + ": " + what + " → " + a.status;
}

function LiveActivity() {
  const audit = useAudit(6);
  if (audit.error && !audit.data)
    return (
      <div className="ov-none">
        <LoadError title="감사 로그를 불러오지 못했습니다." error={errorText(audit.error)} retry={audit.reload} />
      </div>
    );
  if (!audit.data) return <Skeleton />;
  if (audit.data.length === 0) return <p className="hint ov-none">아직 기록이 없습니다. 배포나 이전을 시작하면 여기에 남습니다.</p>;
  return (
    <ul className="rows ov-act">
      {audit.data.map((a) => (
        <li key={a.id}>
          <span className="when">{new Date(a.time).toLocaleString("ko-KR")}</span>
          <span className="grow">{auditText(a)}</span>
        </li>
      ))}
    </ul>
  );
}
