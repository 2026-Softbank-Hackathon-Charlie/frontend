import { AppsTable } from "../components/shared";
import { Chip, PageHead, Table, td, type Cell } from "../components/ui";
import { ENV } from "../sim/data";
import { useSim } from "../sim/store";

export function Apps() {
  return (
    <div className="page">
      <PageHead
        title="앱"
        sub="플랫폼이 관리하는 앱입니다. 새 레포를 배포하거나, 우리 서비스 없이 돌고 있던 앱을 가져올 수 있습니다."
        acts={
          <>
            <a className="btn ghost" href="#onboard">
              기존 앱 가져오기
            </a>
            <a className="btn primary" href="#new">
              새 앱 배포
            </a>
          </>
        }
      />
      <AppsTable full />
    </div>
  );
}

export function AppDetail({ id }: { id: string }) {
  const { S } = useSim();
  const a = S.apps[id];
  const crumb = <a href="#apps">앱</a>;
  if (!a) {
    return (
      <div className="page">
        <PageHead title="앱을 찾을 수 없습니다" crumb={crumb} />
        <div className="box">
          <div className="empty-state">
            <p>{id}은(는) 아직 등록되지 않았습니다.</p>
            <a className="btn" href="#apps">
              앱 목록으로
            </a>
          </div>
        </div>
      </div>
    );
  }

  let rows: Cell[][];
  let acts = null;
  if (a.kind === "platform") {
    rows = (a.envs ?? []).map((k) => [td(ENV[k].name), td(<Chip kind="ok">정상</Chip>), td("2/2", "m"), td(id + "." + k + ".charlie.example", "m")]);
  } else if (a.loc === "legacy" || !a.loc) {
    rows = [[td("기존 AWS (EC2)"), td(<Chip kind="ok">정상</Chip>), td("EC2 1대", "m"), td("shop.charlie.example", "m"), td("100%", "m")]];
    acts = (
      <a className="btn primary" href="#migrate-shop">
        이전
      </a>
    );
  } else {
    rows = [
      [td(ENV[a.loc].name), td(<Chip kind="ok">정상</Chip>), td("2/2", "m"), td("shop.charlie.example", "m"), td("100%", "m")],
      [td("기존 AWS (EC2)"), td(<Chip>{S.mig.phase === "done" ? "중지됨" : "읽기 전용"}</Chip>), td("-", "m"), td("-", "m"), td("0%", "m")],
    ];
    acts = (
      <a className="btn ghost" href="#migrate-shop">
        이전 기록
      </a>
    );
  }
  const locHead = a.kind === "platform" ? ["환경", "상태", "Pod", "주소"] : ["위치", "상태", "실행", "주소", "트래픽"];
  return (
    <div className="page">
      <PageHead title={id} sub={<span className="m">{a.repo}</span>} acts={acts} crumb={crumb} />
      {a.kind === "legacy" && a.loc === "legacy" && (
        <div className="box fillbox">
          <div className="bb">
            <p>
              이 앱은 아직 우리 서비스 밖, 기존 AWS(EC2, RDS, S3)에서 실행 중입니다. 서비스 도메인은 게이트웨이를 거치며, 지금은 모든 요청을 기존 앱으로
              보냅니다.
            </p>
          </div>
        </div>
      )}
      <section className="sec">
        <h2>실행 위치</h2>
        <div className="box">
          <Table head={locHead} rows={rows} />
        </div>
      </section>
      <section className="sec">
        <h2>리소스</h2>
        <div className="box">
          <Table head={["종류", "이름", "내용"]} rows={a.res.map((r) => [td(r[0]), td(r[1], "m"), td(r[2])])} />
        </div>
      </section>
      <section className="sec">
        <h2>변경 이력</h2>
        <div className="box">
          <Table head={["커밋", "내용", "시각", "소요"]} rows={a.deploys.map((r) => [td(r[0], "m"), td(r[1]), td(r[2], "nw"), td(r[3], "nw")])} />
        </div>
      </section>
    </div>
  );
}
