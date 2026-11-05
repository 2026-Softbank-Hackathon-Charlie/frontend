import type { ReactNode } from "react";
import { Chip, Ind, LogBox, PageHead, ProgItem, Table, td } from "../components/ui";

// The console's design system, drawn from the same tokens and classes the screens use.
// Values here must match src/styles/tokens.css; this page exists so the system can be
// reviewed (and imported into Figma) without walking through a demo run.

/** [token, value, usage, contrast note, note is a warning] */
const COLORS: [string, string, string, string, boolean?][] = [
  ["canvas", "#ffffff", "페이지와 상자 배경", ""],
  ["fg", "#333333", "본문 글자, 기본 버튼 채움, 새 환경 트래픽", "canvas 위 12.6:1"],
  ["heading", "#323232", "제목, 상자 머리글, 지표 숫자", "canvas 위 12.8:1"],
  ["muted", "#646468", "설명, 힌트, 표 머리글, 로그 시각", "canvas 위 5.9:1, fill 위 5.4:1"],
  ["hairline", "#c1c1c2", "표 머리 아래 선, 화면 머리 아래 선", "canvas 위 1.8:1. 장식용 경계라 대비 기준 밖", true],
  ["field-line", "#8a8a8f", "입력칸과 선택칸 테두리", "canvas 위 3.4:1"],
  ["fill", "#f4f4f5", "배너, 로그, 코드, 안내 상자 배경", ""],
  ["old", "#6e6e73", "원본 환경 트래픽 막대", "흰 글자 5.1:1"],
  ["ok", "#1d6b45", "완료, 통과, 정상 (글자와 표시)", "ok-bg 위 5.7:1, canvas 위 6.5:1"],
  ["ok-bg", "#e8f3ed", "완료 칩과 완료 안내 상자 배경", ""],
  ["bad", "#a3271c", "실패, 차단 (글자와 표시)", "bad-bg 위 6.3:1"],
  ["bad-bg", "#f9ebe9", "실패 칩과 실패 안내 상자 배경", ""],
  ["run", "#1f5aa6", "진행 중 (칩 글자, 진행 막대)", "run-bg 위 5.9:1, canvas 위 6.8:1"],
  ["run-bg", "#e8eff9", "진행 중 칩 배경", ""],
  ["warn", "#7a4a00", "사람을 기다림 (Plan 승인, 전환 승인)", "warn-bg 위 6.6:1, warn-tint 위 7.3:1"],
  ["warn-bg", "#fbf0dc", "대기 칩 배경", ""],
  ["warn-tint", "#fffbf3", "사람을 기다리는 상태 카드 배경 (테두리 warn-line #e6c98f)", ""],
  ["ok-tint", "#f5fbf7", "성공 상태 카드 배경 (테두리 ok-line #b7d8c4)", ""],
  ["neu", "#5f5f64", "중립 칩 글자 (대기, 미실행, 참고)", "neu-bg 위 5.6:1"],
  ["neu-bg", "#f1f1f2", "중립 칩 배경", ""],
  ["card-line", "#dcdcde", "상자 테두리", "canvas 위 1.4:1. 장식용 경계라 대비 기준 밖", true],
  ["line-soft", "#ececee", "상자 머리글 아래, 위쪽 막대 아래 구분선", ""],
  ["side-bg", "#f7f7f8", "사이드 메뉴 바탕", "muted 글자 5.5:1"],
];

