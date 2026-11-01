import { Chip, LogBox, PageHead, ProgItem, Table, td } from "../components/ui";
import { DEP_READY, DEP_STAGES, ENV, ENV_ORDER, REPOS, type EnvKey } from "../sim/data";
import { dur, mmss, ST, stOf } from "../sim/format";
import { depEnd, depEnvs } from "../sim/state";
import { useSim } from "../sim/store";

const crumb = <a href="#apps">앱</a>;

export function NewApp() {
  const { S, dispatch } = useSim();
  const d = S.dep;

  if (d.phase === "form") {
    const repo = REPOS[d.repo];
    const can = repo.ok && !S.apps[d.repo] && depEnvs(S).length > 0;
    return (
      <div className="page">
        <PageHead title="새 앱 배포" sub="GitHub 레포를 연결하면 push할 때마다 빌드하고, 고른 환경에 동시에 배포합니다." crumb={crumb} />
        <div className="box">
          <div className="bb">
            <div className="form">
              <div className="field">
                <label htmlFor="dep-repo">GitHub 레포</label>
                <select id="dep-repo" value={d.repo} onChange={(e) => dispatch({ type: "dep-repo", repo: e.target.value })}>
                  {Object.keys(REPOS).map((k) => {
                    const reg = !!S.apps[k];
                    return (
                      <option key={k} value={k} disabled={reg}>
                        {REPOS[k].label + (reg ? " (등록됨)" : "")}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="dep-branch">배포할 브랜치</label>
                <select id="dep-branch">
                  <option>main</option>
                </select>
                <small>main이 아닌 브랜치는 빌드까지만 하고 샌드박스에서 씁니다.</small>
              </div>
              <fieldset className="field">
                <legend>배포 환경</legend>
                <div className="checks">
                  {ENV_ORDER.map((k) => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        id={"dep-env-" + k}
                        checked={d.envs[k]}
                        onChange={(e) => dispatch({ type: "dep-env", env: k, on: e.target.checked })}
                      />{" "}
                      {ENV[k].name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        </div>
        {repo.ok ? (
          <div className="box">
            <div className="bh">
              <b>레포 확인 결과</b>
              <Chip kind="ok">배포 가능</Chip>
            </div>
            <div className="bb">
              <ul className="prog">
                <ProgItem st="ok" title="Dockerfile" sub={repo.lang} />
                <ProgItem st="ok" title="platform.yaml" sub="서비스 1개, PostgreSQL 1개" />
              </ul>
              <pre className="code">{repo.yaml}</pre>
              <p className="hint">postgres는 환경마다 CloudNativePG로 만들고, 접속 정보를 DATABASE_URL로 넣어 줍니다.</p>
            </div>
          </div>
        ) : (
          <div className="box badbox">
            <div className="bb">
              <b>이 레포는 바로 배포할 수 없습니다.</b>
              <p>Dockerfile과 platform.yaml이 없습니다. 기존 앱 가져오기를 쓰면 AI가 두 파일을 만들어 PR로 올립니다.</p>
              <div className="actrow">
                <a className="btn" href="#onboard">
                  기존 앱 가져오기
                </a>
              </div>
            </div>
          </div>
        )}
        <div className="actrow">
          <button type="button" className="btn primary" disabled={!can} onClick={() => dispatch({ type: "dep-start" })}>
            배포 시작
          </button>
          <span className="hint">예상 2~4분, 목표 5분 이내</span>
        </div>
      </div>
    );
  }

  const end = depEnd(S);
  const k = d.repo;
  const done = d.phase === "done";
  const envRow = (e: EnvKey) => {
    const st = d.t >= DEP_READY[e] ? "ok" : d.t >= 55 ? "run" : "wait";
    return [
      td(ENV[e].name),
      td(st === "ok" ? <Chip kind="ok">정상</Chip> : st === "run" ? <Chip kind="run">배포 중</Chip> : <Chip>대기</Chip>),
      td(st === "ok" ? "2/2" : st === "run" ? "0/2" : "-", "m"),
      td(st === "ok" ? mmss(DEP_READY[e]) : "-", "m"),
    ];
  };
  return (
    <div className="page">
      <PageHead title={k + " 배포"} sub={done ? "배포가 끝났습니다." : "빌드하고 고른 환경에 동시에 배포하는 중입니다."} crumb={crumb} />
      {done && (
        <div className="box okbox" role="status">
          <div className="bb">
            <b>배포 완료: {dur(end)}</b>
            <p>
              {depEnvs(S)
                .map((e) => ENV[e].name)
                .join(", ")}
              에서 {k}가 실행 중입니다.
            </p>
            <div className="actrow">
              <a className="btn primary" href={"#app-" + k}>
                앱 보기
              </a>
              <button type="button" className="btn ghost" onClick={() => dispatch({ type: "dep-again" })}>
                다른 레포 배포
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="split">
        <div className="box">
          <div className="bh">
            <b>진행 상황</b>
            {done ? <Chip kind="ok">완료</Chip> : <Chip kind="run">진행 중</Chip>}
          </div>
          <ul className="prog">
            {DEP_STAGES.map((s) => {
              const e = s[3] === null ? end : s[3];
              const st = stOf(d.t, s[2], e);
              return <ProgItem key={s[0]} st={st} title={s[0]} sub={s[1]} right={st === "ok" ? mmss(e) : ST[st]} />;
            })}
          </ul>
        </div>
        <div className="box">
          <div className="bh">
            <b>경과 시간</b>
            <span className="hint">목표 05:00</span>
          </div>
          <div className="bb">
            <div className="timer">
              <span className="big">{mmss(d.t)}</span>
              <div className="bar">
                <i style={{ width: Math.min(100, (d.t / 300) * 100) + "%" }} />
              </div>
            </div>
            <Table head={["환경", "상태", "Pod", "준비 완료"]} rows={depEnvs(S).map(envRow)} />
          </div>
        </div>
      </div>
      <section className="sec">
        <h2>빌드와 배포 로그</h2>
        <LogBox lines={d.log} />
      </section>
    </div>
  );
}
