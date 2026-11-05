import { Chip, LogBox, PageHead, Table, td, type Cell } from "../components/ui";
import { Icon } from "../components/Icon";
import { ENV, ENV_ORDER, FINDINGS, SAMPLE, type EnvKey } from "../sim/data";
import { chooseMode, useLive } from "../data/live";
import { navigate } from "../router";
import { useSim } from "../sim/store";

const LABELS = ["연결 정보", "AI 점검", "샌드박스 테스트", "PR 승인"];

export function Onboard() {
  const { S } = useSim();
  const o = S.onb;
  const live = useLive();
  if (live) return (
    <div className="page">
      <PageHead icon="download" title="기존 앱 가져오기" sub="플랫폼 밖에서 실행 중인 앱을 클러스터로 가져오는 흐름입니다." />
      <ol className="wiz" aria-label="가져오기 단계">
        {LABELS.map((label, i) => <li key={label}><span className="n">{i + 1}</span><span>{label}</span></li>)}
      </ol>
      <section className="box">
        <h2>실제 가져오기 연동 준비 중</h2>
        <p>클라우드 자산 점검·기존 데이터 가져오기는 아직 실제 API에 연결되지 않았습니다. 자격증명을 입력받거나 시연 결과를 실제 실행처럼 표시하지 않습니다.</p>
        <div className="acts">
          <a className="btn ghost" href="#apps">앱 목록으로</a>
          <button type="button" className="btn" onClick={() => chooseMode("demo")}>데모에서 가져오기 흐름 보기</button>
        </div>
      </section>
    </div>
  );
  return (
    <div className="page">
      <PageHead
        icon="download"
        title="기존 앱 가져오기"
        sub="플랫폼 밖(EC2, RDS, S3)에서 돌고 있는 앱을 AI가 점검하고 고쳐서, 클러스터에 배포할 수 있는 형태로 바꿉니다. AI 범위 결정(3장 7번) 전 시안입니다."
      />
      <p className="hint">데모의 가상 앱·자격정보로 가져오기 흐름을 보여줍니다. 실제 자격증명을 입력하지 마세요.</p>
      <ol className="wiz" aria-label="가져오기 단계">
        {LABELS.map((l, i) => {
          const n = i + 1;
          const cls = n < o.step || (n === 4 && o.done[4]) ? "done" : n === o.step ? "cur" : "";
          return (
            <li key={l} className={cls} aria-current={n === o.step ? "step" : undefined}>
              <span className="n">{n}</span>
              <span>{l}</span>
            </li>
          );
        })}
      </ol>
      {o.step === 1 ? <Step1 /> : o.step === 2 ? <Step2 /> : o.step === 3 ? <Step3 /> : <Step4 />}
    </div>
  );
}

function Step1() {
  const { S, dispatch } = useSim();
  const o = S.onb;
  return (
    <>
      <div className="box">
        <div className="bb">
          <div className="form">
            <div className="field">
              <label htmlFor="onb-repo">GitHub 레포</label>
              <select id="onb-repo">
                <option>team-charlie/sample-shop</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="onb-cloud">지금 실행 중인 곳</label>
              <select id="onb-cloud">
                <option>AWS, ap-northeast-2 (서울)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="onb-ro">클라우드 읽기 전용 자격 증명</label>
              <input id="onb-ro" defaultValue="arn:aws:iam::<계정 ID>:role/charlie-readonly" />
              <small>AI 에이전트가 EC2, RDS, S3 설정을 읽는 데 씁니다.</small>
            </div>
            <div className="field">
              <label htmlFor="onb-dbu">DB 관리자 계정</label>
              <div className="two">
                <input id="onb-dbu" defaultValue="postgres" aria-label="DB 관리자 이름" />
                <input id="onb-dbp" type="password" defaultValue="example-password" aria-label="DB 관리자 비밀번호" autoComplete="off" />
              </div>
              <small>기존 RDS에서 데이터를 처음 복사할 때 씁니다.</small>
            </div>
            <div className="field">
              <label htmlFor="onb-stop">원본 앱 중지 권한</label>
              <input id="onb-stop" defaultValue="arn:aws:iam::<계정 ID>:role/charlie-stop-only" />
              <small>첫 배포가 끝난 뒤 기존 EC2를 멈출 때만 씁니다.</small>
            </div>
            <div className="field">
              <label htmlFor="onb-env">처음 배포할 클러스터</label>
              <select id="onb-env" value={o.env} onChange={(e) => dispatch({ type: "onb-env", env: e.target.value as EnvKey })}>
                {ENV_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {ENV[k].name}
                  </option>
                ))}
              </select>
              <small>샌드박스 테스트도 이 클러스터에서 합니다. 다른 클러스터로는 가져온 뒤 이전 화면에서 옮깁니다.</small>
            </div>
          </div>
        </div>
      </div>
      <div className="box fillbox">
        <div className="bb">
          <p>DB 관리자 계정과 중지 권한은 플랫폼만 씁니다. AI 에이전트에는 읽기 전용 자격 증명과 샌드박스 네임스페이스 권한만 줍니다.</p>
        </div>
      </div>
      <div className="actrow">
        <button type="button" className="btn primary" onClick={() => dispatch({ type: "onb-start" })}>
          <Icon name="bot" size={16} />
          점검 시작
        </button>
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
}

