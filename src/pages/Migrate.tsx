import "../styles/migrate.css";
import { Fragment, useState, type ReactNode } from "react";
import type { AgentEvent, AgentSession, AIRun, PlanAttachment, Run, RunEvent, RunPhase, RunStatus } from "../api/types";
import { useAttachment } from "../data/attachment";
import { blockedOf, runLines, secs, SessionFeed, SessionTable } from "../components/agent";
import { MigrationMapFrame } from "../components/MigrationMapFrame";
import { LiveSourceRetention } from "../components/SourceRetention";
import { measuredWriteMissing, WriteVerification, writeVerificationOf } from "../components/WriteVerification";
import { LiveWriteCollection } from "../components/WriteCollection";
import { EmptyShop, envName, RESULT_KIND, RUN_SHORT } from "../components/shared";
import { ago } from "../components/deploy";
import { Icon } from "../components/Icon";
import { HyperDXLink } from "../components/HyperDXLink";
import { Chip, Ind, LogBox, PageHead, ProgItem, Table, tabId, tabPanelId, Tabs, td, type ChipKind, type TabItem } from "../components/ui";
import { approvalBlock, rehearsing, DEFAULT_START, OBSERVE_DURATIONS, OBSERVE_STEP, PLATFORM_GATE, useLiveMigration, useSimMigration, type MigrationView, type ObserveDuration, type StartOptions } from "../data/migration";
import { useLive } from "../data/live";
import { filesClean, missingOf, verifyReportOf } from "../data/verifyReport";
import type { CheckStatus, PreflightView } from "../data/preflight";
import { dur, fmt, mmss, type StepState } from "../sim/format";
import { CANARY, CANARY_PRESET_ORDER, CANARY_PRESETS, ENGINE_STEPS, statusText, targetReadShare, TARGET_SEC, type CanaryPreset } from "../sim/mig";

const STATUS_KIND: Record<RunStatus, ChipKind> = {
  running: "run",
  awaiting_switch: "warn",
  succeeded: "ok",
  rolled_back: "",
  halted: "bad",
  failed: "bad",
  aborted: "",
  interrupted: "bad",
};

export function RunStatusChip({ r }: { r: Pick<Run, "status" | "phase"> }) {
  return <Chip kind={STATUS_KIND[r.status]}>{statusText(r.status, r.phase)}</Chip>;
}

export function MigrateList() {
  return useLive() ? <LiveList /> : <SimList />;
}
function LiveList() {
  return <MigrateListView v={useLiveMigration()} />;
}
function SimList() {
  return <MigrateListView v={useSimMigration()} />;
}

function MigrateListView({ v }: { v: MigrationView }) {
  const live = v.live;
  return (
    <div className="page">
      <PageHead
        icon="arrow-right-left"
        title="이전"
        sub="가동 중인 앱을 데이터와 함께 다른 클러스터로 옮깁니다. AI가 계획하고 샌드박스에서 리허설한 뒤, 운영자가 승인하면 엔진이 실행합니다."
        acts={
          <>
            <a className="btn primary" href="#migrate-app">
              <Icon name="arrow-right-left" size={16} />
              이전하기
            </a>
            <a className="btn ghost" href="#routes">
              <Icon name="route" size={16} />
              이전 결과
            </a>
          </>
        }
      />
      {!v.ready ? (
        live ? <LiveEmpty notice={v.notice} /> : <EmptyShop />
      ) : (
        <div className="box">
          <Table
            head={["앱", "현재 위치", "상태", ""]}
            rows={[
              [
                td(live ? <b>{v.app}</b> : <a href={"#app-" + v.app}>{v.app}</a>),
                td(v.srcLabel),
                td(
                  v.run ? (
                    <RunStatusChip r={v.run} />
                  ) : v.stage === "review" && v.plan?.status === "approved" ? (
                    <Chip kind={v.preflight?.blocked ? "bad" : "warn"}>{v.preflight?.blocked ? "시작 전 검사에서 막힘" : "승인됨, 시작 전"}</Chip>
                  ) : v.stage === "review" && rehearsing(v) ? (
                    <Chip kind="run">리허설 중</Chip>
                  ) : v.stage === "review" && approvalBlock(v.plan) ? (
                    <Chip kind="bad">승인 불가 (리허설 미통과)</Chip>
                  ) : v.stage === "review" ? (
                    <Chip kind="warn">승인 대기</Chip>
                  ) : v.stage === "ai" ? (
                    <Chip kind="run">AI 작업 중</Chip>
                  ) : v.lastRun ? (
                    <Chip kind={RESULT_KIND[v.lastRun.status] ?? ""}>
                      {"최근 이전 " + RUN_SHORT[v.lastRun.status] + ", " + envName(v.lastRun.source.env) + " → " + envName(v.lastRun.target.env) + ", " + ago(v.lastRun.endedAt ?? v.lastRun.updatedAt, v.now ?? Date.now())}
                    </Chip>
                  ) : (
                    <Chip>이전 전</Chip>
                  ),
                ),
                td(
                  <a className="btn ghost" href={"#migrate-app" + (live ? "?app=" + encodeURIComponent(v.app) : "")}>
                    {v.stage === "setup" ? "이전 설정" : "열기"}
                  </a>,
                ),
              ],
            ]}
          />
        </div>
      )}
      {!live && <p className="hint">이 시연에서는 {v.app}만 이전할 수 있습니다. 한 번 옮긴 뒤 다른 경로로 다시 옮기거나 롤백할 수 있습니다.</p>}
    </div>
  );
}

function LiveEmpty({ notice }: { notice: string }) {
  return (
    <div className="box">
      <div className="empty-state">
        <b>이전할 수 있는 앱을 불러오지 못했습니다.</b>
        <p className="hint">{notice || "플랫폼에 등록된 앱(PLATFORM_APPS_FILE)이 없거나 아직 불러오는 중입니다."}</p>
      </div>
    </div>
  );
}

const GLYPH: Record<string, string> = {
  ok: "M2.5 6.2l2.3 2.3 4.7-5",
  bad: "M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8",
  warn: "M6 2.5v4.2M6 9.1v.1",
  neu: "M3.2 6h5.6",
  shield: "M6 1.8l3.6 1.4v2.9c0 2.2-1.6 3.6-3.6 4.2-2-.6-3.6-2-3.6-4.2V3.2z",
};

/** "neu": ended without a verdict (an inconclusive canary step, an observation that stopped early). */
type MarkSt = StepState | "warn" | "neu";

/** A small state glyph: check, cross, "!", a dash (no verdict), an open circle (not yet), or the running spinner. `round` puts it on a tinted disc. */
function Mark({ st, round, glyph }: { st: MarkSt; round?: boolean; glyph?: string }) {
  const k = glyph ?? st;
  return (
    <span className={(round ? "mg-ic " : "mg-mark ") + st} aria-hidden="true">
      {st === "run" ? (
        <Ind st="run" />
      ) : (
        <svg viewBox="0 0 12 12">{k === "wait" ? <circle cx="6" cy="6" r="3.4" /> : <path d={GLYPH[k]} />}</svg>
      )}
    </span>
  );
}

/** A number with its label and a note; `ok` marks it against its target (true met, false missed, undefined not judged). */
function Num({ label, value, note, ok, children }: { label: string; value: ReactNode; note?: ReactNode; ok?: boolean; children?: ReactNode }) {
  return (
    <div className={"mg-num" + (ok === true ? " ok" : ok === false ? " bad" : "")}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && (
        <small>
          {ok !== undefined && <Mark st={ok ? "ok" : "bad"} />}
          {note}
        </small>
      )}
      {children}
    </div>
  );
}

const WIZ = ["AI 계획", "리허설", "승인", "실행"];
function wizStep(v: MigrationView): number {
  if (v.stage === "ai") return v.plan ? 2 : 1;
  if (v.stage === "review") return 3;
  if (v.run && !["running", "awaiting_switch"].includes(v.run.status)) return 5;
  return 4;
}

