import { useState, type ReactNode } from "react";
import type { Run, RunStatus } from "../api/types";
import { BlockedTable, runLines, secs, SessionFeed, SessionTable } from "../components/agent";
import { EmptyShop } from "../components/shared";
import { Chip, Ind, LogBox, PageHead, ProgItem, Table, td, type ChipKind } from "../components/ui";
import { OBSERVE_DURATIONS, OBSERVE_STEP, PLATFORM_GATE, useLiveMigration, useSimMigration, type MigrationView, type ObserveDuration } from "../data/migration";
import { useLive } from "../data/live";
import type { CheckStatus, PreflightView } from "../data/preflight";
import { dur, fmt, mmss, type StepState } from "../sim/format";
import { CANARY, ENGINE_STEPS, PHASE_LABEL, statusText, targetReadShare, TARGET_SEC } from "../sim/mig";

const STATUS_KIND: Record<RunStatus, ChipKind> = {
  running: "run",
  awaiting_switch: "run",
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
        title="이전"
        sub="가동 중인 앱을 데이터와 함께 다른 클러스터로 옮깁니다. AI가 계획하고 샌드박스에서 리허설한 뒤, 운영자가 승인하면 엔진이 실행합니다."
        acts={
          <a className="btn ghost" href="#routes">
            경로별 결과
          </a>
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
                    <Chip kind={v.preflight?.blocked ? "bad" : "run"}>{v.preflight?.blocked ? "시작 전 검사에서 막힘" : "승인됨, 시작 전"}</Chip>
                  ) : v.stage === "review" ? (
                    <Chip kind="run">승인 대기</Chip>
                  ) : v.stage === "ai" ? (
                    <Chip kind="run">AI 작업 중</Chip>
                  ) : (
                    <Chip>이전 전</Chip>
                  ),
                ),
                td(
                  <a className="btn ghost" href="#migrate-app">
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

const crumb = <a href="#migrate">이전</a>;

function Metric({ label, value, note, good }: { label: string; value: ReactNode; note: ReactNode; good?: boolean }) {
  return (
    <div className={"metric" + (good ? " good" : "")}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
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

export function Migrate() {
  return useLive() ? <LiveMigrate /> : <SimMigrate />;
}
function LiveMigrate() {
  return <MigrateView v={useLiveMigration()} />;
}
function SimMigrate() {
  return <MigrateView v={useSimMigration()} />;
}

function MigrateView({ v }: { v: MigrationView }) {
  const live = v.live;
  const title = (v.app || "앱") + " 이전";
  if (!v.ready) {
    return (
      <div className="page">
        <PageHead title={title} crumb={crumb} />
        {live ? <LiveEmpty notice={v.notice} /> : <EmptyShop />}
      </div>
    );
  }

  if (v.stage === "setup") {
    return (
      <div className="page">
        <PageHead title={title} sub="가동 중인 앱을 데이터와 함께 옮깁니다." crumb={crumb} />
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
                  <input id="mig-src" value={v.srcLabel + " (지금 쓰기를 받는 곳)"} readOnly />
                </div>
                <div className="field">
                  <label htmlFor="mig-target">옮겨 갈 환경</label>
                  <select id="mig-target" value={v.tgt} onChange={(e) => v.setTarget(e.target.value)}>
                    {v.targets.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div className="box">
            <div className="bh">
              <b>진행 순서</b>
            </div>
            <ul className="prog">
              <ProgItem st="wait" title="AI 계획" sub="AI가 읽기 전용 도구로 두 클러스터를 조회하고 엔진 Plan을 만듭니다. 플랫폼이 검사한 뒤 승인 대기로 올립니다." right="자동" />
              <ProgItem st="wait" title="리허설" sub="대상 클러스터의 격리된 샌드박스에서 테스트 데이터로 미리 실행합니다. 실패하면 AI가 원인을 진단하고 수정안을 Plan 첨부로 올립니다." right="자동" />
              <ProgItem st="wait" title="승인" sub="화면에 보이는 Plan revision을 승인합니다. 그사이 첨부가 바뀌면 승인이 거절되고 다시 확인해야 합니다." right="운영자" />
              <ProgItem
                st="wait"
                title="시작 전 검사"
                sub="플랫폼이 원본의 전체 테이블과 버킷을 데이터 레지던시 정책에 대보고, 대상 접속 한도와 대기 서버 설정(대상이 원본의 대기 서버로 뜰 수 있는지)을 원본과 비교하고, 복제 따라잡기를 몇 초 동안 잽니다. 명백히 실패할 이전은 시작하지 않습니다."
                right="자동"
              />
              <ProgItem
                st="wait"
                title="실행"
                sub={"동기화(사전 확인, 대상 준비, 초기 복사, 변경분) → 읽기 카나리 " + CANARY.weights.join("%, ") + "% → 전환 승인 → 쓰기 보류, 승격, 전환 → 검증"}
                right="3분 이내"
              />
            </ul>
          </div>
        </div>
        <div className="actrow">
          <button type="button" className="btn primary" disabled={v.busy || !v.tgt} onClick={v.makePlan}>
            {live ? "Plan 작성" : "AI 계획 시작"}
          </button>
          <span className="hint">
            {live
              ? "AI 없이 플랫폼이 설정에서 Plan 초안을 만들고 승인 대기로 올립니다. AI로 계획하려면 AI 실행기(hopai run)를 시작하세요. 계획을 시작하면 이 화면에 AI 작업이 실시간으로 나옵니다."
              : "AI는 계획과 수정안만 만듭니다. 운영 클러스터를 바꾸는 권한은 엔진에만 있습니다."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead title={title} sub={v.srcLabel + " → " + v.tgtLabel} crumb={crumb} />
      <Wizard v={v} />
      <Notice text={v.notice} />
      {v.stage === "run" && v.run ? <RunView v={v} r={v.run} /> : <AiView v={v} />}
    </div>
  );
}

/* ---------- AI plan, rehearsal, approval ---------- */

function PlanBox({ v }: { v: MigrationView }) {
  const p = v.plan;
  if (!p) {
    return (
      <div className="box">
        <div className="bh">
          <b>Plan</b>
          <Chip kind="run">AI 작성 중</Chip>
        </div>
        <div className="bb">
          <p className="hint">AI가 두 클러스터를 조회하고 있습니다.</p>
        </div>
      </div>
    );
  }
  const s = p.summary;
  return (
    <div className="box">
      <div className="bh">
        <b>Plan {p.ref}</b>
        <Chip kind={p.status === "pending_approval" ? "run" : p.status === "rejected" ? "bad" : "ok"}>{PLAN_STATUS[p.status]}</Chip>
      </div>
      <div className="bb">
        <dl className="kv">
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
      </div>
    </div>
  );
}

const PLAN_STATUS = { pending_approval: "승인 대기", approved: "승인됨", rejected: "반려됨", starting: "시작 중", started: "실행됨" } as const;

function ApproveBox({ v }: { v: MigrationView }) {
  if (v.stage !== "review" || !v.plan) return null;
  if (v.plan.status === "approved") return <StartAgainBox v={v} />;
  const blocked = v.sessions.flatMap((s) => v.sessionEvents(s.id)).filter((e) => e.type === "blocked").length;
  return (
    <div className="box fillbox">
      <div className="bb">
        <b>Plan {v.plan.ref} (revision {v.plan.revision})을 승인할까요?</b>
        <dl className="kv">
          <dt>경로</dt>
          <dd>
            {v.srcLabel} → {v.tgtLabel}
          </dd>
          <dt>실행 방식</dt>
          <dd>
            {v.plan.summary.gatewayMode === "http"
              ? "동기화 뒤 읽기 요청 " + CANARY.weights.join("%, ") + "%를 대상으로 보내며 단계마다 게이트(오류율, p95 지연)를 확인합니다. 게이트가 실패하면 읽기를 원본으로 되돌리고 원복합니다."
              : "플랫폼 게이트웨이(http)를 거치지 않는 Plan이라 카나리 없이 동기화 뒤 바로 전환 승인을 기다립니다."}
          </dd>
          <dt>전환</dt>
          <dd>데이터가 맞으면 전환 승인을 기다립니다. 전환 버튼을 누르면 쓰기를 잠시 붙잡고 대상을 승격합니다 (상한 {v.plan.summary.maxDowntime}).</dd>
          <dt>확인</dt>
          <dd>
            <div className="chips">
              {v.sessions.map((s) => (
                <Chip key={s.id} kind={s.status === "succeeded" ? "ok" : "run"}>
                  {s.title.split(" (")[0]}: {s.status === "succeeded" ? "완료" : "진행 중"}
                </Chip>
              ))}
              {v.fix && <Chip kind="ok">AI 수정안 1건 첨부</Chip>}
              <Chip>막힌 명령 {blocked}건</Chip>
            </div>
          </dd>
          <dt>시작 전 검사</dt>
          <dd>
            승인하면 플랫폼이 시작 직전에 데이터 레지던시(원본 전체 테이블과 버킷의 목적지 국가)와 용량(대상 접속 한도, 대기 서버 설정, 복제 따라잡기)을 확인합니다. 명백히 실패하면 시작하지 않고 이유를
            보여 줍니다. 플랫폼에서 켜 둔 검사만 실행합니다.
          </dd>
          <dt>원복</dt>
          <dd>
            대상 승격을 요청하기 전까지는 실패하면 원본으로 자동 원복합니다. 그 뒤에는 원복하지 않고 멈추고(halted) 운영자가 판단합니다.
            {v.start?.options.observe &&
              v.plan.summary.gatewayMode === "http" &&
              (v.start.options.autoRollback
                ? " 전환이 끝난 뒤 관찰 중에 게이트를 어기면 플랫폼이 롤백 run을 시작합니다(자동 롤백)."
                : " 전환이 끝난 뒤 관찰 중에 게이트를 어기면 위반을 기록하고, 롤백은 운영자가 정합니다.")}
          </dd>
          <StartOptionsFields v={v} />
        </dl>
        <div className="actrow">
          <button type="button" className="btn primary" disabled={v.busy} onClick={v.approve}>
            승인하고 시작
          </button>
          <button type="button" className="btn ghost" disabled={v.busy} onClick={v.reject}>
            반려
          </button>
        </div>
      </div>
    </div>
  );
}

const DURATION_LABEL: Record<ObserveDuration, string> = { "1m": "1분", "2m": "2분", "5m": "5분", "10m": "10분" };

// Observe and auto rollback for the start (platform ObserveOptions). Live only: the simulation does not model them.
// `locked` resends a start that did not finish: the platform may already have started it under the same
// Idempotency-Key and then answers with that run, so changed options would be ignored without a word.
function StartOptionsFields({ v, locked = false }: { v: MigrationView; locked?: boolean }) {
  if (!v.start || !v.plan) return null;
  const { options: o, set } = v.start;
  const off = v.busy || locked;
  if (v.plan.summary.gatewayMode !== "http")
    return (
      <>
        <dt>전환 후 관찰</dt>
        <dd className="hint">플랫폼 게이트웨이(http)를 거치지 않는 Plan이라 전환 후 관찰과 자동 롤백을 쓸 수 없습니다.</dd>
      </>
    );
  return (
    <>
      <dt>전환 후 관찰</dt>
      <dd>
        <label className="check">
          <input type="checkbox" checked={o.observe} disabled={off} onChange={(e) => set({ ...o, observe: e.target.checked, autoRollback: e.target.checked && o.autoRollback })} /> 전환 뒤에도
          대상을 게이트로 계속 판정
        </label>
        {o.observe && (
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
              {o.autoRollback
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
    <div className="box fillbox">
      <div className="bb">
        <b>
          Plan {p.ref} (revision {p.revision})은 승인됐지만 시작하지 않았습니다.
        </b>
        <p className="hint">
          {blocked
            ? "시작 전 검사에서 막혔습니다. 아래 이유를 해결한 뒤(레지던시 정책이나 대상 설정 변경 등) 다시 시작하세요. 해결하지 않고 다시 시작하면 같은 이유로 막힙니다."
            : "시작 요청이 끝나지 않았습니다. 다시 시작할 수 있습니다."}
        </p>
        <dl className="kv">
          {/* a start refused by a pre-start check stored no Idempotency-Key, so its options may change */}
          <StartOptionsFields v={v} locked={!blocked} />
        </dl>
        <div className="actrow">
          <button type="button" className="btn primary" disabled={v.busy} onClick={v.approve}>
            다시 시작
          </button>
          <button type="button" className="btn ghost" disabled={v.busy} onClick={v.reset}>
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

// The platform's data residency and capacity checks of the latest start (or rollback) of this plan.
export function PreflightBox({ p }: { p?: PreflightView }) {
  if (!p) return null;
  const ran = p.residency.status !== "skip" || p.capacity.status !== "skip";
  const head = p.blocked ? <Chip kind="bad">시작 막힘</Chip> : ran ? <Chip kind="ok">통과</Chip> : <Chip>검사 안 함</Chip>;
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
  return (
    <div className="box">
      <div className="bh">
        <b>시작 전 검사</b>
        {head}
        <span className="hint">{new Date(p.at).toLocaleString("ko-KR")}</span>
      </div>
      <Table head={["검사", "결과", "내용"]} rows={[...part("데이터 레지던시", p.residency, p.residency.items), ...part("용량", p.capacity, p.capacity.items)]} />
      {p.residency.digest && (
        <div className="bb hint">
          레지던시 정책 digest <span className="m">{p.residency.digest.slice(0, 12)}</span> (감사 로그에 같은 값이 남습니다)
        </div>
      )}
    </div>
  );
}

function AiView({ v }: { v: MigrationView }) {
  const [picked, setPicked] = useState<string | null>(null);
  const all = v.sessions.flatMap((s) => v.sessionEvents(s.id));
  const pick = (id: string) => {
    setPicked(id);
    v.selectSession(id);
  };
  const shown = v.sessions.find((s) => s.id === picked) ?? v.sessions[0];
  return (
    <>
      <ApproveBox v={v} />
      <PreflightBox p={v.preflight} />
      <div className="split">
        <PlanBox v={v} />
        <div className="sec">
          {shown ? (
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
          )}
        </div>
      </div>
      {v.sessions.length > 0 && (
        <section className="sec">
          <h2>AI 세션</h2>
          <div className="box">
            <SessionTable sessions={v.sessions} onPick={pick} picked={shown?.id} />
          </div>
        </section>
      )}
      <div className="split">
        <BlockedTable events={all} />
        <div className="box">
          <div className="bh">
            <b>AI 수정안</b>
            <span className="hint">운영 클러스터가 아닌 환경 프로필 사본을 고칩니다</span>
          </div>
          <div className="bb">
            {v.fix ? (
              <div className="diff">
                <div className="f">{v.fix.file}</div>
                <div className="d">{"- " + v.fix.minus}</div>
                <div className="a">{"+ " + v.fix.plus}</div>
              </div>
            ) : v.plan?.attachments?.length ? (
              <p>첨부: {v.plan.attachments.map((a) => a.name).join(", ")}</p>
            ) : (
              <p className="hint">리허설이 실패하면 AI가 로그를 읽고 수정안을 냅니다.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- engine run ---------- */

function stepState(r: Run, id: string): StepState {
  const s = r.engine.steps[id]?.status ?? "pending";
  return s === "succeeded" ? "ok" : s === "running" ? "run" : s === "failed" ? "bad" : "wait";
}

function lastLag(v: MigrationView): number | undefined {
  for (let i = v.events.length - 1; i >= 0; i--) {
    const x = v.events[i].data?.lagBytes;
    if (typeof x === "number") return x;
  }
  return undefined;
}

function RunView({ v, r }: { v: MigrationView; r: Run }) {
  const ended = !["running", "awaiting_switch"].includes(r.status);
  const el = r.result.durationMillis !== undefined ? r.result.durationMillis / 1000 : secs(r.startedAt, r.endedAt ?? r.updatedAt);
  const reads = targetReadShare(r);
  const writesOnTarget = r.engine.trafficOnTarget;
  const lag = lastLag(v);
  const canAbort = (r.status === "running" || r.status === "awaiting_switch") && !r.engine.promoteRequested;
  const canResume = r.status === "failed" || r.status === "aborted" || r.status === "interrupted";
  return (
    <>
      <div className="box">
        <div className="bh">
          <b>
            {r.rollbackOf ? "롤백" : "이전"} {r.runId}
          </b>
          <RunStatusChip r={r} />
        </div>
        <div className="bb">
          <div className="steps9">
            {ENGINE_STEPS.map((s) => {
              const st = stepState(r, s.id);
              return (
                <div key={s.id} title={s.detail}>
                  <Ind st={st} />
                  <span>
                    {s.label}
                    <small>{PHASE_LABEL[s.phase]}</small>
                  </span>
                </div>
              );
            })}
          </div>
          {r.statusReason && <p className="hint">{r.statusReason}</p>}
          <div className="actrow">
            {r.status === "awaiting_switch" && (
              <button type="button" className="btn primary" disabled={v.busy} onClick={v.doSwitch}>
                전환
              </button>
            )}
            {canAbort && (
              <button type="button" className="btn ghost" disabled={v.busy} onClick={v.abort}>
                중단
              </button>
            )}
            {canResume && (
              <button type="button" className="btn primary" disabled={v.busy} onClick={v.resume}>
                이어서 실행
              </button>
            )}
            {r.status === "succeeded" && (
              <button type="button" className="btn ghost" disabled={v.busy} onClick={v.rollback}>
                롤백
              </button>
            )}
            {ended && (
              <button type="button" className="btn ghost" onClick={v.reset}>
                다른 경로로 이전
              </button>
            )}
            {r.status === "awaiting_switch" && <span className="hint">데이터가 맞춰졌고 카나리 게이트를 모두 통과했습니다. 전환하면 쓰기를 잠시 붙잡고 대상을 승격합니다.</span>}
          </div>
        </div>
      </div>
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>이전 경과</b>
            <span className="hint">목표 {mmss(TARGET_SEC)} 이내 (시작부터, 전환 승인 대기 포함)</span>
          </div>
          <div className="bb">
            <div className="timer">
              <span className="big">{mmss(el)}</span>
              <div className="bar">
                <i style={{ width: Math.min(100, (el / TARGET_SEC) * 100) + "%" }} />
              </div>
            </div>
            <p className="hint">
              {r.engine.promoteRequested
                ? v.tgtLabel + " 승격을 요청했습니다. 지금부터 실패하면 원복하지 않고 멈춥니다(halted)."
                : "대상 승격 전입니다. 실패하면 " + v.srcLabel + "로 자동 원복합니다(rolled_back)."}
            </p>
          </div>
        </div>
        <div className="box">
          <div className="bh">
            <b>트래픽</b>
            <span className="hint">게이트웨이 기준</span>
          </div>
          <div className="bb">
            <TrafficBar label="읽기" src={v.srcLabel} tgt={v.tgtLabel} tgtShare={reads} />
            <TrafficBar label="쓰기" src={v.srcLabel} tgt={v.tgtLabel} tgtShare={writesOnTarget ? 100 : 0} held={r.engine.writesHeld} />
          </div>
        </div>
      </div>
      <div className="metrics">
        {v.counters && <Metric label="성공한 쓰기 (k6)" value={fmt(v.counters.ok)} note="부하 생성기 기준" />}
        <Metric label="게이트웨이 요청" value={fmt(r.result.requests ?? 0)} note="이번 이전 동안" />
        <Metric label="실패 요청" value={fmt(r.result.failedRequests ?? 0) + "건"} note="5xx와 프록시 오류" good={(r.result.failedRequests ?? 0) === 0} />
        <Metric label="복제 지연" value={lag === undefined ? "-" : fmt(lag) + " B"} note={v.srcLabel + " → " + v.tgtLabel} />
        <Metric
          label="쓰기 보류"
          value={r.engine.writesHeld ? "보류 중" : r.result.downtimeMillis !== undefined ? (r.result.downtimeMillis / 1000).toFixed(1) + "초" : "-"}
          note={v.counters && r.engine.writesHeld ? "보류 중인 쓰기 " + fmt(v.counters.held) + "건" : "상한 " + (v.plan?.summary.maxDowntime ?? "30s")}
        />
      </div>
      <PreflightBox p={v.preflight} />
      <CanaryBox r={r} />
      <ObserveBox r={r} />
      {ended && <ResultBox r={r} v={v} />}
      <section className="sec">
        <h2>엔진 기록</h2>
        <LogBox lines={runLines(r.startedAt, v.events)} />
      </section>
      {v.sessions.length > 0 && (
        <details className="box fold">
          <summary className="bh">
            <b>AI 계획과 리허설 기록</b>
            <Chip kind="ok">세션 {v.sessions.length}개</Chip>
          </summary>
          <div className="bb">
            <SessionTable sessions={v.sessions} />
            {v.sessions.map((s) => (
              <SessionFeed key={s.id} s={s} events={v.sessionEvents(s.id)} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function TrafficBar({ label, src, tgt, tgtShare, held }: { label: string; src: string; tgt: string; tgtShare: number; held?: boolean }) {
  const old = 100 - tgtShare;
  return (
    <div className="trafficrow">
      <span className="tl">
        {label}
        {held && <Chip kind="run">보류 중</Chip>}
      </span>
      <div className="traffic" role="img" aria-label={`${label}: ${src} ${old}%, ${tgt} ${tgtShare}%`}>
        <div className={"seg old" + (old === 0 ? " gone" : "")} style={{ flexBasis: old + "%" }}>
          {src} {old}%
        </div>
        <div className={"seg new" + (tgtShare === 0 ? " gone" : "")} style={{ flexBasis: tgtShare + "%" }}>
          {tgt} {tgtShare}%
        </div>
      </div>
    </div>
  );
}

function CanaryBox({ r }: { r: Run }) {
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
            td(i + 1 + "단계", "m"),
            td(w + "%", "m"),
            td(chip),
            td(g ? fmt(g.requests) : "-", "m"),
            td(g ? (g.errorRate * 100).toFixed(2) + "%" : "-", "m"),
            td(g ? g.p95Millis + "ms" : "-", "m"),
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
              td(i + 1 + "단계", "m"),
              td(verdict(s)),
              td(g ? fmt(g.requests) : "-", "m"),
              td(g ? (g.errorRate * 100).toFixed(2) + "%" : "-", "m"),
              td(g ? g.p95Millis + "ms" : "-", "m"),
            ];
          })}
        />
      )}
    </div>
  );
}

function ResultBox({ r, v }: { r: Run; v: MigrationView }) {
  const x = r.result;
  const n = (k: number | undefined, unit: string) => (k === undefined ? "측정 안 됨" : fmt(k) + unit);
  const zero = (k: number | undefined) => k === 0;
  return (
    <div className="box">
      <div className="bh">
        <b>{r.rollbackOf ? "롤백" : "이전"} 리포트</b>
        <RunStatusChip r={r} />
      </div>
      <div className="bb">
        <div className="metrics">
          <Metric label="전체" value={x.durationMillis !== undefined ? dur(x.durationMillis / 1000) : "-"} note={"목표 " + dur(TARGET_SEC) + " 이내"} good={(x.durationMillis ?? Infinity) <= TARGET_SEC * 1000} />
          <Metric label="쓰기 보류" value={x.downtimeMillis !== undefined ? (x.downtimeMillis / 1000).toFixed(1) + "초" : "-"} note="게이트웨이가 쓰기를 붙잡은 시간" />
          <Metric label="실패 요청" value={n(x.failedRequests, "건")} note={"요청 " + fmt(x.requests ?? 0) + "건 중"} good={zero(x.failedRequests)} />
          <Metric label="누락 행" value={n(x.missingRows, "건")} note="원본에 있고 대상에 없는 행" good={zero(x.missingRows)} />
          <Metric label="누락 쓰기" value={n(x.missingWrites, "건")} note="k6가 성공 응답을 받은 쓰기 대조" good={zero(x.missingWrites)} />
          <Metric label="누락 파일" value={n(x.missingFiles, "개")} note="크기와 해시 비교" good={zero(x.missingFiles)} />
        </div>
        <p className="hint">
          {x.verified ? "검증 리포트에 문제가 없습니다." : "검증이 끝나지 않았거나 문제가 있습니다."} {r.status === "succeeded" && "원본은 읽기 전용으로 남아 있고, 롤백하면 같은 방법으로 " + v.srcLabel + "로 되돌립니다."}
        </p>
      </div>
    </div>
  );
}