function Step2() {
  const { S, dispatch } = useSim();
  const o = S.onb;
  const vis = FINDINGS.filter((f) => o.done[2] || o.t >= f[0]);
  return (
    <>
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>점검 리포트</b>
            <Chip kind="run">{o.done[2] ? "고칠 항목 4개" : "점검 중"}</Chip>
          </div>
          {vis.length ? (
            <Table head={["항목", "발견한 내용", "조치"]} rows={vis.map((f) => [td(f[1], "nw"), td(f[2]), td(<Chip kind={f[3]}>{f[4]}</Chip>)])} />
          ) : (
            <div className="bb">
              <p className="hint">AI가 코드와 클라우드 설정을 읽고 있습니다.</p>
            </div>
          )}
        </div>
        <div className="box">
          <div className="bh">
            <b>AI 에이전트 작업</b>
            {o.done[2] ? <Chip kind="ok">완료</Chip> : <Chip kind="run">진행 중</Chip>}
          </div>
          <div className="bb">
            <LogBox lines={o.log} />
            <dl className="kv sm">
              <dt>클라우드</dt>
              <dd>읽기 전용</dd>
              <dt>DB 관리자 계정</dt>
              <dd>받지 않음</dd>
            </dl>
          </div>
        </div>
      </div>
      <div className="actrow">
        <button type="button" className="btn primary" disabled={!o.done[2]} onClick={() => dispatch({ type: "onb-sbx" })}>
          <Icon name="play" size={16} />
          샌드박스 테스트 시작
        </button>
        {!o.done[2] && <span className="hint">AI 점검이 끝나면 시작할 수 있습니다.</span>}
      </div>
    </>
  );
}