function Wizard({ v }: { v: MigrationView }) {
  const cur = wizStep(v);
  return (
    <ol className="wiz">
      {WIZ.map((l, i) => {
        const n = i + 1;
        return (
          <li key={l} className={n < cur ? "done" : n === cur ? "cur" : ""}>
            <span className="n">{n}</span>
            <span>{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Notice({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="box fillbox" role="alert">
      <div className="bb">
        <p>{text}</p>
      </div>
    </div>
  );
}

/** Live: which app the page migrates. Switching leaves the run or plan on screen; the other app's own work is picked up. */
/** The header actions of the setup and the run pages: "open in HyperDX" (live data only, since the demo's app is not in any log) and the app picker. */
function HeadActs({ v }: { v: MigrationView }) {
  return (
    <>
      {v.live && <HyperDXLink text={v.app} />}
      <AppPick v={v} />
    </>
  );
}

function AppPick({ v }: { v: MigrationView }) {
  if (!v.apps || !v.setApp) return null;
  const setApp = v.setApp;
  return (
    <label className="mg-apppick">
      <span>앱</span>
      <select aria-label="이전할 앱" value={v.app} disabled={v.busy} onChange={(e) => setApp(e.target.value)}>
        {v.apps.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Migrate() {
  return useLive() ? <LiveMigrate /> : <SimMigrate />;
}
function LiveMigrate() {
  return <MigrateView v={useLiveMigration()} />;
}
function SimMigrate() {
  return <MigrateView v={useSimMigration()} />;
}

// The setup screen's order: one line each, the full text folded below.
const PROG: [string, string, string, string][] = [
  ["AI 계획", "읽기 전용 도구로 두 클러스터를 조회해 Plan을 만듭니다.", "AI가 읽기 전용 도구로 두 클러스터를 조회하고 엔진 Plan을 만듭니다. 플랫폼이 검사한 뒤 승인 대기로 올립니다.", "자동"],
  ["리허설", "샌드박스에서 미리 실행하고, 실패하면 AI가 고칩니다.", "대상 클러스터의 격리된 샌드박스에서 테스트 데이터로 미리 실행합니다. 실패하면 AI가 원인을 진단하고 수정안을 Plan 첨부로 올립니다.", "자동"],
  ["승인", "화면에 보이는 Plan revision을 운영자가 승인합니다.", "화면에 보이는 Plan revision을 승인합니다. 그사이 첨부가 바뀌면 승인이 거절되고 다시 확인해야 합니다.", "운영자"],
  [
    "시작 전 검사",
    "레지던시와 대상 용량을 확인한 뒤 시작합니다.",
    "플랫폼이 원본의 전체 테이블과 버킷을 데이터 레지던시 정책에 대보고, 대상 접속 한도와 대기 서버 설정(대상이 원본의 대기 서버로 뜰 수 있는지)을 원본과 비교하고, 복제 따라잡기를 몇 초 동안 잽니다. 명백히 실패할 이전은 시작하지 않습니다.",
    "자동",
  ],
  [
    "실행",
    "동기화, 읽기 카나리, 전환, 검증 순서로 진행합니다.",
    "동기화(사전 확인, 대상 준비, 초기 복사, 변경분)를 마치면 읽기 카나리로 읽기 일부를 대상에 보내 봅니다(기본 " +
      CANARY.weights.join("%, ") +
      "%, 승인할 때 7단계 점진 카나리 선택 가능). 그다음 전환 승인을 기다리고, 승인하면 쓰기 보류, 승격, 전환을 거쳐 검증합니다.",
    "3분 이내",
  ],
];

function MigrateView({ v }: { v: MigrationView }) {
  const live = v.live;
  const { gkeDemoApp, setApp } = v;
  const title = (v.app || "앱") + " 이전";
  if (!v.ready) {
    return (
      <div className="page">
        <PageHead icon="arrow-right-left" title={title} />
        {live ? <LiveEmpty notice={v.notice} /> : <EmptyShop />}
      </div>
    );
  }

  // The map keeps one element (key "map") under the same page from the setup to the end of the run, so the
  // iframe is not reloaded when the plan starts: the flow carries on in the same map.
  const page = (top: ReactNode, map: ReactNode, bottom: ReactNode) => (
    <div className="page">{[<Fragment key="top">{top}</Fragment>, <Fragment key="map">{map}</Fragment>, <Fragment key="bottom">{bottom}</Fragment>]}</div>
  );

  if (v.stage === "setup") {
    // the database pair's readiness (ADR 0037): only a sure refusal stops the buttons; app_degraded leaves the AI, which can pick cold mode
    const pc = v.pairCheck;
    const stopAI = pc?.stop === "all";
    const stopManual = pc?.stop === "all" || pc?.stop === "manual";
    return page(
      <>
        <PageHead icon="arrow-right-left" title={title} sub="가동 중인 앱을 데이터와 함께 옮깁니다." acts={<HeadActs v={v} />} />
        <Notice text={v.notice} />
        <div className="split">
          <div className="box">
            <div className="bh">
              <b>이전 설정</b>
            </div>
            <div className="bb">
              <div className="form">
                <div className="field">
                  <label htmlFor="mig-src">원본</label>
                  <input id="mig-src" value={v.srcLabel + (v.srcNote ? "" : " (지금 쓰기를 받는 곳)")} readOnly aria-describedby={v.srcNote ? "mig-src-note" : undefined} />
                  {v.srcNote && <small id="mig-src-note">{v.srcNote}</small>}
                </div>
                <div className="field">
                  <label htmlFor="mig-target">옮겨 갈 환경</label>
                  <select
                    id="mig-target"
                    value={v.tgt}
                    onChange={(e) => v.setTarget(e.target.value)}
                    aria-describedby={gkeDemoApp && setApp ? "mig-gke-demo-note" : undefined}
                  >
                    {v.targets.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {gkeDemoApp && setApp && (
                    <>
                      <small id="mig-gke-demo-note">현재 앱에는 GKE 대상이 등록되어 있지 않습니다.</small>
                      <div>
                        <button type="button" className="btn sm ghost" disabled={v.busy} onClick={() => setApp(gkeDemoApp)}>
                          시연용 moimroom-mig 열기
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="box">
            <div className="bh">
              <b>진행 순서</b>
            </div>
            <ul className="prog">
              {PROG.map(([t, short, , right]) => (
                <ProgItem key={t} st="wait" title={t} sub={short} right={right} />
              ))}
            </ul>
            <details className="fold mg-fold mg-progmore">
              <summary className="bh">
                <span className="hint">단계별 자세한 설명</span>
              </summary>
              <dl className="kv bb">
                {PROG.map(([t, , full]) => (
                  <Pair key={t} k={t} v={full} />
                ))}
              </dl>
            </details>
          </div>
        </div>
        {v.live && v.app && <LiveWriteCollection key={v.app} app={v.app} />}
        {pc && (
          <div className="box fillbox" role="status" id="mig-blocked">
            <div className="bb">
              <p>{pc.text}</p>
              {pc.runId && v.openRun && (
                <button type="button" className="btn sm ghost" onClick={() => v.openRun!(pc.runId!)}>
                  진행 중인 이전 보기
                </button>
              )}
            </div>
          </div>
        )}
        {!live || v.aiRun?.available ? (
          <div className="actrow">
            <button
              type="button"
              className="btn primary"
              disabled={v.busy || !v.tgt || v.aiRun?.running || stopAI}
              onClick={live ? v.aiRun?.start : v.makePlan}
              aria-describedby={pc ? "mig-blocked" : undefined}
            >
              <Icon name="bot" size={16} />
              {v.aiRun?.running ? "AI 실행 중" : "AI 계획·리허설 실행"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!live || v.busy || !v.tgt || stopManual}
              onClick={v.makePlan}
              aria-describedby={!live ? "mig-demo-plan-why" : pc ? "mig-blocked" : undefined}
            >
              <Icon name="clipboard-check" size={16} />
              AI 없이 Plan 작성
            </button>
            <span className="hint" id={!live ? "mig-demo-plan-why" : undefined}>
              {live
                ? "플랫폼이 AI 실행기를 띄워 두 클러스터를 조회해 계획하고, 샌드박스에서 리허설한 뒤 승인 대기로 올립니다(3~5분). 진행은 이 화면에 실시간으로 나옵니다."
                : "데모는 AI 계획·리허설 시나리오를 로컬에서 재현합니다. AI 없이 Plan을 작성하는 기능은 지원하지 않습니다. 실제 AI 실행기나 클라우드를 호출하지 않습니다."}
              <AIRunLine run={v.aiRun?.latest} />
            </span>
          </div>
        ) : (
          <div className="actrow">
            <button type="button" className="btn primary" disabled={v.busy || !v.tgt || stopManual} onClick={v.makePlan} aria-describedby={pc ? "mig-blocked" : undefined}>
              <Icon name="clipboard-check" size={16} />
              Plan 작성
            </button>
            <span className="hint">
              AI 없이 플랫폼이 설정에서 Plan 초안을 만들고 승인 대기로 올립니다. AI로 계획하려면 AI 실행기(hopai run)를 시작하세요. 계획을 시작하면 이 화면에 AI 작업이 실시간으로 나옵니다.
            </span>
          </div>
        )}
      </>,
      <MigrationMapFrame v={v} />,
      null,
    );
  }

  const where = v.stage === "run" && v.run ? ", " + (v.run.rollbackOf ? "롤백 " : "") + v.run.runId : v.plan ? ", Plan " + v.plan.ref : "";
  const r = v.stage === "run" ? v.run : undefined;
  const hero = r ? heroText(v, r, r.result.durationMillis !== undefined ? r.result.durationMillis / 1000 : secs(r.startedAt, r.endedAt ?? r.updatedAt)) : undefined;
  return page(
    <>
      <PageHead icon="arrow-right-left" title={title} sub={v.srcLabel + " → " + v.tgtLabel + where} acts={<HeadActs v={v} />} />
      <Wizard v={v} />
      <Notice text={v.notice} />
    </>,
    <MigrationMapFrame v={v} hero={hero} />,
    r ? <RunView v={v} r={r} /> : <AiView v={v} />,
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

/* ---------- AI plan, rehearsal, approval ---------- */

// Live: the AI runner's plan session before any Plan exists. It stays on screen after it ends until its Plan arrives.
function PlanBox({ v }: { v: MigrationView }) {
  const s = v.live ? v.sessions[0] : undefined;
  const failed = s?.status === "failed" || s?.status === "cancelled";
  const done = s?.status === "succeeded";
  return (
    <div className="box">
      <div className="bh">
        <b>Plan</b>
        {failed ? <Chip kind="bad">AI 계획 실패</Chip> : <Chip kind={done ? "neu" : "run"}>{done ? "제출 기다리는 중" : "AI 작성 중"}</Chip>}
      </div>
      <div className="bb">
        <p className="hint">
          {failed
            ? "AI가 Plan을 내지 못하고 끝났습니다" + (s?.summary ? ": " + s.summary : "") + ". 아래 기록에서 이유를 확인하고 AI 실행기를 다시 시작하거나, 설정으로 돌아가 Plan을 작성하세요."
            : done
              ? "AI가 계획을 마쳤습니다. 제출된 Plan이 오면 승인 단계로 넘어갑니다."
              : "AI가 두 클러스터를 조회하고 있습니다."}
        </p>
        {s && s.status !== "running" && (
          <div className="actrow">
            <button type="button" className="btn ghost" onClick={v.reset}>
              설정으로 돌아가기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The Plan record on screen: endpoints, files, gateway, attachments and the engine plan itself. */
function PlanFacts({ v }: { v: MigrationView }) {
  const p = v.plan;
  if (!p) return <p className="hint">이 run의 Plan을 찾지 못했습니다.</p>;
  const s = p.summary;
  return (
    <>
      <dl className="kv">
        <dt>Plan</dt>
        <dd>
          <span className="m">{p.ref}</span> <Chip kind={p.status === "pending_approval" ? "warn" : p.status === "rejected" ? "bad" : "ok"}>{PLAN_STATUS[p.status]}</Chip>
        </dd>
        <dt>revision</dt>
        <dd className="m">{p.revision}</dd>
        <dt>원본</dt>
        <dd className="m">
          {s.source.env} / {s.source.namespace} / {s.source.cluster}
          {s.source.dbHost ? " (" + s.source.dbHost + ")" : ""}
        </dd>
        <dt>대상</dt>
        <dd className="m">
          {s.target.env} / {s.target.namespace} / {s.target.cluster}
          {s.target.dbHost ? " (" + s.target.dbHost + ")" : ""}
        </dd>
        <dt>파일 이전</dt>
        <dd>{s.files ? "함께 옮김 (rclone)" : "옮기지 않음"}</dd>
        <dt>게이트웨이</dt>
        <dd className="m">{s.gatewayMode}</dd>
        <dt>쓰기 보류 상한</dt>
        <dd className="m">{s.maxDowntime}</dd>
        <dt>첨부</dt>
        <dd>{p.attachments?.length ? p.attachments.map((a) => a.name + " (" + fmt(a.size) + "B)").join(", ") : "없음"}</dd>
        <dt>제출</dt>
        <dd>{p.submittedBy}</dd>
      </dl>
      {v.engine && (
        <details className="fold">
          <summary>엔진 Plan 원문</summary>
          <pre className="code">{JSON.stringify(v.engine, null, 2)}</pre>
        </details>
      )}
    </>
  );
}

const AI_RUN_STATUS = { running: "실행 중", succeeded: "끝남", failed: "실패" } as const;

// The latest AI runner Job for the app, on one line.
function AIRunLine({ run }: { run?: AIRun }) {
  if (!run) return null;
  return (
    <>
      {" "}
      최근 실행: {run.source} → {run.target}, {AI_RUN_STATUS[run.status]} ({run.requestedBy}, {new Date(run.createdAt).toLocaleTimeString("ko-KR")})
      {run.status === "failed" ? ". 실패 이유는 아래 AI 세션 기록에 있습니다." : ""}
    </>
  );
}

// An AI plan that has not passed its rehearsal: the platform refuses to approve it (platform #24), so
// the card offers no approve button, only the reason and a reject.
function BlockedApproveBox({ v, reason }: { v: MigrationView; reason: string }) {
  if (!v.plan) return null;
  return (
    <div className="box">
      <div className="bh">
        <b>승인</b>
        <Chip kind={rehearsing(v) ? "run" : "bad"} dot>
          {rehearsing(v) ? "리허설 중" : "승인 불가"}
        </Chip>
      </div>
      <div className="bb">
        <b>
          {rehearsing(v)
            ? `Plan ${v.plan.ref} (revision ${v.plan.revision})을 AI 실행기가 샌드박스에서 리허설하고 있습니다. 통과하면 승인할 수 있습니다.`
            : `Plan ${v.plan.ref} (revision ${v.plan.revision})은 AI가 제출했지만 리허설을 통과하지 않아 승인할 수 없습니다.`}
        </b>
        <p className="hint">플랫폼이 이유를 이렇게 남겼습니다: {reason}</p>
        <p className="hint">
          {v.aiRun?.available
            ? "AI로 다시 계획하고 리허설하면, 통과한 새 Plan이 승인 대기로 올라옵니다. 이 Plan은 반려하세요."
            : "AI 실행기(hopai run)로 다시 계획하고 리허설하면, 통과한 새 Plan이 승인 대기로 올라옵니다. 이 Plan은 반려하세요."}
          <AIRunLine run={v.aiRun?.latest} />
        </p>
        <div className="mg-decide">
          {v.aiRun?.available && (
            <button type="button" className="btn primary lg" disabled={v.busy || v.aiRun.running} onClick={v.aiRun.start}>
              <Icon name="bot" />
              {v.aiRun.running ? "AI 실행 중" : "AI로 다시 계획·리허설"}
            </button>
          )}
          <button type="button" className="btn ghost" disabled={v.busy} onClick={v.reject}>
            <Icon name="x" size={16} />
            반려
          </button>
        </div>
      </div>
    </div>
  );
}

const PLAN_STATUS = { pending_approval: "승인 대기", approved: "승인됨", rejected: "반려됨", starting: "시작 중", started: "실행됨" } as const;

// The decision column: what the start will do, the options, and approve or reject.
function ApproveBox({ v }: { v: MigrationView }) {
  if (v.stage !== "review" || !v.plan) return null;
  if (v.plan.status === "approved") return <StartAgainBox v={v} />;
  const blocked = approvalBlock(v.plan);
  if (blocked) return <BlockedApproveBox v={v} reason={blocked} />;
  const s = v.plan.summary;
  return (
    <div className="box">
      <div className="bh">
        <b>승인</b>
        <Chip kind="warn" dot>
          승인 대기
        </Chip>
      </div>
      <div className="bb">
        <b>
          Plan {v.plan.ref} (revision {v.plan.revision})을 승인할까요?
        </b>
        <dl className="kv">
          <dt>경로</dt>
          <dd>
            {v.srcLabel} → {v.tgtLabel}
          </dd>
          <dt>파일</dt>
          <dd>{s.files ? "함께 옮김 (rclone)" : "옮기지 않음"}</dd>
          <dt>실행 방식</dt>
          <dd>
            {s.gatewayMode === "http"
              ? "동기화 뒤 읽기 요청 " +
                (v.start ? CANARY_PRESETS[v.start.options.canary] : CANARY).weights.join("%, ") +
                "%를 대상으로 보내며 단계마다 게이트(오류율, p95 지연)를 확인합니다. 게이트가 실패하면 읽기를 원본으로 되돌리고 원복합니다."
              : "플랫폼 게이트웨이(http)를 거치지 않는 Plan이라 카나리 없이 동기화 뒤 바로 전환 승인을 기다립니다."}
          </dd>
          <dt>전환</dt>
          <dd>데이터가 맞으면 전환 승인을 기다립니다. 전환 버튼을 누르면 쓰기를 잠시 붙잡고 대상을 승격합니다 (상한 {s.maxDowntime}).</dd>
          <dt>원복</dt>
          <dd>
            대상 승격을 요청하기 전까지는 실패하면 원본으로 자동 원복합니다. 그 뒤에는 원복하지 않고 멈추고(halted) 운영자가 판단합니다.
            {v.start?.options.observe &&
              s.gatewayMode === "http" &&
              (v.start.options.autoRollback
                ? " 전환이 끝난 뒤 관찰 중에 게이트를 어기면 플랫폼이 롤백 run을 시작합니다(자동 롤백)."
                : " 전환이 끝난 뒤 관찰 중에 게이트를 어기면 위반을 기록하고, 롤백은 운영자가 정합니다.")}
          </dd>
          <StartOptionsFields v={v} />
        </dl>
        <div className="mg-decide">
          <button type="button" className="btn primary lg" disabled={v.busy} onClick={v.approve}>
            <Icon name="check" />
            승인하고 시작
          </button>
          <button type="button" className="btn ghost" disabled={v.busy} onClick={v.reject}>
            <Icon name="x" size={16} />
            반려
          </button>
        </div>
        <p className="hint">승인하는 사이에 Plan 첨부가 바뀌면 승인이 거절되고, 바뀐 내용을 다시 확인해야 합니다.</p>
      </div>
    </div>
  );
}

const DURATION_LABEL: Record<ObserveDuration, string> = { "1m": "1분", "2m": "2분", "5m": "5분", "10m": "10분" };

const CANARY_NAME: Record<CanaryPreset, string> = { quick: "빠른 카나리", gradual: "점진 카나리" };

function canaryLabel(p: CanaryPreset): string {
  const c = CANARY_PRESETS[p];
  return `${CANARY_NAME[p]}: ${c.weights.join("% → ")}% (단계마다 ${c.stepSec}초, 약 ${c.weights.length * c.stepSec}초)`;
}

// Canary steps, observe and auto rollback for the start (platform CanaryOptions, ObserveOptions).
// The simulation shows the same controls, locked to the canary it actually runs; observe is not modelled.
// `locked` resends a start that did not finish: the platform may already have started it under the same
// Idempotency-Key and then answers with that run, so changed options would be ignored without a word.
function StartOptionsFields({ v, locked = false }: { v: MigrationView; locked?: boolean }) {
  if (!v.plan || (v.live && !v.start)) return null;
  const o = v.start?.options ?? DEFAULT_START;
  const set = (options: StartOptions) => v.start?.set(options);
  const off = v.busy || locked || !v.start;
  if (v.plan.summary.gatewayMode !== "http")
    return (
      <>
        <dt>전환 후 관찰</dt>
        <dd className="hint">플랫폼 게이트웨이(http)를 거치지 않는 Plan이라 읽기 카나리, 전환 후 관찰과 자동 롤백을 쓸 수 없습니다.</dd>
      </>
    );
  return (
    <>
      <dt>읽기 카나리</dt>
      <dd>
        {!v.live && <p className="hint">데모는 빠른 카나리(10% → 50% → 100%)만 실행합니다. 전환 후 관찰과 자동 롤백은 지원하지 않습니다.</p>}
        <label className="check">
          <select aria-label="읽기 카나리" value={o.canary} disabled={off} onChange={(e) => set({ ...o, canary: e.target.value as CanaryPreset })}>
            {CANARY_PRESET_ORDER.map((p) => (
              <option key={p} value={p}>
                {canaryLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          {o.canary === "gradual"
            ? "트래픽이 많은 운영 앱에 맞는 단계입니다. 요청이 " + PLATFORM_GATE.minRequests + "개보다 적은 단계(예: 1%)는 판정하지 않고 넘어가고, 마지막 단계는 반드시 판정합니다."
            : "세 단계로 빠르게 확인합니다. 요청이 " + PLATFORM_GATE.minRequests + "개보다 적은 단계는 판정하지 않고 넘어가고, 마지막 단계(100%)는 반드시 판정합니다."}
        </p>
      </dd>
      <dt>전환 후 관찰</dt>
      <dd>
        <label className="check">
          <input type="checkbox" checked={o.observe} disabled={off} onChange={(e) => set({ ...o, observe: e.target.checked, autoRollback: e.target.checked && o.autoRollback })} /> 전환 뒤에도
          대상을 게이트로 계속 판정
        </label>
        {(o.observe || !v.live) && (
          <div className="obsopts">
            <label className="check">
              관찰 시간
              <select aria-label="관찰 시간" value={o.duration} disabled={off} onChange={(e) => set({ ...o, duration: e.target.value as ObserveDuration })}>
                {OBSERVE_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {DURATION_LABEL[d]}
                  </option>
                ))}
              </select>
              {OBSERVE_STEP.replace("s", "초")}마다 판정
            </label>
            <label className="check">
              <input type="checkbox" checked={o.autoRollback} disabled={off} onChange={(e) => set({ ...o, autoRollback: e.target.checked })} /> 게이트를 어기면 바로 롤백
            </label>
            <p className="hint">
              {!v.live
                ? "관찰 시간과 자동 롤백은 일반 모드에서 설정할 수 있습니다. 데모에서는 값을 변경하거나 해당 동작을 실행하지 않습니다."
                : o.autoRollback
                ? "게이트를 어긴 단계가 나오면 플랫폼이 바로 롤백 run을 시작합니다(행위자 slo-guard). 롤백은 데이터를 원본으로 다시 옮기는 전체 이전입니다."
                : "게이트를 어긴 단계가 나오면 관찰을 멈추고 위반을 기록합니다. 롤백할지는 운영자가 정합니다."}{" "}
              게이트 기준은 플랫폼 기본값(오류율 {PLATFORM_GATE.maxErrorRate * 100}% 이하, p95 {PLATFORM_GATE.maxP95Millis}ms 이하)이고, 요청이{" "}
              {PLATFORM_GATE.minRequests}개보다 적은 단계는 판정하지 않고 넘어갑니다.
            </p>
          </div>
        )}
        {locked && <p className="hint">끝나지 않은 시작 요청을 같은 옵션으로 다시 보냅니다. 앞선 요청이 이미 처리됐다면 플랫폼은 그 run을 돌려주므로, 옵션을 바꾸려면 새 Plan을 작성하세요.</p>}
      </dd>
    </>
  );
}

// An approved plan without a run: its start was refused by a pre-start check, or did not finish.
// Approving it again is a no-op on the platform, so "다시 시작" reuses the approve-and-start action.
function StartAgainBox({ v }: { v: MigrationView }) {
  const p = v.plan!;
  const blocked = v.preflight?.blocked;
  return (
    <div className="box">
      <div className="bh">
        <b>승인</b>
        <Chip kind={blocked ? "bad" : "warn"} dot={!blocked}>
          {blocked ? "시작 전 검사에서 막힘" : "승인됨, 시작 전"}
        </Chip>
      </div>
      <div className="bb">
        <b>
          Plan {p.ref} (revision {p.revision})은 승인됐지만 시작하지 않았습니다.
        </b>
        <p className="hint">
          {blocked
            ? "시작 전 검사에서 막혔습니다. 검사 결과의 이유를 해결한 뒤(레지던시 정책이나 대상 설정 변경 등) 다시 시작하세요. 해결하지 않고 다시 시작하면 같은 이유로 막힙니다."
            : "시작 요청이 끝나지 않았습니다. 다시 시작할 수 있습니다."}
        </p>
        <dl className="kv">
          {/* a start refused by a pre-start check stored no Idempotency-Key, so its options may change */}
          <StartOptionsFields v={v} locked={!blocked} />
        </dl>
        <div className="mg-decide">
          <button type="button" className="btn primary lg" disabled={v.busy} onClick={v.approve}>
            <Icon name="play" />
            다시 시작
          </button>
          <button type="button" className="btn ghost" disabled={v.busy} onClick={v.reset}>
            <Icon name="clipboard-check" size={16} />
            새 Plan 작성
          </button>
        </div>
      </div>
    </div>
  );
}

const CHECK_CHIP: Record<CheckStatus, [ChipKind, string]> = {
  pass: ["ok", "통과"],
  fail: ["bad", "차단"],
  unknown: ["", "측정 못 함"],
  info: ["", "참고"],
  skip: ["", "건너뜀"],
};

function CheckChip({ s }: { s: CheckStatus }) {
  const [kind, text] = CHECK_CHIP[s];
  return <Chip kind={kind}>{text}</Chip>;
}

/** "3/3 통과": checks that judged something (info and skipped ones do not), for the run's record tab. */
function preflightCount(p: PreflightView): [ChipKind, string] {
  if (p.blocked) return ["bad", "막힘"];
  const checks = [p.residency, p.capacity].flatMap((x): { status: CheckStatus }[] => (x.items.length ? x.items : [x])).filter((c) => c.status !== "skip" && c.status !== "info");
  if (!checks.length) return ["", "검사 안 함"];
  const n = checks.filter((c) => c.status === "pass").length;
  return [n === checks.length ? "ok" : checks.some((c) => c.status === "fail") ? "bad" : "", n + "/" + checks.length + " 통과"];
}

// The platform's data residency and capacity checks of the latest start (or rollback) of this plan.
// `bare` drops the card and its title, for the run's record tab that already names it.
export function PreflightBox({ p, bare }: { p?: PreflightView; bare?: boolean }) {
  if (!p) return null;
  const ran = p.residency.status !== "skip" || p.capacity.status !== "skip";
  const head = p.blocked ? <Chip kind="bad">시작 막힘</Chip> : ran ? <Chip kind="ok">통과</Chip> : <Chip>검사 안 함</Chip>;
  const when = <span className="hint">{new Date(p.at).toLocaleString("ko-KR")}</span>;
  const part = (name: string, x: PreflightView["residency"] | PreflightView["capacity"], items: typeof p.residency.items) => [
    [td(<b>{name}</b>), td(<CheckChip s={x.status} />), td(x.summary)],
    ...items.map((it) => [
      td(<span className="hint">{it.label}</span>),
      td(<CheckChip s={it.status} />),
      td(
        <span className={it.detail === it.raw ? "m" : undefined} title={it.raw}>
          {it.detail || "-"}
        </span>,
      ),
    ]),
  ];
  const table = <Table head={["검사", "결과", "내용"]} rows={[...part("데이터 레지던시", p.residency, p.residency.items), ...part("용량", p.capacity, p.capacity.items)]} />;
  const digest = p.residency.digest && (
    <>
      레지던시 정책 digest <span className="m">{p.residency.digest.slice(0, 12)}</span> (감사 로그에 같은 값이 남습니다)
    </>
  );
  if (bare)
    return (
      <>
        <div className="chips">
          {head}
          {when}
        </div>
        {table}
        {digest && <p className="hint">{digest}</p>}
      </>
    );
  return (
    <div className="box">
      <div className="bh">
        <b>시작 전 검사</b>
        {head}
        {when}
      </div>
      {table}
      {digest && <div className="bb hint">{digest}</div>}
    </div>
  );
}

/** The AI session on screen: the one the operator picked, else the newest. Live follows only that one's events. */
function useShownSession(v: MigrationView): [AgentSession | undefined, (id: string) => void] {
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (id: string) => {
    setPicked(id);
    v.selectSession(id);
  };
  return [v.sessions.find((s) => s.id === picked) ?? v.sessions[0], pick];
}

function AiView({ v }: { v: MigrationView }) {
  const [shown, pick] = useShownSession(v);
  const all = v.sessions.flatMap((s) => v.sessionEvents(s.id));
  const review = v.stage === "review" && !!v.plan;
  const feed = shown ? (
    <SessionFeed s={shown} events={v.sessionEvents(shown.id)} />
  ) : (
    <div className="box">
      <div className="bh">
        <b>AI 작업 기록</b>
      </div>
      <div className="bb">
        <p className="hint">{v.live ? "이 Plan에 연결된 AI 세션이 아직 없습니다." : "AI 세션을 시작하고 있습니다."}</p>
      </div>
    </div>
  );
  if (!v.plan)
    return (
      <div className="mg-main">
        <PlanBox v={v} />
        {feed}
      </div>
    );
  // DOM order is the narrow screen's order (what changed, the decision, then the folded details); wide screens
  // put the decision in a right column beside both.
  return (
    <div className="mg-cols">
      <div className="mg-main">
        {/* a refused start: why comes first */}
        <PreflightBox p={v.preflight} />
        {/* the AI at work: its log first */}
        {!review && feed}
        <FixBox v={v} />
        <Checked v={v} events={all} />
      </div>
      <aside className="mg-side">
        {review ? (
          <ApproveBox v={v} />
        ) : (
          <div className="box">
            <div className="bh">
              <b>승인</b>
              <Chip kind="run" dot>
                AI 작업 중
              </Chip>
            </div>
            <div className="bb">
              <p className="hint">AI가 리허설을 마치면 여기서 Plan을 승인합니다. 리허설이 실패하면 AI가 원인을 진단하고 수정안을 Plan에 첨부합니다.</p>
            </div>
          </div>
        )}
      </aside>
      <div className="mg-main mg-more">
        <details className="box fold mg-fold">
          <summary className="bh">
            <b>Plan 상세</b>
            <span className="hint">원본, 대상, 첨부, 엔진 Plan 원문</span>
          </summary>
          <div className="bb">
            <PlanFacts v={v} />
          </div>
        </details>
        {v.sessions.length > 0 && (
          <details className="box fold mg-fold">
            <summary className="bh">
              <b>AI 세션 기록</b>
              <Chip>세션 {v.sessions.length}개</Chip>
            </summary>
            <div className="bb">
              <SessionTable sessions={v.sessions} onPick={pick} picked={shown?.id} />
              {review && feed}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// What the AI changed: the values fix as a diff (simulation), else the plan's attachments (live).
function FixBox({ v }: { v: MigrationView }) {
  const p = v.plan!;
  const changed = !!v.fix || !!p.attachments?.length;
  const diag = v.sessions.find((s) => s.kind === "diagnose");
  const why = diag && v.sessionEvents(diag.id).find((e) => e.type === "message")?.output;
  return (
    <div className="box">
      <div className="bh">
        <b>AI가 바꾼 것</b>
        <Chip>{changed && p.revision > 1 ? "revision " + (p.revision - 1) + " → " + p.revision : "revision " + p.revision}</Chip>
      </div>
      <div className="bb">
        {v.fix ? (
          <>
            <p>{(typeof why === "string" ? why + ". " : "리허설이 실패한 원인을 AI가 진단했습니다. ") + "AI가 환경 프로필 사본을 고쳤고, 운영 클러스터는 바꾸지 않았습니다."}</p>
            <div className="diff">
              <div className="f">{v.fix.file}</div>
              <div className="d">{"- " + v.fix.minus}</div>
              <div className="a">{"+ " + v.fix.plus}</div>
            </div>
          </>
        ) : p.attachments?.length ? (
          <>
            <p>{(typeof why === "string" ? why + ". " : "") + "AI가 올린 첨부입니다. 승인하면 엔진이 이 내용으로 실행합니다."}</p>
            {v.live ? p.attachments.map((a) => <AttachmentView key={a.name} planRef={p.ref} a={a} revision={p.revision} />) : <p>첨부: {p.attachments.map((a) => a.name).join(", ")}</p>}
          </>
        ) : (
          <p className="hint">AI가 바꾼 것이 없습니다. 리허설이 실패하면 AI가 로그를 읽고 수정안을 냅니다.</p>
        )}
      </div>
    </div>
  );
}

// One attachment as uploaded (live), with its hash checked against the plan record's.
function AttachmentView({ planRef, a, revision }: { planRef: string; a: PlanAttachment; revision: number }) {
  const c = useAttachment(planRef, a, revision);
  const check = c.verified === true ? <Chip kind="ok">SHA-256 일치</Chip> : c.verified === false ? <Chip kind="bad">SHA-256 불일치</Chip> : null;
  return (
    <figure className="mg-attach" aria-busy={c.loading}>
      <figcaption>
        <b>{a.name}</b>
        <span className="hint">
          {fmt(a.size)}B · sha256 {a.sha256.slice(0, 12)}
        </span>
        {check}
      </figcaption>
      {c.loading ? (
        <p className="hint">내용을 불러오는 중입니다.</p>
      ) : c.error ? (
        <p className="hint" role="alert">
          내용을 불러오지 못했습니다: {c.error}
        </p>
      ) : c.text === undefined ? (
        <p className="hint">텍스트가 아닌 파일이라 내용을 보여 주지 않습니다 ({fmt(c.bytes ?? 0)}B).</p>
      ) : (
        <pre tabIndex={0} aria-label={a.name + " 내용"}>
          {c.text}
        </pre>
      )}
      {c.verified === false && <p className="hint">받은 내용이 Plan 기록의 해시와 다릅니다. 승인하기 전에 Plan을 다시 확인하세요.</p>}
    </figure>
  );
}

function sessionMark(s?: AgentSession): MarkSt {
  return !s ? "wait" : s.status === "succeeded" ? "ok" : s.status === "running" ? "run" : "bad";
}

// What was checked before the approval: the AI plan, the rehearsal, the commands the platform blocked, the pre-start checks.
// Live streams the session on screen and reads the others' stored events, so the counts cover every session
// once they have loaded (`sessionsPartial` until then, or when a read failed).
function Checked({ v, events }: { v: MigrationView; events: AgentEvent[] }) {
  const plan = v.sessions.find((s) => s.kind === "plan");
  const reh = v.sessions.find((s) => s.kind === "rehearsal");
  const fails = v.sessions.filter((s) => s.kind === "diagnose").length;
  const fixed = !!v.fix || !!v.plan?.attachments?.length;
  const blocked = blockedOf(events);
  const pf = v.preflight;
  const scope = !v.live ? "" : !v.sessions.length ? "AI 세션 기록이 없습니다." : v.sessionsPartial ? "일부 세션 기록을 아직 받지 못해 세는 중이거나 불러오지 못했습니다. 숫자가 실제보다 적을 수 있습니다." : "";
  const tools = (s: AgentSession) => " 도구 호출 " + fmt(s.totals.toolCalls) + "회, 토큰 " + fmt(s.totals.inputTokens) + " / " + fmt(s.totals.outputTokens) + ".";
  return (
    <div className="box">
      <div className="bh">
        <b>확인한 것</b>
        <span className="hint">{"AI 세션 " + v.sessions.length + "개, 막힌 명령 " + blocked.length + "건" + (v.sessionsPartial ? " 이상" : "")}</span>
      </div>
      <ul className="mg-checks">
        <li>
          <Mark round st={sessionMark(plan)} />
          <div>
            <b>AI 계획</b>
            <small>
              {plan
                ? (plan.status === "running" ? "읽기 전용 도구로 두 클러스터를 조회하고 있습니다." : "읽기 전용 도구로 두 클러스터를 조회해 Plan을 만들었습니다.") + tools(plan)
                : "AI 계획 세션이 없습니다. Plan은 " + v.plan?.submittedBy + "가 제출했습니다."}
            </small>
          </div>
        </li>
        <li>
          <Mark round st={fails && reh?.status !== "running" ? "warn" : sessionMark(reh)} />
          <div>
            <b>리허설{fails ? ": 실패 " + fails + "회" + (fixed ? ", 수정안 첨부" : "") : ""}</b>
            <small>
              {reh
                ? (reh.status === "running" ? "격리된 샌드박스에서 테스트 데이터로 실행하고 있습니다." : "격리된 샌드박스에서 테스트 데이터로 실행했습니다.") +
                  (reh.summary ? " " + reh.summary + "." : "") +
                  (fails && fixed ? " 위 수정안이 실패 원인을 고칩니다." : "")
                : "리허설 기록이 없습니다."}
            </small>
          </div>
        </li>
        <li>
          <Mark round st={blocked.length || !v.live ? "ok" : "neu"} glyph="shield" />
          {blocked.length ? (
            <details open>
              <summary>
                <b>막힌 명령 {blocked.length}건, 모두 차단됨</b>
                <small>{"AI 권한 밖의 명령이라 플랫폼이 막았습니다. 운영 클러스터에는 영향이 없습니다." + (scope && " " + scope)}</small>
              </summary>
              <ul className="mg-blocked">
                {blocked.map((b, i) => (
                  <li key={i}>
                    <code className="m">{b.command}</code>
                    <span className="hint">{b.by}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <div>
              <b>{v.live ? "막힌 명령 0건" : "막힌 명령 없음"}</b>
              <small>{scope || "AI가 권한 밖의 명령을 시도하지 않았습니다."}</small>
            </div>
          )}
        </li>
        <li>
          <Mark round st={pf ? (pf.blocked ? "bad" : "ok") : "wait"} />
          <div>
            <b>시작 전 검사: {pf ? (pf.blocked ? "시작 막힘" : "통과") : "승인한 뒤 실행"}</b>
            <small>
              {pf
                ? pf.blocked
                  ? "검사 결과의 이유를 해결한 뒤 다시 시작하세요."
                  : "검사 결과는 시작 전 검사 표에 있습니다."
                : "시작 직전에 데이터 레지던시, 대상 접속 한도, 대기 서버 설정, 복제 따라잡기를 확인합니다. 명백히 실패할 이전은 시작하지 않습니다. 플랫폼에서 켜 둔 검사만 실행합니다."}
            </small>
          </div>
        </li>
      </ul>
    </div>
  );
}

/* ---------- engine run ---------- */

/** A run from before start-target existed has no record of it once it reached cutover. */
const noStartTarget = (r: Run, id: string) => id === "start-target" && !r.engine.steps[id] && !!r.engine.steps.cutover;

function stepState(r: Run, id: string): StepState {
  // counted as passed so the stop is not placed there; the list shows it as neutral
  if (noStartTarget(r, id)) return "ok";
  const s = r.engine.steps[id]?.status ?? "pending";
  return s === "succeeded" ? "ok" : s === "running" ? "run" : s === "failed" ? "bad" : "wait";
}

/**
 * Engine step states from the run, brought up to date by the step events: live, the run snapshot is only
 * as new as the last connect, while the events are complete. An ended run shows no step as running.
 */
function stepStates(r: Run, events: RunEvent[], active: boolean): Record<string, StepState> {
  const out: Record<string, StepState> = {};
  for (const s of ENGINE_STEPS) out[s.id] = stepState(r, s.id);
  for (const e of events) {
    if (!e.step || !(e.step in out)) continue;
    if (e.kind === "step_started") out[e.step] = "run";
    else if (e.kind === "step_succeeded" || e.kind === "step_skipped") out[e.step] = "ok";
    else if (e.kind === "step_failed") out[e.step] = "bad";
  }
  if (!active) for (const k in out) if (out[k] === "run") out[k] = "wait";
  return out;
}

/** Seconds in a Go duration such as "30s" or "1m30s". */
function goSec(d: string): number | undefined {
  const parts = [...d.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
  if (!parts.length) return undefined;
  const unit: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };
  return parts.reduce((t, [, n, u]) => t + Number(n) * unit[u], 0);
}

const TARGET_TEXT = TARGET_SEC % 60 ? dur(TARGET_SEC) : TARGET_SEC / 60 + "분";

/**
 * When the run crossed from one part to the next, from its events (complete in both modes, see useRun):
 * sync done, waiting for the switch (or the switch itself when nothing waited), switch, cutover done, observe.
 */
interface Marks {
  synced?: string;
  waited?: string;
  switched?: string;
  cut?: string;
  observed?: string;
}

function marksOf(r: Run, events: RunEvent[]): Marks {
  const at = (f: (e: RunEvent) => boolean) => events.find(f)?.time;
  const switched = r.switchApprovedAt ?? at((e) => e.kind === "status_changed" && e.data?.phase === "cutover");
  return {
    synced: at((e) => e.kind === "step_succeeded" && e.step === "delta"),
    waited: at((e) => e.kind === "status_changed" && e.data?.status === "awaiting_switch") ?? switched,
    switched,
    cut: at((e) => e.kind === "step_succeeded" && e.step === "cutover"),
    observed: at((e) => e.kind === "status_changed" && e.data?.phase === "observe"),
  };
}

/** Four groups of the run: sync (4 engine steps), read canary, switch (3), verify (2, and observe when on). */
type GroupSt = "done" | "run" | "wait" | "bad" | "todo";
type ItemSt = StepState | "neu";
interface Group {
  label: string;
  st: GroupSt;
  range?: string;
  /** `now`: a word for a step at work, beside its spinner (which stands still with reduced motion) */
  items: { label: string; st: ItemSt; detail?: string; now?: string }[];
}

const GROUP_OF: Record<RunPhase, number> = { sync: 0, canary: 1, awaiting_switch: 2, cutover: 2, verify: 3, observe: 3, done: 4 };

/**
 * Where a run that did not succeed stopped. The platform ends every run in phase "done" (runs.finish), right after
 * the status change that carries the phase it stopped in, so that is the last status change with another phase.
 * Without events: the phase of the engine's failure step, else of its first step that did not succeed.
 */
function stopPhase(r: Run, events: RunEvent[], steps: Record<string, StepState>): RunPhase {
  if (r.phase !== "done") return r.phase;
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i].kind === "status_changed" ? events[i].data?.phase : undefined;
    if (typeof p === "string" && p !== "done" && p in GROUP_OF) return p as RunPhase;
  }
  const s = ENGINE_STEPS.find((x) => x.id === r.engine.failureStep) ?? ENGINE_STEPS.find((x) => steps[x.id] !== "ok");
  return s?.phase ?? "done";
}

/** The run's four groups with their state, time range and items (exported for tests). */
export function groupsOf(r: Run, events: RunEvent[], m: Marks = marksOf(r, events)): Group[] {
  const active = r.status === "running" || r.status === "awaiting_switch";
  const steps = stepStates(r, events, active);
  const o = r.observe;
  // A succeeded run whose observation broke the gate stopped being good in the verify group.
  const cur = r.status === "succeeded" ? (o?.passed === false ? GROUP_OF.observe : 4) : GROUP_OF[stopPhase(r, events, steps)];
  const st = (i: number): GroupSt => (i < cur ? "done" : i > cur ? "todo" : r.status === "awaiting_switch" ? "wait" : active ? "run" : "bad");
  const engine = (phase: RunPhase) =>
    ENGINE_STEPS.filter((s) => s.phase === phase).map((s): Group["items"][number] =>
      noStartTarget(r, s.id)
        ? { label: s.label + " (기록 없음)", st: "neu", detail: "이 단계가 생기기 전의 실행입니다." }
        : { label: s.label, st: steps[s.id], detail: s.detail, now: steps[s.id] === "run" ? "진행 중" : undefined },
    );
  const at = (t: string) => mmss(secs(r.startedAt, t));
  // an ended run's open part ends when the run did
  const until = (t?: string) => t ?? (active ? undefined : (r.endedAt ?? r.updatedAt));
  const range = (a?: string, b?: string) => (a ? at(a) + " ~" + (b ? " " + at(b) : "") : undefined);
  const c = r.canary;
  const canary: Group["items"] = c
    ? c.options.weights.map((w, i) => {
        const s = c.steps[i];
        const g = s?.gate;
        // verdict is new; older runs only have gate.passed.
        const verdict = s?.verdict ?? (g ? (g.passed ? "ok" : "failed") : undefined);
        const label = w + "%" + (verdict === "ok" ? " 통과" : verdict === "inconclusive" ? " (요청 부족, 다음 단계로)" : verdict === "failed" ? " 실패" : s && active ? " 관찰 중" : "");
        const itemSt: ItemSt = !s ? "wait" : !g ? (active ? "run" : "wait") : verdict === "failed" ? "bad" : verdict === "inconclusive" ? "neu" : "ok";
        return { label, st: itemSt };
      })
    : [{ label: "게이트웨이를 거치지 않아 건너뜀", st: cur > 1 ? "ok" : "wait" }];
  const verify = engine("verify");
  if (o) {
    // no verdict: still to come, or (once it started) stopped early or never conclusive
    const ost: ItemSt = r.phase === "observe" && active ? "run" : o.passed === true ? "ok" : o.passed === false ? "bad" : !active && m.observed ? "neu" : "wait";
    verify.push({ label: "전환 후 관찰" + (ost === "bad" ? " 위반" : ost === "neu" ? " (판정 없이 끝남)" : ""), st: ost, detail: o.violation ?? o.stoppedReason, now: ost === "run" ? "관찰 중" : undefined });
  }
  return [
    { label: "동기화", st: st(0), range: range(r.startedAt, until(m.synced)), items: engine("sync") },
    { label: "읽기 카나리", st: st(1), range: range(m.synced, until(m.waited)), items: canary },
    { label: "전환", st: st(2), range: range(m.switched, until(m.cut)), items: engine("cutover") },
    { label: "검증", st: st(3), range: range(m.cut, until(r.endedAt)), items: verify },
  ];
}

/**
 * Seconds per part of an ended run; undefined when its events do not hold every boundary (a run that stopped early).
 * Each boundary is rounded from the start, so the parts add up to the rounded total in the report.
 */
function spansOf(r: Run, m: Marks): { label: string; sec: number; i: number }[] | undefined {
  if (!r.endedAt || !m.synced || !m.waited || !m.switched || !m.cut) return undefined;
  const verified = m.observed ?? r.endedAt;
  const edges = [r.startedAt, m.synced, m.waited, m.switched, m.cut, verified, r.endedAt].map((t) => Math.round(secs(r.startedAt, t)));
  const labels = ["동기화", "읽기 카나리", "전환 승인 대기", "쓰기 보류, 승격, 전환", "검증, 마무리", "전환 후 관찰"];
  return labels.map((label, i) => ({ label, sec: edges[i + 1] - edges[i], i })).filter((p) => p.sec > 0);
}

function RunView({ v, r }: { v: MigrationView; r: Run }) {
  const ended = !["running", "awaiting_switch"].includes(r.status);
  const marks = marksOf(r, v.events);
  // the map above holds the actions, the progress and the traffic; these are the run's records
  return (
    <>
      {/* a start or rollback refused by a pre-start check: why comes first */}
      {v.preflight?.blocked && <PreflightBox p={v.preflight} />}
      <ObserveBox r={r} />
      {ended && <ResultBox r={r} v={v} />}
      {ended && <VerifyBox r={r} />}
      {v.live && ended && <LiveSourceRetention runId={r.runId} />}
      {ended && <PhaseTimes r={r} m={marks} />}
      <CanaryBox r={r} />
      <RunRecords key={r.runId} v={v} r={r} />
    </>
  );
}

/** The run's headline for its status and phase. Only the cutover and verify say the target was asked to promote. */
function heroText(v: MigrationView, r: Run, el: number): [string, string] {
  const back = "실패하면 " + v.srcLabel + "로 자동 원복합니다(rolled_back).";
  const promoted = r.engine.promoteRequested ? v.tgtLabel + " 승격을 요청했습니다. 지금부터 실패하면 원복하지 않고 멈춥니다(halted)." : "대상 승격 전입니다. " + back;
  const noun = r.rollbackOf ? "롤백" : "이전";
  const why = r.statusReason ? " 이유: " + r.statusReason : "";
  switch (r.status) {
    case "running":
      if (r.phase === "sync") return ["데이터를 맞추고 있습니다", v.srcLabel + (v.plan?.summary.files === false ? "의 데이터를 " : "의 데이터와 파일을 ") + v.tgtLabel + "로 복사하고 변경분을 따라잡습니다. " + back];
      if (r.phase === "canary")
        return ["읽기 일부를 대상으로 보내 확인하고 있습니다", "읽기 " + targetReadShare(r) + "%를 " + v.tgtLabel + "로 보내며 단계마다 게이트(오류율, p95 지연)를 확인합니다. 게이트가 실패하면 읽기를 원본으로 되돌리고 원복합니다."];
      if (r.phase === "cutover") return ["쓰기를 붙잡고 대상을 승격하고 있습니다", promoted];
      if (r.phase === "verify") return ["대상에서 데이터를 검증하고 있습니다", promoted];
      if (r.phase === "observe") {
        const o = r.observe?.options;
        return ["전환을 마쳤고 관찰 중입니다", v.tgtLabel + "로 트래픽을 옮겼습니다. " + (o?.duration ?? "2m") + " 동안 게이트로 판정하고" + (o?.autoRollback ? ", 어기면 플랫폼이 롤백 run을 시작합니다." : ", 어기면 위반을 기록합니다.")];
      }
      return [statusText(r.status, r.phase), promoted];
    case "awaiting_switch":
      return [
        "데이터가 맞춰졌습니다. 전환할 수 있습니다.",
        (r.canary?.passed ? "읽기 카나리 게이트를 모두 통과했습니다. " : "") + "전환하면 쓰기를 잠시 붙잡고(상한 " + (v.plan?.summary.maxDowntime ?? "30s") + ") " + v.tgtLabel + "를 승격한 뒤 쓰기 트래픽을 옮깁니다.",
      ];
    case "succeeded": {
      const o = r.observe;
      if (o?.passed === false)
        return [
          "전환은 마쳤지만 전환 후 관찰에서 게이트를 어겼습니다.",
          (o.violation ? "위반: " + o.violation + ". " : "") +
            (o.rollbackRunId
              ? "플랫폼이 자동으로 롤백을 시작했습니다(" + o.rollbackRunId + ")."
              : (o.rollbackError ? "자동 롤백을 시작하지 못했습니다: " + o.rollbackError + ". " : "") + "롤백할지 정하세요."),
        ];
      const x = r.result;
      const clean = x.verified === true && [x.failedRequests, x.missingRows, measuredWriteMissing(writeVerificationOf(x), x.missingWrites), x.missingFiles].every((n) => n === 0);
      const took = dur(el) + " 만에 " + (r.rollbackOf ? "되돌렸" : "옮겼");
      return [
        clean ? took + "고, 실패 요청과 누락은 없습니다." : took + "습니다. 리포트에서 실패 요청과 누락을 확인하세요.",
        (x.verified ? "트래픽과 데이터가 " + v.tgtLabel + "에 있고 검증을 통과했습니다. " : "트래픽이 " + v.tgtLabel + "에 있습니다. ") +
          "원본 " +
          v.srcLabel +
          "는 읽기 전용으로 남아 있어서 같은 방법으로 되돌릴 수 있습니다.",
      ];
    }
    case "rolled_back":
      return [noun + "하지 못하고 " + v.srcLabel + "로 원복했습니다.", "원본이 다시 트래픽을 받고, 잃은 데이터는 없습니다." + why];
    case "halted":
      return [
        "대상 승격 뒤에 멈췄습니다. 운영자가 판단해야 합니다.",
        "승격을 요청한 뒤라 자동으로 원복하지 않았습니다. " +
          (r.engine.writesHeld
            ? "게이트웨이가 아직 쓰기를 붙잡고 있어서, 운영자가 정할 때까지 사용자의 쓰기는 기다리고 게이트웨이의 최대 보류 시간이 지나면 실패합니다. "
            : "") +
          v.tgtLabel +
          " DB가 primary인지 확인한 뒤 이어서 실행할 수 있습니다. 엔진은 대상 승격이 끝났고 원본에 쓸 수 없는 것을 확인해야 멈춘 단계부터 다시 진행하고, 확인하지 못하면 다시 멈춥니다(halted)." +
          why,
      ];
    case "failed":
      return [noun + "이 실패했습니다. 이어서 실행할 수 있습니다.", "되돌릴 수 없는 단계 전에 멈췄습니다." + why];
    case "aborted":
      return [noun + "을 중단했습니다. 이어서 실행할 수 있습니다.", "되돌릴 수 없는 단계 전에 멈췄습니다." + why];
    case "interrupted":
      return [
        "서버가 다시 시작되어 멈췄습니다. 이어서 실행할 수 있습니다.",
        (r.engine.promoteRequested ? "대상 승격을 요청한 뒤에 멈췄고, 이어서 실행하면 멈춘 단계부터 다시 진행합니다." : "되돌릴 수 없는 단계 전에 멈췄습니다.") + why,
      ];
  }
}



// One bar of the ended run's parts; the wait for the switch approval (a person) is amber.
function PhaseTimes({ r, m }: { r: Run; m: Marks }) {
  const parts = spansOf(r, m);
  if (!parts?.length) return null;
  return (
    <div className="box">
      <div className="bh">
        <b>구간별 시간</b>
        <span className="hint">사람이 기다린 시간은 주황색</span>
      </div>
      <div className="bb">
        <div className="mg-spans" role="img" aria-label={"구간별 시간: " + parts.map((p) => p.label + " " + dur(p.sec)).join(", ")}>
          {parts.map((p) => (
            <i key={p.i} className={"c" + p.i} style={{ flexGrow: p.sec }} />
          ))}
        </div>
        <div className="legend mg-legend">
          {parts.map((p) => (
            <span key={p.i}>
              <span className={"sw c" + p.i} />
              {p.label} <b className="m">{mmss(p.sec)}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// The details below the run: engine log (default), pre-start checks, AI sessions, Plan.
function RunRecords({ v, r }: { v: MigrationView; r: Run }) {
  const [picked, setTab] = useState("log");
  const pf = v.preflight && preflightCount(v.preflight);
  const items: TabItem[] = [
    { id: "log", label: "엔진 기록" },
    { id: "preflight", label: <>시작 전 검사 {pf && <Chip kind={pf[0]}>{pf[1]}</Chip>}</> },
    ...(v.sessions.length
      ? [
          {
            id: "ai",
            label: (
              <>
                AI 기록 <Chip>세션 {v.sessions.length}</Chip>
              </>
            ),
          },
        ]
      : []),
    { id: "plan", label: "Plan" },
  ];
  // a tab that went away (no AI sessions on this run) falls back to the log
  const tab = items.some((t) => t.id === picked) ? picked : "log";
  return (
    <div className="box mg-records">
      <Tabs label="자세한 기록" items={items} current={tab} onSelect={setTab} idBase="mg-rec" />
      <div className="bb" role="tabpanel" id={tabPanelId("mg-rec", tab)} aria-labelledby={tabId("mg-rec", tab)}>
        {tab === "log" && <LogBox lines={runLines(r.startedAt, v.events)} />}
        {tab === "preflight" &&
          (v.preflight ? <PreflightBox p={v.preflight} bare /> : <p className="hint">시작 전 검사 기록이 없습니다. 감사 로그를 볼 권한이 없거나 플랫폼에서 검사를 꺼 두었을 수 있습니다.</p>)}
        {tab === "ai" && <RunSessions v={v} />}
        {tab === "plan" && <PlanFacts v={v} />}
      </div>
    </div>
  );
}

function RunSessions({ v }: { v: MigrationView }) {
  const [shown, pick] = useShownSession(v);
  return (
    <>
      <SessionTable sessions={v.sessions} onPick={pick} picked={shown?.id} />
      {shown && <SessionFeed s={shown} events={v.sessionEvents(shown.id)} />}
    </>
  );
}

export function CanaryBox({ r }: { r: Run }) {
  const c = r.canary;
  if (!c) return null;
  return (
    <div className="box">
      <div className="bh">
        <b>읽기 카나리</b>
        {c.passed ? <Chip kind="ok">게이트 모두 통과</Chip> : c.steps.length ? <Chip kind="run">진행 중</Chip> : <Chip>동기화 뒤 시작</Chip>}
      </div>
      <Table
        head={["단계", "대상으로 보낸 읽기", "게이트", "요청", "오류율", "p95"]}
        rows={c.options.weights.map((w, i) => {
          const s = c.steps[i];
          const g = s?.gate;
          // verdict is new; older runs only have gate.passed.
          const v = s?.verdict ?? (g ? (g.passed ? "ok" : "failed") : undefined);
          let chip = s ? <Chip kind="run">관찰 중</Chip> : <Chip>대기</Chip>;
          if (g && v === "ok") chip = <Chip kind="ok">통과</Chip>;
          else if (g && v === "inconclusive") chip = <Chip>판단 보류: 요청 부족, 다음 단계로</Chip>;
          else if (g) chip = <Chip kind="bad">{"실패: " + g.reason}</Chip>;
          return [
            td(i + 1 + "단계", "nw"),
            td(w + "%", "num"),
            td(chip),
            td(g ? fmt(g.requests) : "-", "num"),
            td(g ? (g.errorRate * 100).toFixed(2) + "%" : "-", "num"),
            td(g ? Math.round(g.p95Millis) + "ms" : "-", "num"),
          ];
        })}
      />
    </div>
  );
}

// After the cutover the platform keeps checking the target against the gate
// (run.observe, started with observe options) and may start the rollback itself.
function ObserveBox({ r }: { r: Run }) {
  const o = r.observe;
  if (!o) return null;
  const opts = o.options;
  let chip;
  if (o.rollbackRunId) chip = <Chip kind="bad">자동 롤백 시작: {o.rollbackRunId}</Chip>;
  else if (o.passed === false) chip = <Chip kind="bad">위반: {o.violation}</Chip>;
  else if (o.passed) chip = <Chip kind="ok">게이트 통과</Chip>;
  else if (o.stoppedReason) chip = <Chip>중단: {o.stoppedReason}</Chip>;
  else if (r.phase === "observe") chip = <Chip kind="run">관찰 중</Chip>;
  else chip = <Chip>전환 뒤 시작</Chip>;
  const verdict = (s: (typeof o.steps)[number]) =>
    s.verdict === "ok" ? <Chip kind="ok">통과</Chip> : s.verdict === "violated" ? <Chip kind="bad">위반: {s.gate?.reason}</Chip> : <Chip>판단 불가: {s.gate?.reason}</Chip>;
  return (
    <div className="box">
      <div className="bh">
        <b>전환 후 관찰</b>
        {chip}
        <span className="hint">
          {opts.duration ?? "2m"} 동안 {opts.stepDuration ?? "20s"}마다 판정{opts.autoRollback ? ", 위반하면 자동 롤백" : ""}
        </span>
      </div>
      {o.rollbackError && <div className="bb hint">자동 롤백을 시작하지 못했습니다: {o.rollbackError}</div>}
      {o.steps.length > 0 && (
        <Table
          head={["단계", "판정", "요청", "오류율", "p95"]}
          rows={o.steps.map((s, i) => {
            const g = s.gate;
            return [
              td(i + 1 + "단계", "nw"),
              td(verdict(s)),
              td(g ? fmt(g.requests) : "-", "num"),
              td(g ? (g.errorRate * 100).toFixed(2) + "%" : "-", "num"),
              td(g ? Math.round(g.p95Millis) + "ms" : "-", "num"),
            ];
          })}
        />
      )}
    </div>
  );
}

// The ended run's numbers, each checked against its target.
function ResultBox({ r, v }: { r: Run; v: MigrationView }) {
  const x = r.result;
  const verification = writeVerificationOf(x);
  const missingWrites = measuredWriteMissing(verification, x.missingWrites);
  const n = (k: number | undefined, unit: string) => (k === undefined ? "측정 안 됨" : fmt(k) + unit);
  const zero = (k: number | undefined) => (k === undefined ? undefined : k === 0);
  const max = goSec(v.plan?.summary.maxDowntime ?? "");
  const down = x.downtimeMillis;
  return (
    <div className="box">
      <div className="bh">
        <b>{r.rollbackOf ? "롤백" : "이전"} 리포트</b>
        <span className="hint">목표와 비교</span>
      </div>
      <div className="mg-report">
        <Num label="전체 시간" value={x.durationMillis !== undefined ? dur(x.durationMillis / 1000) : "-"} note={"목표 " + TARGET_TEXT + " 이내"} ok={x.durationMillis === undefined || r.status !== "succeeded" ? undefined : x.durationMillis <= TARGET_SEC * 1000} />
        <Num
          label="쓰기 보류"
          value={down !== undefined ? (down / 1000).toFixed(1) + "초" : "-"}
          note={(max !== undefined ? "상한 " + dur(max) : "게이트웨이가 쓰기를 붙잡은 시간") + (v.counters?.heldDone ? ", 보류한 쓰기 " + fmt(v.counters.heldDone) + "건 전달" : "")}
          ok={down === undefined || max === undefined ? undefined : down <= max * 1000}
        />
        <Num label="실패 요청" value={n(x.failedRequests, "건")} note={"요청 " + fmt(x.requests ?? 0) + "건 중"} ok={zero(x.failedRequests)} />
        <Num label="누락 행" value={n(x.missingRows, "건")} note="원본에 있고 대상에 없는 행" ok={zero(x.missingRows)} />
        <Num label="누락 쓰기" value={n(missingWrites, "건")} note={verification?.scope === "application_commits" ? "앱 DB 커밋 기록과 대조" : verification?.scope === "client_acknowledged" ? "성공 응답을 확인한 기록과 대조" : "보고된 쓰기 기록과 대조"} ok={zero(missingWrites)} />
        <Num label="누락 파일" value={n(x.missingFiles, "개")} note="크기와 해시 비교" ok={zero(x.missingFiles)} />
      </div>
      <div className="bb"><WriteVerification verification={verification} legacyMissing={x.missingWrites} /></div>
      {!x.verified && <div className="bb hint">검증이 끝나지 않았거나 문제가 있습니다.</div>}
    </div>
  );
}

// The verify step's evidence: what the engine compared on both sides, table by table and file by file.
export function VerifyBox({ r }: { r: Run }) {
  const rep = verifyReportOf(r);
  if (!rep || (!rep.tables.length && !rep.files)) return null;
  const missing = missingOf(rep.tables);
  const f = rep.files;
  const fOk = f && filesClean(f);
  const bad = (missing !== undefined && missing > 0) || fOk === false || rep.tables.some((t) => t.error);
  const n = (k: number | undefined, unit: string) => (k === undefined ? "-" : fmt(k) + unit);
  return (
    <div className="box">
      <div className="bh">
        <b>데이터 검증</b>
        {bad ? <Chip kind="bad">차이 있음</Chip> : rep.ok ? <Chip kind="ok">손실 없음</Chip> : null}
        <span className="hint">검증 단계가 원본과 대상을 직접 비교한 결과</span>
      </div>
      {rep.tables.length > 0 && (
        <Table
          head={["테이블", "원본에서 확인한 행", "대상에서 빠진 행", "결과"]}
          rows={rep.tables.map((t) => {
            let chip = <Chip kind="ok">일치</Chip>;
            if (t.error) chip = <Chip kind="bad">{"오류: " + t.error}</Chip>;
            else if (t.skipped) chip = <Chip>{"건너뜀: " + t.skipped}</Chip>;
            else if (t.missing === undefined) chip = <Chip>측정 안 됨</Chip>;
            else if (t.missing > 0) chip = <Chip kind="bad">누락 있음</Chip>;
            const measured = !t.error && !t.skipped;
            return [td(<code>{t.table}</code>), td(measured ? n(t.checked, "행") : "-", "num"), td(measured ? n(t.missing, "행") : "-", "num"), td(chip)];
          })}
        />
      )}
      {f && (
        <div className="mg-report">
          <Num label="일치하는 파일" value={n(f.matching, "개")} note="원본과 대상의 해시가 같은 파일" ok={fOk ? true : undefined} />
          <Num label="내용이 다른 파일" value={n(f.differences, "개")} note="양쪽에 있지만 해시가 다른 파일" ok={f.differences === undefined ? undefined : f.differences === 0} />
          <Num label="대상에 없는 파일" value={n(f.missingOnTarget, "개")} note="원본에만 있는 파일" ok={f.missingOnTarget === undefined ? undefined : f.missingOnTarget === 0} />
        </div>
      )}
    </div>
  );
}
