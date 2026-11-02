import { AppsTable, EnvGrid, RoutesTable } from "../components/shared";
import { Ind, PageHead } from "../components/ui";
import { running } from "../sim/state";
import { useSim } from "../sim/store";

export function Overview() {
  const { S } = useSim();
  const run = running(S);
  return (
    <div className="page">
      <PageHead title="개요" sub="team-charlie 프로젝트의 클러스터, 앱, 이전 결과입니다." />
      {run.length > 0 && (
        <section className="sec">
          <h2>진행 중인 작업</h2>
          <div className="box">
            <ul className="rows">
              {run.map((r) => (
                <li key={r[0]}>
                  <Ind st="run" />
                  <span className="grow">{r[0]}</span>
                  <a className="more" href={r[1]}>
                    열기
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <section className="sec">
        <h2>클러스터</h2>
        <EnvGrid />
      </section>
      <section className="sec">
        <div className="sech">
          <h2>경로별 결과</h2>
          <a className="more" href="#routes">
            자세히
          </a>
        </div>
        <RoutesTable />
      </section>
      <section className="sec">
        <div className="sech">
          <h2>앱</h2>
          <a className="more" href="#apps">
            전체 보기
          </a>
        </div>
        <AppsTable full={false} />
      </section>
      <section className="sec">
        <h2>최근 활동</h2>
        <div className="box">
          <ul className="rows">
            {S.act.slice(0, 6).map((a, i) => (
              <li key={i}>
                <span className="when">{a[0]}</span>
                <span className="grow">{a[1]}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