/** [style, sample, spec] */
const TYPE: [string, ReactNode, string][] = [
  ["페이지 제목", <span style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.35, color: "var(--heading)" }}>moimroom 이전</span>, "32px / 1.35 / 700"],
  ["타이머", <span className="m" style={{ fontSize: 32, fontWeight: 500 }}>02:34</span>, "Mono 32px / 500, 숫자 고정폭"],
  ["지표 숫자, 상태 카드 제목", <strong style={{ fontSize: 24, fontWeight: 700, color: "var(--heading)", fontVariantNumeric: "tabular-nums" }}>3,072</strong>, "24px / 700, 숫자 고정폭"],
  ["섹션 제목, 브랜드", <span style={{ fontSize: 18, fontWeight: 700, color: "var(--heading)" }}>경로별 결과</span>, "18px / 700"],
  ["본문, 입력칸", <span style={{ fontSize: 16 }}>가동 중인 앱을 데이터와 함께 다른 클러스터로 옮깁니다.</span>, "16px / 1.5 / 400"],
  ["상자 머리글", <b style={{ fontSize: 16, color: "var(--heading)" }}>이전 경과</b>, "16px / 700"],
  ["메뉴, 버튼, 표", <span style={{ fontSize: 14 }}>이전하기</span>, "14px / 400"],
  ["힌트, 설명", <span className="hint">대상이 쓰기를 받기 전입니다.</span>, "13px / muted"],
  ["코드, 로그", <span className="m" style={{ fontSize: 12 }}>kubectl get secrets -n moimroom</span>, "Mono 12px / 1.6"],
  ["라벨", <span style={{ fontSize: 12, color: "var(--muted)" }}>성공한 쓰기 (k6)</span>, "12px / muted, 자간 0"],
];

