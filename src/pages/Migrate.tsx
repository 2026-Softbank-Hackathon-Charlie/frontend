import type { ReactNode } from "react";
import { EmptyShop } from "../components/shared";
import { Chip, Ind, LogBox, PageHead, ProgItem, Table, td } from "../components/ui";
import {
  BLOCKED,
  CL_END,
  CL_ITEMS,
  ENV,
  ENV_ORDER,
  HOLD_MAX,
  PLAN_END,
  PREP_END,
  SAMPLE,
  SANDBOX,
  STEPS,
  SW_END,
  SW_ITEMS,
  TARGET_SEC,
  planChecks,
  planJson,
  prepItems,
  type EnvKey,
} from "../sim/data";
import { dur, fmt, mmss, ST, stOf, type StepState } from "../sim/format";
import {
  execT,
  filesCopied,
  filesTotal,
  holdT,
  lagText,
  migLabel,
  oldShare,
  pastPointOfNoReturn,
  rep,
  routeLabel,
  type SimState,
} from "../sim/state";
import { useSim } from "../sim/store";

export function MigrateList() {
  const { S } = useSim();
  const a = S.apps[SAMPLE.id];
  const m = S.mig;
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
      {!a ? (
        <EmptyShop />
      ) : (
      <div className="box">
        <Table
          head={["앱", "현재 위치", "상태", ""]}
          rows={[
            [
              td(<a href={"#app-" + SAMPLE.id}>{SAMPLE.id}</a>),
              td(ENV[a.loc ?? "aws"].name),
              td(m.phase === "idle" ? <Chip>이전 전</Chip> : m.phase === "done" ? <Chip kind="ok">이전 완료</Chip> : <Chip kind="run">{migLabel(S)}</Chip>),
              td(
                <a className="btn ghost" href="#migrate-shop">
                  {m.phase === "idle" ? "이전 설정" : "열기"}
                </a>,
              ),
            ],
          ]}
        />
      </div>
      )}
      <p className="hint">이 시연에서는 {SAMPLE.id}만 이전할 수 있습니다. 한 번 옮긴 뒤 다른 경로로 다시 옮길 수 있습니다.</p>
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
function wizStep(S: SimState): number {
  const p = S.mig.phase;
  return p === "plan" ? 1 : p === "rehearse" ? 2 : p === "approve" ? 3 : p === "done" ? 5 : 4;
}

function Wizard() {
  const { S } = useSim();
  const cur = wizStep(S);
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

export function Migrate() {
  const { S, dispatch } = useSim();
  const m = S.mig;
  const title = SAMPLE.id + " 이전";
  if (!S.apps[SAMPLE.id]) {
    return (
      <div className="page">
        <PageHead title={title} crumb={crumb} />
        <EmptyShop />
      </div>
    );
  }

  if (m.phase === "idle") {
    return (
      <div className="page">
        <PageHead title={title} sub="가동 중인 앱을 데이터와 함께 옮깁니다." crumb={crumb} />
        <div className="split">
          <div className="box">
            <div className="bh">
              <b>이전 설정</b>
            </div>
            <div className="bb">
              <div className="form">
                <div className="field">
                  <label htmlFor="mig-src">원본</label>
                  <input id="mig-src" value={ENV[m.src].name + " (게이트웨이 100%)"} readOnly />
                </div>
                <div className="field">
                  <label htmlFor="mig-target">옮겨 갈 환경</label>
                  <select id="mig-target" value={m.tgt} onChange={(e) => dispatch({ type: "mig-target", env: e.target.value as EnvKey })}>
                    {ENV_ORDER.filter((k) => k !== m.src).map((k) => (
                      <option key={k} value={k}>
                        {ENV[k].name}
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
              <ProgItem st="wait" title="AI 계획" sub="AI가 읽기 전용 도구로 두 클러스터를 조회하고 Plan JSON을 만듭니다. 플랫폼이 스키마와 고정 규칙으로 검사합니다." right="자동" />
              <ProgItem st="wait" title="리허설" sub={"대상 클러스터의 격리된 샌드박스에서 테스트 데이터로 Plan을 실행합니다. 실패하면 AI가 원인을 진단하고 수정안을 냅니다."} right="자동" />
              <ProgItem st="wait" title="승인" sub="Plan, 리허설 결과, AI 수정안을 보고 운영자가 승인합니다. 이 단계 전에는 운영 환경을 바꾸지 않습니다." right="운영자" />
              <ProgItem st="wait" title="실행" sub="미리 복사, 변경분 동기화, 쓰기 경계, 최종 반영 확인, 전환, 원본 정리를 엔진이 순서대로 실행합니다." right="3분 이내" />
            </ul>
          </div>
        </div>
        <div className="actrow">
          <button type="button" className="btn primary" onClick={() => dispatch({ type: "mig-plan" })}>
            AI 계획 시작
          </button>
          <span className="hint">AI는 계획과 수정안만 만듭니다. 운영 클러스터를 바꾸는 권한은 엔진에만 있습니다.</span>
        </div>
      </div>
    );
  }

  const ai = m.phase === "plan" || m.phase === "rehearse" || m.phase === "approve";
  return (
    <div className="page">
      <PageHead title={title} sub={routeLabel(m.src, m.tgt)} crumb={crumb} />
      <Wizard />
      {ai ? <AiView /> : <ExecView />}
    </div>
  );
}

/* ---------- AI plan, rehearsal, approval ---------- */

function PlanBox() {
  const { S } = useSim();
  const m = S.mig;
  const t = m.phase === "plan" ? m.ai.t : 999;
  const checks = planChecks().filter((c) => t >= c[0]);
  const ready = t >= PLAN_END;
  return (
    <div className="box">
      <div className="bh">
        <b>Plan</b>
        {ready ? <Chip kind="ok">검사 통과</Chip> : <Chip kind="run">AI 작성 중</Chip>}
      </div>
      <div className="bb">
        {t >= 21 ? <pre className="code">{planJson(m.src, m.tgt)}</pre> : <p className="hint">AI가 두 클러스터를 조회하고 있습니다.</p>}
        {checks.length > 0 && (
          <Table head={["플랫폼 검사", "결과"]} rows={checks.map((c) => [td(c[1]), td(c[2] ? <Chip kind="ok">통과</Chip> : <Chip kind="bad">실패, 다시 요청</Chip>)])} />
        )}
      </div>
    </div>
  );
}

function RehearsalBox() {
  const { S } = useSim();
  const m = S.mig;
  const t = m.phase === "rehearse" ? m.ai.t : m.phase === "plan" ? -1 : 999;
  if (t < 0) return null;
  const s = ENV[m.src];
  const g = ENV[m.tgt];
  const att = [];
  if (t >= 10) att.push([td("1차", "m"), td(t >= 28 ? <Chip kind="bad">실패</Chip> : <Chip kind="run">진행 중</Chip>), td(t >= 28 ? "대상 DB의 PVC가 Pending. StorageClass " + s.sc + "가 " + g.name + "에 없음" : "Plan 6단계를 테스트 데이터로 실행 중")]);
  if (t >= 42) att.push([td("2차", "m"), td(t >= 64 ? <Chip kind="ok">통과</Chip> : <Chip kind="run">진행 중</Chip>), td(t >= 64 ? "데이터 10,000/10,000 일치, 스모크 테스트 12/12, 원본 차단 테스트 통과" : "AI 수정안을 적용해 다시 실행 중")]);
  const blk = BLOCKED.filter((b) => t >= b[0]);
  return (
    <div className="split">
      <div className="sec">
        <div className="box">
          <div className="bh">
            <b>샌드박스</b>
            {t >= 70 ? <Chip>삭제됨</Chip> : <Chip kind="run">실행 중</Chip>}
          </div>
          <div className="bb">
            <dl className="kv">
              <dt>네임스페이스</dt>
              <dd className="m">{SANDBOX.ns}</dd>
              <dt>위치</dt>
              <dd>{g.name}</dd>
              <dt>자원 한도</dt>
              <dd>{SANDBOX.quota}</dd>
              <dt>네트워크</dt>
              <dd>{SANDBOX.net}</dd>
              <dt>데이터</dt>
              <dd>{SANDBOX.data}</dd>
              <dt>자동 삭제</dt>
              <dd>{SANDBOX.ttl}</dd>
            </dl>
          </div>
        </div>
        <div className="box">
          <div className="bh">
            <b>리허설</b>
          </div>
          {att.length ? <Table head={["회차", "결과", "내용"]} rows={att} /> : <div className="bb"><p className="hint">샌드박스를 준비하고 있습니다.</p></div>}
        </div>
        <div className="box">
          <div className="bh">
            <b>막힌 명령</b>
            <Chip>{blk.length}건</Chip>
          </div>
          {blk.length ? (
            <Table head={["AI 권한으로 시도한 명령", "막은 장치", ""]} rows={blk.map((b) => [td(b[1], "m"), td(b[2]), td(<Chip kind="bad">차단</Chip>)])} />
          ) : (
            <div className="bb">
              <p className="hint">아직 없습니다.</p>
            </div>
          )}
        </div>
      </div>
      <div className="sec">
        <div className="box">
          <div className="bh">
            <b>AI 수정안</b>
            <span className="hint">운영 클러스터가 아닌 환경 프로필을 고칩니다</span>
          </div>
          <div className="bb">
            {t >= 36 ? (
              <div className="diff">
                <div className="f">{"deploy/values-" + m.tgt + ".yaml"}</div>
                <div className="d">{"-  storageClass: " + s.sc}</div>
                <div className="a">{"+  storageClass: " + g.sc}</div>
              </div>
            ) : (
              <p className="hint">리허설이 실패하면 AI가 로그를 읽고 수정안을 냅니다.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ApproveBox() {
  const { S, dispatch } = useSim();
  const m = S.mig;
  if (m.phase !== "approve") return null;
  return (
    <div className="box fillbox">
      <div className="bb">
        <b>Plan을 승인할까요?</b>
        <dl className="kv">
          <dt>경로</dt>
          <dd>{routeLabel(m.src, m.tgt)}</dd>
          <dt>예상 시간</dt>
          <dd>전체 {dur(PREP_END + SW_END + CL_END)}, 쓰기 보류 약 6초 (최대 {HOLD_MAX}초)</dd>
          <dt>확인</dt>
          <dd>
            <div className="chips">
              <Chip kind="ok">스키마·고정 검사 통과</Chip>
              <Chip kind="ok">리허설 2차 통과</Chip>
              <Chip kind="ok">AI 수정안 1건 포함</Chip>
              <Chip>막힌 명령 2건</Chip>
            </div>
          </dd>
          <dt>원복</dt>
          <dd>대상이 쓰기를 받기 전까지는 실패하면 원본으로 자동 원복합니다. 그 뒤에는 원복하지 않고 멈춥니다.</dd>
        </dl>
        <div className="actrow">
          <button type="button" className="btn primary" onClick={() => dispatch({ type: "mig-approve" })}>
            승인하고 실행
          </button>
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: "mig-reject" })}>
            반려
          </button>
        </div>
      </div>
    </div>
  );
}

function AiView() {
  const { S } = useSim();
  const m = S.mig;
  return (
    <>
      <ApproveBox />
      <div className="split">
        <PlanBox />
        <div className="box">
          <div className="bh">
            <b>AI 작업 기록</b>
            {m.phase === "approve" ? <Chip kind="ok">완료</Chip> : <Chip kind="run">{migLabel(S)}</Chip>}
          </div>
          <div className="bb">
            <LogBox lines={m.ai.log} />
            <dl className="kv sm">
              <dt>운영 클러스터</dt>
              <dd>읽기 전용</dd>
              <dt>샌드박스</dt>
              <dd>자기 네임스페이스 하나만</dd>
              <dt>DB 관리자 계정</dt>
              <dd>받지 않음</dd>
            </dl>
          </div>
        </div>
      </div>
      <RehearsalBox />
    </>
  );
}

/* ---------- engine run ---------- */

function stepState(S: SimState, i: number): StepState {
  const m = S.mig;
  const [, , ph, s, e] = STEPS[i];
  const order = ["prep", "switch", "cleanup"];
  const cur = m.phase === "done" ? 3 : order.indexOf(m.phase);
  const mine = order.indexOf(ph);
  if (cur > mine) return "ok";
  if (cur < mine) return "wait";
  return stOf(m.t, s, e);
}

function ExecView() {
  const { S } = useSim();
  const m = S.mig;
  const sName = ENV[m.src].name;
  const tName = ENV[m.tgt].name;
  const old = oldShare(S);
  const el = execT(S);
  return (
    <>
      <div className="steps6">
        {STEPS.map((s, i) => {
          const st = stepState(S, i);
          return (
            <div key={s[0]} title={s[1]}>
              <Ind st={st} />
              <span>
                {s[0]}
                <small>{ST[st]}</small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>이전 경과</b>
            <span className="hint">목표 {mmss(TARGET_SEC)} 이내</span>
          </div>
          <div className="bb">
            <div className="timer">
              <span className="big">{mmss(el)}</span>
              <div className="bar">
                <i style={{ width: Math.min(100, (el / TARGET_SEC) * 100) + "%" }} />
              </div>
            </div>
            <p className="hint">
              {pastPointOfNoReturn(S)
                ? tName + "가 쓰기를 받고 있습니다. 지금부터 실패하면 원복하지 않고 멈춥니다."
                : "대상이 쓰기를 받기 전입니다. 실패하면 " + sName + "로 자동 원복합니다."}
            </p>
          </div>
        </div>
        <div className="box">
          <div className="bh">
            <b>트래픽</b>
            <span className="hint">게이트웨이 기준</span>
          </div>
          <div className="bb">
            <div className="traffic" role="img" aria-label={`${sName} ${old}%, ${tName} ${100 - old}%`}>
              <div className={"seg old" + (old === 0 ? " gone" : "")} style={{ flexBasis: old + "%" }}>
                {sName}
              </div>
              <div className={"seg new" + (old === 100 ? " gone" : "")} style={{ flexBasis: 100 - old + "%" }}>
                {tName}
              </div>
            </div>
            <div className="legend">
              <span>
                <i className="sw" style={{ background: "var(--old)" }} />
                {sName} <b>{old}%</b>
              </span>
              <span>
                <i className="sw" style={{ background: "var(--fg)" }} />
                {tName} <b>{100 - old}%</b>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="metrics">
        <Metric label="성공한 쓰기 (k6)" value={fmt(m.ok)} note="부하 생성기 기준" />
        <Metric label="새 DB 반영" value={fmt(rep(S))} note={tName} />
        <Metric label="실패 요청" value="0건" note="전환 중 포함" good />
        <Metric label="DB 복제 지연" value={lagText(S)} note={sName + " → " + tName} />
        <Metric label="파일" value={fmt(filesCopied(S)) + " / " + fmt(filesTotal(S))} note="새 저장소 / 원본" />
        <Metric label="쓰기 보류" value={holdT(S).toFixed(1) + "초"} note={"최대 " + HOLD_MAX + "초"} />
      </div>
      <Panel />
      <section className="sec">
        <h2>엔진 기록</h2>
        <LogBox lines={m.log} />
      </section>
      <details className="box fold">
        <summary className="bh">
          <b>AI 계획과 리허설 기록</b>
          <Chip kind="ok">승인됨</Chip>
        </summary>
        <div className="bb">
          <pre className="code">{planJson(m.src, m.tgt)}</pre>
          <LogBox lines={m.ai.log} />
        </div>
      </details>
    </>
  );
}

function Panel() {
  const { S, dispatch } = useSim();
  const m = S.mig;
  const phs = m.phase;

  if (phs === "prep") {
    return (
      <div className="box">
        <div className="bh">
          <b>미리 복사, 변경분 동기화</b>
          <Chip kind="run">진행 중</Chip>
        </div>
        <ul className="prog">
          {prepItems(m.src, m.tgt).map((it) => {
            const st = stOf(m.t, it[2], it[3]);
            return <ProgItem key={it[0]} st={st} title={it[0]} sub={it[1]} right={st === "ok" ? mmss(it[3]) : ST[st]} />;
          })}
        </ul>
      </div>
    );
  }
  if (phs === "switch") {
    let acc = 0;
    return (
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>쓰기 경계, 최종 반영 확인, 전환</b>
            <Chip kind="run">진행 중</Chip>
          </div>
          <ul className="prog">
            {SW_ITEMS.map((it) => {
              const s = acc;
              acc = Math.round((acc + it[1]) * 10) / 10;
              const st = stOf(m.t, s, acc);
              return <ProgItem key={it[0]} st={st} title={it[0]} right={st === "ok" ? it[1].toFixed(1) + "초" : ST[st]} />;
            })}
          </ul>
        </div>
        <div className="metrics">
          <Metric label="보류 중인 쓰기" value={fmt(!m.flipped ? m.held : 0)} note="전환 후 새 환경으로 전달" />
          <Metric label="전달한 쓰기" value={fmt(m.heldDone)} note="모두 처리됨" />
        </div>
      </div>
    );
  }

  // cleanup / done
  const tc = phs === "done" ? 999 : m.t;
  const tot = PREP_END + SW_END + CL_END;
  const bars: [number, string][] = [
    [PREP_END, "복사·동기화 " + dur(PREP_END)],
    [SW_END, ""],
    [CL_END, "정리 " + dur(CL_END)],
  ];
  return (
    <>
      <div className="box">
        <div className="bh">
          <b>원본 정리</b>
          {phs === "done" ? <Chip kind="ok">완료</Chip> : <Chip kind="run">진행 중</Chip>}
        </div>
        <ul className="prog">
          {CL_ITEMS.map((it) => {
            const st = stOf(tc, it[2], it[3]);
            return <ProgItem key={it[0]} st={st} title={it[0]} sub={it[1] || undefined} right={st === "ok" ? "완료" : ST[st]} />;
          })}
        </ul>
      </div>
      {phs === "done" && (
        <div className="box">
          <div className="bh">
            <b>이전 리포트</b>
            <Chip kind="ok">누락 0건</Chip>
          </div>
          <div className="bb">
            <div className="metrics">
              <Metric label="전체 이전" value={dur(tot)} note={"목표 " + dur(TARGET_SEC) + " 이내"} good />
              <Metric label="전환" value={SW_END + "초"} note="쓰기 경계부터 응답 확인까지" />
              <Metric label="쓰기 보류" value={holdT(S).toFixed(1) + "초"} note={"최대 " + HOLD_MAX + "초"} />
              <Metric label="실패 요청" value="0건" note="k6 기준" good />
              <Metric label="누락 쓰기" value="0건" note={"성공 " + fmt(m.ok) + " = 새 DB " + fmt(m.ok)} good />
              <Metric label="누락 파일" value="0개" note={"원본 " + fmt(filesTotal(S)) + " = 새 저장소 " + fmt(filesTotal(S))} good />
            </div>
            <div className="durbar" aria-hidden="true">
              {bars.map((x, i) => (
                <div key={i} style={{ flex: "0 0 calc(" + (x[0] / tot) * 100 + "% - 2px)" }} />
              ))}
            </div>
            <div className="durlab">
              {bars.map((x, i) => (
                <div key={i} style={{ flex: "0 0 calc(" + (x[0] / tot) * 100 + "% - 2px)" }}>
                  {x[1]}
                </div>
              ))}
            </div>
            <p className="hint">가운데의 좁은 칸이 전환({SW_END}초)입니다. 막대는 실제 시간 비율대로 그렸습니다.</p>
            <Table
              head={["남은 리소스", "상태", ""]}
              rows={[
                [
                  td(ENV[m.src].name + "의 " + SAMPLE.db + ", " + SAMPLE.bucket),
                  td(<Chip>읽기 전용</Chip>),
                  td(
                    m.del ? (
                      <Chip kind="ok">삭제 예약됨</Chip>
                    ) : (
                      <button type="button" className="btn ghost" onClick={() => dispatch({ type: "mig-del" })}>
                        삭제 승인
                      </button>
                    ),
                  ),
                ],
              ]}
            />
            <div className="actrow">
              <button type="button" className="btn primary" onClick={() => dispatch({ type: "mig-new" })}>
                다른 경로로 이전
              </button>
              <a className="btn ghost" href="#routes">
                경로별 결과
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