function Step3() {
  const { S, dispatch } = useSim();
  const o = S.onb;
  const t = o.done[3] ? 999 : o.t;
  const att: Cell[][] = [];
  if (t >= 30)
    att.push([
      td("1차"),
      td(t >= 52 ? <Chip kind="bad">실패</Chip> : <Chip kind="run">진행 중</Chip>),
      td(t >= 52 ? "헬스 체크 경로 /healthz가 없어 준비 상태 확인 실패" : "shop:c07e4b8 배포, 스모크 테스트 실행 중"),
    ]);
  if (t >= 72)
    att.push([
      td("2차"),
      td(t >= 96 ? <Chip kind="ok">통과</Chip> : <Chip kind="run">진행 중</Chip>),
      td(t >= 96 ? "헬스 체크를 추가한 뒤 스모크 테스트 12개 모두 통과" : "shop:9d2b71f 배포, 스모크 테스트 실행 중"),
    ]);
  const blk: Cell[][] = [];
  if (t >= 55) blk.push([td("kubectl get secrets -n shop", "m"), td("다른 네임스페이스 접근 권한 없음 (RBAC)"), td(<Chip kind="bad">차단</Chip>)]);
  if (t >= 68)
    blk.push([
      td("psql -h shop-db.cxxxxxxx.ap-northeast-2.rds.amazonaws.com", "m"),
      td("사설망으로 나가는 통신 차단 (NetworkPolicy)"),
      td(<Chip kind="bad">차단</Chip>),
    ]);
  return (
    <>
      <div className="split">
        <div className="sec">
          <div className="box">
            <div className="bh">
              <b>샌드박스</b>
              {o.done[3] ? <Chip>삭제됨</Chip> : <Chip kind="run">실행 중</Chip>}
            </div>
            <div className="bb">
              <dl className="kv">
                <dt>네임스페이스</dt>
                <dd className="m">sandbox-shop-7f3a</dd>
                <dt>위치</dt>
                <dd>{ENV[o.env].name}</dd>
                <dt>자원 한도</dt>
                <dd>CPU 2, 메모리 4 GiB, Pod 10개</dd>
                <dt>네트워크</dt>
                <dd>같은 네임스페이스와 DNS만 허용 (운영망, 기존 RDS 차단)</dd>
                <dt>데이터</dt>
                <dd>임시 PostgreSQL, 임시 MinIO (결제 정보 마스킹)</dd>
                <dt>자동 삭제</dt>
                <dd>최대 30분 뒤</dd>
              </dl>
            </div>
          </div>
          <div className="box">
            <div className="bh">
              <b>테스트</b>
            </div>
            {att.length ? (
              <Table head={["회차", "결과", "내용"]} rows={att} />
            ) : (
              <div className="bb">
                <p className="hint">브랜치를 빌드하고 있습니다.</p>
              </div>
            )}
          </div>
          <div className="box">
            <div className="bh">
              <b>막힌 명령</b>
              <Chip>{blk.length}건</Chip>
            </div>
            {blk.length ? (
              <Table head={["AI 권한으로 시도한 명령", "막은 장치", ""]} rows={blk} />
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
              <b>코드 변경</b>
              <span className="hint">onboard/platform 브랜치</span>
            </div>
            <div className="bb">
              {t >= 12 ? (
                <div className="diff">
                  <div className="f">src/main/resources/application.yml</div>
                  <div className="d">-    url: jdbc:postgresql://shop-db.cxxxxxxx.ap-northeast-2.rds.amazonaws.com:5432/shop</div>
                  <div className="a">+    url: {"${DATABASE_URL}"}</div>
                  {t >= 18 && (
                    <>
                      <div className="f">src/main/java/shop/ProductImageService.java</div>
                      <div className="d">-    return "https://shop-files.s3.ap-northeast-2.amazonaws.com/" + key;</div>
                      <div className="a">+    return key;</div>
                    </>
                  )}
                </div>
              ) : (
                <p className="hint">AI가 고칠 파일을 정리하고 있습니다.</p>
              )}
            </div>
          </div>
          <div className="box">
            <div className="bh">
              <b>AI 에이전트 작업</b>
              {o.done[3] ? <Chip kind="ok">완료</Chip> : <Chip kind="run">진행 중</Chip>}
            </div>
            <div className="bb">
              <LogBox lines={o.log} />
            </div>
          </div>
        </div>
      </div>
      <div className="actrow">
        <button type="button" className="btn primary" disabled={!o.done[3]} onClick={() => dispatch({ type: "onb-pr" })}>
          <Icon name="git-pull-request" size={16} />
          PR 확인
        </button>
        {!o.done[3] && <span className="hint">샌드박스 테스트가 끝나면 PR을 확인할 수 있습니다.</span>}
      </div>
    </>
  );
}

function Step4() {
  const { S, dispatch } = useSim();
  const o = S.onb;
  const merged = o.done[4] || (o.run && o.t >= 1);
  return (
    <>
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>PR #14 shop을 플랫폼 배포 형태로 변경</b>
            {o.done[4] ? <Chip kind="ok">머지됨</Chip> : <Chip kind={o.approved ? "run" : "warn"}>{o.approved ? "머지 중" : "승인 대기"}</Chip>}
          </div>
          <div className="bb">
            <dl className="kv">
              <dt>브랜치</dt>
              <dd>
                <span className="m">onboard/platform</span>에서 <span className="m">main</span>으로
              </dd>
              <dt>변경</dt>
              <dd>파일 6개, 142줄 추가, 18줄 삭제</dd>
              <dt>추가한 파일</dt>
              <dd className="m">Dockerfile, platform.yaml</dd>
              <dt>확인</dt>
              <dd>
                <div className="chips">
                  <Chip kind="ok">샌드박스 테스트 통과</Chip>
                  {o.approved ? <Chip kind="ok">운영자 승인 1건</Chip> : <Chip>승인 0/1</Chip>}
                  {merged ? <Chip kind="ok">머지 완료</Chip> : <Chip>머지 전</Chip>}
                </div>
              </dd>
            </dl>
            <pre className="code">
              {"점검 리포트: 고칠 항목 4개를 모두 수정했습니다.\n샌드박스 테스트: 2차에서 스모크 테스트 12/12 통과.\nAI가 실행한 명령 31개 (차단 2건) 요약을 첨부합니다."}
            </pre>
            {!o.approved && (
              <>
                <div className="actrow">
                  <button type="button" className="btn primary" onClick={() => dispatch({ type: "onb-approve" })}>
                    <Icon name="check" size={16} />
                    GitHub에서 승인됨으로 표시 (시연용)
                  </button>
                </div>
                <p className="hint">실제로는 운영자가 GitHub에서 승인하면 플랫폼이 알림을 받습니다. main은 승인 1건이 있어야 머지됩니다.</p>
              </>
            )}
          </div>
        </div>
        <div className="box">
          <div className="bh">
            <b>머지, 빌드, 첫 배포</b>
            {o.done[4] ? <Chip kind="ok">완료</Chip> : o.approved ? <Chip kind="run">진행 중</Chip> : <Chip>대기</Chip>}
          </div>
          <div className="bb">
            <LogBox lines={o.approved ? o.log : []} empty="승인을 기다리고 있습니다." />
          </div>
        </div>
      </div>
      {o.done[4] && (
        <div className="box okbox" role="status">
          <div className="bb">
            <b>shop을 가져왔습니다.</b>
            <p>
              ECR 이미지 shop:9d2b71f로 {ENV[o.env].name}에 배포했고, 게이트웨이가 모든 요청을 보냅니다. 기존 EC2·RDS·S3는 읽기 전용으로 남겨 두었습니다. 이 가져오기 시안은 shop을
              예로 들고, 이전은 팀 샘플 앱 {SAMPLE.id}으로 이어집니다.
            </p>
            <div className="actrow">
              <a className="btn primary" href="#migrate-app">
                <Icon name="arrow-right-left" size={16} />
                이전하러 가기
              </a>
              <a className="btn ghost" href={"#app-" + SAMPLE.id}>
                {SAMPLE.id} 보기
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