const SPACE: [string, number, string][] = [
  ["sp-2xs", 4, "한 요소 안 (칩의 점과 글자, 아이콘과 글자)"],
  ["sp-xs", 8, "칩 사이, 버튼 묶음 간격, 라벨과 입력칸"],
  ["sp-sm", 12, "표 칸 여백, 행 안 요소 간격"],
  ["sp-md", 16, "상자 안쪽 여백, 화면 좌우 여백 (좁은 화면)"],
  ["sp-lg", 20, "메뉴 묶음 사이, 입력칸 사이"],
  ["sp-xl", 24, "화면 안 구역 사이"],
  ["sp-2xl", 32, "화면 좌우 여백"],
  ["sp-3xl", 48, "화면 아래 여백"],
];
const RADIUS: [string, string, string][] = [
  ["r-none", "0", "예약"],
  ["r-chip", "4px", "칩 (버튼과 구분되게 각지고 테두리 없음)"],
  ["r-control", "6px", "버튼, 입력칸, 코드 블록, 메뉴 항목"],
  ["r-card", "8px", "상자, 표 상자, 상태 카드"],
  ["r-badge", "10px", "작은 배지 (예약)"],
  ["r-pill", "50px", "예약"],
];
const MOTION: [string, string, string][] = [
  ["ease", "cubic-bezier(0.4, 0, 0.2, 1)", "상태 상자 등장, 진행 막대, 트래픽 비율"],
  ["dur-fast", "0.2s", "버튼 흐려짐, 화면 전환 페이드"],
  ["dur-base", "0.3s", "상태 색 바뀜, 새 로그 줄 등장"],
  ["dur-slow", "0.4s", "링크 흐려짐, 상태 상자 등장"],
  ["hover-fade", "0.6 / 0.7", "글자 링크 / 채운 버튼에 마우스를 올렸을 때 불투명도"],
];

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="sec ds-sec" id={id}>
      <div>
        <h2>{title}</h2>
        {sub && <p className="hint">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Specimen({ name, note, wide, children }: { name: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={"box" + (wide ? " ds-wide" : "")}>
      <div className="bh">
        <b>{name}</b>
        {note && <span className="hint">{note}</span>}
      </div>
      <div className="bb">{children}</div>
    </div>
  );
}

export function DesignSystem() {
  return (
    <div className="page">
      <PageHead
        title="디자인 시스템"
        sub="HopCharlie 콘솔의 색, 글꼴, 간격, 상태 표현과 컴포넌트입니다. 화면과 같은 토큰과 클래스로 그렸습니다 (src/styles/tokens.css, app.css, motion.css)."
      />

      <Section id="principles" title="원칙">
        <div className="box fillbox">
          <div className="bb">
            <ul className="ds-list">
              <li>흰 바탕, 가는 경계선, 그림자 없음. 상자는 8px, 버튼과 입력칸은 6px, 칩은 4px 모서리를 씁니다. 버튼과 입력칸은 높이 36px(터치 화면 44px)로 맞춥니다.</li>
              <li>색은 상태에만 씁니다. 완료와 통과는 ok, 실패와 차단은 bad, 기계가 일하는 중은 run, 사람이 할 일은 warn, 대기와 예정은 중립 회색입니다. 상태는 항상 글자로도 적습니다.</li>
              <li>요약을 먼저, 자세한 내용은 아래에. 진행 단계, 지표, 트래픽, 상세 목록, 기록 순서로 놓습니다.</li>
              <li>숫자는 고정폭(tabular-nums)으로, 명령과 경로는 Mono로 적습니다.</li>
              <li>문장은 짧은 평서문. 버튼은 하는 일을 그대로 씁니다 ("승인하고 실행", "삭제 승인").</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section id="logo" title="로고" sub="흰 바탕에 씁니다. 파일은 public/brand에 있습니다. 헤더 왼쪽은 가로형(lockup-header.png, 높이 40px)을, 탭·홈 화면·앱 설치 아이콘은 앱 아이콘을 줄여서 씁니다(favicon.ico, favicon-16/32, apple-touch-icon, icon-192). 링크 미리보기(og:image)는 가로형입니다.">
        <div className="ds-logos">
          <Specimen name="가로형" note="lockup-1200w.png">
            <div className="ds-logo">
              <img src="/brand/lockup-1200w.png" alt="HopCharlie, Zero-downtime migration" width={600} height={128} />
            </div>
          </Specimen>
          <Specimen name="심볼" note="mark-1024.png">
            <div className="ds-logo">
              <img src="/brand/mark-1024.png" alt="HopCharlie 심볼" width={120} height={120} />
            </div>
          </Specimen>
          <Specimen name="앱 아이콘" note="app-512.png">
            <div className="ds-logo">
              <img src="/brand/app-512.png" alt="HopCharlie 앱 아이콘" width={120} height={120} />
            </div>
          </Specimen>
        </div>
      </Section>

      <Section id="color" title="색" sub="모든 색은 tokens.css의 변수로 씁니다. 대비는 WCAG 2 기준입니다.">
        <div className="ds-swatches">
          {COLORS.map(([n, v, use, cr, warn]) => (
            <div className="ds-swatch" key={n}>
              <div className="ds-chipcolor" style={{ background: `var(--${n})` }} />
              <div className="ds-swmeta">
                <b className="m">--{n}</b>
                <span className="m hint">{v}</span>
                <small>{use}</small>
                {cr && <small className={warn ? "ds-warn" : "hint"}>{cr}</small>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type" title="글꼴" sub="본문 SUIT 가변 폰트 (400, 500, 700, jsDelivr에서 v2.0.5 고정), 코드와 ID IBM Plex Mono (400, 500, Google Fonts). 크기는 12, 13, 14, 16, 18, 24, 32px 일곱 단계만 씁니다.">
        <div className="box">
          <Table head={["용도", "예시", "규격"]} rows={TYPE.map(([n, s, spec]) => [td(n, "nw"), td(s), td(spec, "nw")])} />
        </div>
      </Section>

      <Section id="space" title="간격과 모서리" sub="간격은 4px 단위 토큰만 씁니다. 1~2px 선 맞춤은 예외입니다.">
        <div className="split">
          <div className="box">
            <Table
              head={["토큰", "값", "", "쓰는 곳"]}
              rows={SPACE.map(([n, v, use]) => [td("--" + n, "m nw"), td(v + "px", "m"), td(<i className="ds-bar" style={{ width: v * 4 }} />), td(use)])}
            />
          </div>
          <div className="box">
            <Table
              head={["토큰", "값", "", "쓰는 곳"]}
              rows={RADIUS.map(([n, v, use]) => [td("--" + n, "m nw"), td(v, "m"), td(<i className="ds-rad" style={{ borderRadius: `var(--${n})` }} />), td(use)])}
            />
          </div>
        </div>
      </Section>

      <Section id="state" title="상태 표현" sub="같은 상태는 어느 화면에서나 같은 모양입니다.">
        <div className="box">
          <Table
            head={["상태", "칩", "단계 표시", "쓰는 곳"]}
            rows={[
              [td("대기"), td(<Chip>대기</Chip>), td(<Ind st="wait" />), td("아직 시작하지 않은 단계, 미실행 경로")],
              [td("진행 중"), td(<Chip kind="run">진행 중</Chip>), td(<Ind st="run" />), td("지금 돌고 있는 단계, 메뉴의 진행 배지")],
              [td("사람을 기다림"), td(<Chip kind="warn">승인 대기</Chip>), td(<Ind st="wait" />), td("Plan 승인 대기, 전환 승인 대기")],
              [td("완료·통과"), td(<Chip kind="ok">통과</Chip>), td(<Ind st="ok" />), td("끝난 단계, 검사 통과, 정상")],
              [td("실패·차단"), td(<Chip kind="bad">차단</Chip>), td(<Ind st="bad" />), td("리허설 실패, 막힌 명령")],
            ]}
          />
        </div>
      </Section>

      <Section id="components" title="컴포넌트">
        <div className="ds-grid">
          <Specimen name="버튼" note=".btn">
            <div className="actrow">
              <button type="button" className="btn primary">승인하고 실행</button>
              <button type="button" className="btn">기본</button>
              <button type="button" className="btn ghost">반려</button>
              <button type="button" className="btn primary" disabled>배포 시작</button>
            </div>
            <p className="hint">화면마다 primary는 하나만 둡니다. 되돌릴 수 없는 일은 primary로 두고 옆에 ghost로 취소를 둡니다.</p>
          </Specimen>

          <Specimen name="지표" note=".metrics / .metric">
            <div className="metrics">
              <div className="metric"><span>성공한 쓰기 (k6)</span><strong>3,072</strong><small>부하 생성기 기준</small></div>
              <div className="metric good"><span>실패 요청</span><strong>0건</strong><small>전환 중 포함</small></div>
              <div className="metric"><span>쓰기 보류</span><strong>5.6초</strong><small>최대 30초</small></div>
            </div>
          </Specimen>

          <Specimen name="안내 상자" note=".box.okbox / .badbox / .fillbox">
            <div className="box okbox"><div className="bb"><b>전환 준비가 끝났습니다.</b><p>복제 지연 0.4초, 파일이 최신입니다.</p></div></div>
            <div className="box badbox"><div className="bb"><b>이 레포는 바로 배포할 수 없습니다.</b><p>Dockerfile이 없습니다.</p></div></div>
            <div className="box fillbox"><div className="bb"><b>Plan을 승인할까요?</b><p>승인 전에는 운영 환경을 바꾸지 않습니다.</p></div></div>
          </Specimen>

          <Specimen name="단계 목록" note=".prog / ProgItem">
            <div className="box">
              <ul className="prog">
                <ProgItem st="ok" title="AI 계획" sub="읽기 전용 도구로 조회, Plan 제출" right="자동" />
                <ProgItem st="run" title="리허설" sub="샌드박스에서 미리 실행" right="진행 중" />
                <ProgItem st="wait" title="승인" sub="보고 있는 revision을 승인" right="대기" />
              </ul>
            </div>
          </Specimen>

          <Specimen name="진행 단계 (마법사)" note=".wiz" wide>
            <ol className="wiz">
              <li className="done"><span className="n">1</span><span>AI 계획</span></li>
              <li className="done"><span className="n">2</span><span>리허설</span></li>
              <li className="cur"><span className="n">3</span><span>승인</span></li>
              <li><span className="n">4</span><span>실행</span></li>
            </ol>
          </Specimen>

          <Specimen name="엔진 9단계" note=".steps9" wide>
            <div className="steps9">
              {(["ok", "ok", "ok", "ok", "run", "wait", "wait", "wait", "wait"] as const).map((st, i) => (
                <div key={i}>
                  <Ind st={st} />
                  <span>
                    {["사전 확인", "대상 준비", "초기 복사", "변경분 동기화", "쓰기 보류", "대상 승격", "트래픽 전환", "검증", "마무리"][i]}
                    <small>{st === "ok" ? "완료" : st === "run" ? "진행 중" : "대기"}</small>
                  </span>
                </div>
              ))}
            </div>
          </Specimen>

          <Specimen name="트래픽 비율" note=".traffic / .seg">
            <div className="traffic" role="img" aria-label="AWS EKS 50%, GCP GKE 50%">
              <div className="seg old" style={{ flexBasis: "50%" }}>AWS EKS 50%</div>
              <div className="seg new" style={{ flexBasis: "50%" }}>GCP GKE 50%</div>
            </div>
            <div className="legend">
              <span><i className="sw" style={{ background: "var(--old)" }} />AWS EKS <b>50%</b></span>
              <span><i className="sw" style={{ background: "var(--fg)" }} />GCP GKE <b>50%</b></span>
            </div>
          </Specimen>

          <Specimen name="타이머" note=".timer / .bar">
            <div className="timer">
              <span className="big">01:48</span>
              <div className="bar"><i style={{ width: "60%" }} /></div>
            </div>
            <p className="hint">목표 03:00 이내. 막대는 목표 시간 대비 비율입니다.</p>
          </Specimen>

          <Specimen name="표" note=".tbl / Table">
            <div className="box">
              <Table
                head={["경로", "결과", "전체", "실패 요청"]}
                rows={[
                  [td("EKS → GKE", "nw"), td(<Chip kind="ok">성공</Chip>), td("2분 34초", "m"), td("0건", "m")],
                  [td("EKS → k3s", "nw"), td(<Chip>미실행</Chip>), td("-", "m"), td("-", "m")],
                ]}
              />
            </div>
          </Specimen>

          <Specimen name="기록" note=".log / LogBox">
            <LogBox
              lines={[
                ["01:41", "사전 확인 통과, 쓰기 요청 보류 시작"],
                ["01:44", "마지막 변경 반영, 시퀀스 맞춤 완료"],
                ["01:46", "게이트웨이 전환, 보류한 쓰기 112건 전달"],
              ]}
            />
          </Specimen>

          <Specimen name="변경 비교" note=".diff">
            <div className="diff">
              <div className="f">deploy/values-gcp.yaml</div>
              <div className="d">-  storageClass: gp3</div>
              <div className="a">+  storageClass: standard-rwo</div>
            </div>
          </Specimen>

          <Specimen name="입력" note=".field">
            <div className="form">
              <div className="field">
                <label htmlFor="ds-target">옮겨 갈 환경</label>
                <select id="ds-target" defaultValue="gcp">
                  <option value="gcp">GCP GKE</option>
                  <option value="onprem">온프레미스 k3s</option>
                </select>
                <small>원본과 같은 클러스터는 고를 수 없습니다.</small>
              </div>
            </div>
          </Specimen>
        </div>
      </Section>

      <Section id="motion" title="움직임" sub="흐려지고 나타나는 정도로만 움직입니다. 레이아웃을 밀지 않습니다. 동작 줄이기 설정에서는 모두 끕니다.">
        <div className="box">
          <Table head={["토큰", "값", "쓰는 곳"]} rows={MOTION.map(([n, v, use]) => [td("--" + n, "m"), td(v, "m"), td(use)])} />
        </div>
      </Section>
    </div>
  );
}
