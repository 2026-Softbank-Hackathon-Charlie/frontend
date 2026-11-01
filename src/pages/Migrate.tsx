import type { ReactNode } from "react";
import { EmptyShop } from "../components/shared";
import { Chip, Ind, LogBox, PageHead, ProgItem, Table, td } from "../components/ui";
import { CL_END, CL_ITEMS, ENV, ENV_ORDER, PREP_END, SW_END, SW_ITEMS, prepItems, type EnvKey } from "../sim/data";
import { dur, fmt, mmss, ST, stOf, type StepState } from "../sim/format";
import { filesCopied, filesTotal, holdT, lagText, migLabel, oldShare, rep } from "../sim/state";
import { useSim } from "../sim/store";

export function MigrateList() {
  const { S } = useSim();
  const a = S.apps.shop;
  const m = S.mig;
  return (
    <div className="page">
      <PageHead title="이전" sub="가동 중인 앱을 데이터와 함께 다른 환경으로 옮깁니다. 사용자가 영향을 받는 전환 구간은 1분 이내입니다." />
      {a ? (
        <>
          <div className="box">
            <Table
              head={["앱", "현재 위치", "상태", ""]}
              rows={[
                [
                  td(<a href="#app-shop">shop</a>),
                  td(a.loc === "legacy" || !a.loc ? "기존 AWS (EC2, RDS, S3)" : ENV[a.loc].name),
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
          <p className="hint">이 시연에서는 shop만 이전할 수 있습니다.</p>
        </>
      ) : (
        <EmptyShop />
      )}
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

export function Migrate() {
  const { S, dispatch } = useSim();
  if (!S.apps.shop) {
    return (
      <div className="page">
        <PageHead title="shop 이전" crumb={crumb} />
        <EmptyShop />
      </div>
    );
  }
  const m = S.mig;
  const tg = ENV[m.target];

  if (m.phase === "idle") {
    return (
      <div className="page">
        <PageHead title="shop 이전" sub="가동 중인 shop을 데이터와 함께 옮깁니다." crumb={crumb} />
        <div className="split">
          <div className="box">
            <div className="bh">
              <b>이전 설정</b>
            </div>
            <div className="bb">
              <div className="form">
                <div className="field">
                  <label htmlFor="mig-src">원본</label>
                  <input id="mig-src" value="기존 AWS (EC2, RDS, S3)" readOnly />
                </div>
                <div className="field">
                  <label htmlFor="mig-target">옮겨 갈 환경</label>
                  <select id="mig-target" value={m.target} onChange={(e) => dispatch({ type: "mig-target", env: e.target.value as EnvKey })}>
                    {ENV_ORDER.map((k) => (
                      <option key={k} value={k}>
                        {ENV[k].name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="checks">
                  <label>
                    <input type="checkbox" id="mig-auto" checked={m.auto} onChange={(e) => dispatch({ type: "mig-auto", on: e.target.checked })} /> 준비가 끝나면 바로
                    전환
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div className="box">
            <div className="bh">
              <b>진행 순서</b>
            </div>
            <ul className="prog">
              <ProgItem
                st="wait"
                title="준비"
                sub={tg.name + "에 네임스페이스, DB, 버킷을 만들고 앱을 배포한 뒤 DB와 S3를 동기화합니다. 사용자 요청은 계속 기존 앱이 받습니다."}
                right="2~3분"
              />
              <ProgItem
                st="wait"
                title="전환"
                sub="쓰기 요청을 잠시 붙잡고, 기존 DB의 쓰기를 막고, 마지막 변경까지 옮긴 뒤 트래픽을 넘깁니다. 30초 안에 끝나지 않으면 자동으로 취소합니다."
                right="1분 이내"
              />
              <ProgItem st="wait" title="정리" sub="원본 EC2를 멈추고, 원본으로 가는 사설망을 끊은 상태에서 스모크 테스트를 돌립니다." right="1분 안팎" />
            </ul>
          </div>
        </div>
        <div className="actrow">
          <button type="button" className="btn primary" onClick={() => dispatch({ type: "mig-start" })}>
            이전 시작
          </button>
          <span className="hint">부하 생성기가 이전하는 내내 주문과 이미지 업로드를 보냅니다.</span>
        </div>
      </div>
    );
  }

  const phs = m.phase;
  const pst: StepState[] =
    phs === "prep"
      ? ["run", "wait", "wait"]
      : phs === "ready" || phs === "confirm"
        ? ["ok", "wait", "wait"]
        : phs === "switch"
          ? ["ok", "run", "wait"]
          : phs === "switched"
            ? ["ok", "ok", "wait"]
            : phs === "cleanup"
              ? ["ok", "ok", "run"]
              : ["ok", "ok", "ok"];
  const old = oldShare(S);

  return (
    <div className="page">
      <PageHead title="shop 이전" sub={"기존 AWS (EC2, RDS, S3)에서 " + tg.name + "로"} crumb={crumb} />
      <div className="phases">
        {["준비", "전환", "정리"].map((n, i) => (
          <div key={n}>
            <Ind st={pst[i]} />
            <span>
              {n} {pst[i] === "ok" ? "완료" : pst[i] === "run" ? "진행 중" : "대기"}
            </span>
          </div>
        ))}
      </div>
      <div className="metrics">
        <Metric label="이전 경과 (대기 제외)" value={dur(m.tPrep + m.tSw + m.tCl)} note="참고 지표" />
        <Metric label="전환" value={m.tSw ? m.tSw.toFixed(1) + "초" : "대기"} note="목표 1분 이내" />
        <Metric label="성공 응답 주문" value={fmt(m.ok)} note="부하 생성기 기준" />
        <Metric label="새 DB 반영" value={fmt(rep(S))} note={tg.name} />
        <Metric label="실패 요청" value="0건" note="전환 중 포함" good />
        <Metric label="DB 복제 지연" value={lagText(S)} note="RDS에서 새 DB로" />
        <Metric label="S3 파일" value={fmt(filesCopied(S)) + " / " + fmt(filesTotal(S))} note="새 저장소 / 원본" />
      </div>
      <div className="box">
        <div className="bh">
          <b>트래픽</b>
          <span className="hint">게이트웨이 기준</span>
        </div>
        <div className="bb">
          <div className="traffic" role="img" aria-label={`기존 AWS (EC2) ${old}%, ${tg.name} ${100 - old}%`}>
            <div className="seg old" style={{ flexBasis: old + "%" }}>
              기존 AWS (EC2)
            </div>
            <div className="seg new" style={{ flexBasis: 100 - old + "%" }}>
              {tg.name}
            </div>
          </div>
          <div className="legend">
            <span>
              <i className="sw" style={{ background: "var(--old)" }} />
              기존 AWS (EC2) <b>{old}%</b>
            </span>
            <span>
              <i className="sw" style={{ background: "var(--fg)" }} />
              {tg.name} <b>{100 - old}%</b>
            </span>
          </div>
        </div>
      </div>
      <Panel />
      <section className="sec">
        <h2>이전 기록</h2>
        <LogBox lines={m.log} />
      </section>
    </div>
  );
}

function Panel() {
  const { S, dispatch } = useSim();
  const m = S.mig;
  const tg = ENV[m.target];
  const phs = m.phase;

  if (phs === "prep") {
    return (
      <div className="box">
        <div className="bh">
          <b>준비</b>
          <Chip kind="run">진행 중</Chip>
        </div>
        <ul className="prog">
          {prepItems(m.target).map((it) => {
            const st = stOf(m.t, it[2], it[3]);
            return <ProgItem key={it[0]} st={st} title={it[0]} sub={it[1]} right={st === "ok" ? mmss(it[3]) : ST[st]} />;
          })}
        </ul>
      </div>
    );
  }
  if (phs === "ready") {
    return (
      <div className="box okbox" role="status">
        <div className="bb">
          <b>전환 준비가 끝났습니다.</b>
          <p>복제 지연 0.4초, S3 복사가 최신입니다. 전환하면 사용자 요청이 {tg.name}로 넘어가고, 쓰기 요청은 잠시(최대 30초) 기다립니다.</p>
          <div className="actrow">
            <button type="button" className="btn primary" onClick={() => dispatch({ type: "mig-switch" })}>
              전환
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (phs === "confirm") {
    return (
      <div className="box fillbox">
        <div className="bb">
          <b>지금 전환할까요?</b>
          <p>전환하는 동안 쓰기 요청은 게이트웨이에서 잠시 기다리고, 읽기 요청은 계속 처리됩니다. 30초 안에 끝나지 않으면 자동으로 취소하고 원래대로 돌립니다.</p>
          <div className="actrow">
            <button type="button" className="btn primary" onClick={() => dispatch({ type: "mig-go" })}>
              전환 실행
            </button>
            <button type="button" className="btn ghost" onClick={() => dispatch({ type: "mig-cancel" })}>
              취소
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (phs === "switch" || phs === "switched") {
    let acc = 0;
    const t = phs === "switched" ? 99 : m.t;
    return (
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>전환 절차</b>
            {phs === "switched" ? <Chip kind="ok">완료</Chip> : <Chip kind="run">진행 중</Chip>}
          </div>
          <ul className="prog">
            {SW_ITEMS.map((it) => {
              const s = acc;
              acc = Math.round((acc + it[1]) * 10) / 10;
              const st = stOf(t, s, acc);
              return <ProgItem key={it[0]} st={st} title={it[0]} right={st === "ok" ? it[1].toFixed(1) + "초" : ST[st]} />;
            })}
          </ul>
        </div>
        <div className="sec">
          <div className="metrics">
            <Metric label="쓰기 보류" value={holdT(S).toFixed(1) + "초"} note="최대 30초" />
            <Metric label="보류 중인 쓰기" value={fmt(phs === "switch" && !m.flipped ? m.held : 0)} note="전환 후 새 환경으로 전달" />
            <Metric label="전달한 쓰기" value={fmt(m.heldDone)} note="모두 처리됨" />
          </div>
          {phs === "switched" && (
            <div className="box okbox" role="status">
              <div className="bb">
                <b>전환 완료: 13.6초, 실패 요청 0건</b>
                <p>원본은 정리 전까지 읽기 전용으로 남겨 둡니다. 롤백을 한다면 이 구간에서만 가능합니다.</p>
                <div className="actrow">
                  <button type="button" className="btn primary" onClick={() => dispatch({ type: "mig-clean" })}>
                    정리 실행
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // cleanup / done
  const tc = phs === "done" ? 999 : m.t;
  const tot = PREP_END + SW_END + CL_END;
  const bars: [number, string, string][] = [
    [PREP_END, "준비 2분 31초", "준비 2분 31초"],
    [SW_END, "전환", ""],
    [CL_END, "정리 1분 7초", "정리 1분 7초"],
  ];
  return (
    <>
      <div className="box">
        <div className="bh">
          <b>정리</b>
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
              <Metric label="전체 이전" value={dur(tot)} note="대기 제외" />
              <Metric label="전환" value="13.6초" note="목표 1분 이내" good />
              <Metric label="쓰기 보류" value="5.6초" note="최대 30초" />
              <Metric label="누락 주문" value="0건" note={"성공 " + fmt(m.ok) + " = 새 DB " + fmt(m.ok)} good />
              <Metric label="누락 파일" value="0개" note={"원본 " + fmt(filesTotal(S)) + " = 새 저장소 " + fmt(filesTotal(S))} good />
            </div>
            <div className="durbar" aria-hidden="true">
              {bars.map((x) => (
                <div key={x[1]} style={{ flex: "0 0 calc(" + (x[0] / tot) * 100 + "% - 2px)" }} title={x[1]} />
              ))}
            </div>
            <div className="durlab">
              {bars.map((x) => (
                <div key={x[1]} style={{ flex: "0 0 calc(" + (x[0] / tot) * 100 + "% - 2px)" }}>
                  {x[2]}
                </div>
              ))}
            </div>
            <p className="hint">전환은 가운데의 좁은 칸입니다. 막대는 실제 시간 비율대로 그렸습니다.</p>
            <Table
              head={["남은 리소스", "상태", ""]}
              rows={[
                [
                  td("기존 RDS shop-db, 기존 S3 버킷 shop-files"),
                  td(<Chip>접근 차단됨</Chip>),
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
          </div>
        </div>
      )}
    </>
  );
}
