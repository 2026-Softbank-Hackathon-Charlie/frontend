import { AppsTable } from "../components/shared";
import { Chip, PageHead, Table, td, type Cell } from "../components/ui";
import { ENV } from "../sim/data";
import { useSim } from "../sim/store";

export function Apps() {
  return (
    <div className="page">
      <PageHead
        title="앱"
        sub="플랫폼이 Argo CD로 관리하는 앱입니다. 플랫폼 밖에서 돌던 앱을 가져올 수 있고, 게이트웨이 뒤에서 한 곳에서만 도는 앱은 다른 클러스터로 이전할 수 있습니다."
        acts={
          <>
            <a className="btn ghost" href="#onboard">
              기존 앱 가져오기
            </a>
            <a className="btn ghost" href="#new">
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
  } else {
    const loc = a.loc ?? "aws";
    rows = [[td(ENV[loc].name), td(<Chip kind="ok">정상</Chip>), td("Pod 10/10", "m"), td("shop.charlie.example", "m"), td("100%", "m")]];
    if (a.prev) rows.push([td(ENV[a.prev].name), td(<Chip>축소됨, 읽기 전용</Chip>), td("-", "m"), td("-", "m"), td("0%", "m")]);
    acts = (
      <a className="btn primary" href="#migrate-shop">
        이전
      </a>
    );
  }
  const locHead = a.kind === "platform" ? ["환경", "상태", "Pod", "주소"] : ["위치", "상태", "실행", "주소", "트래픽"];
  return (
    <div className="page">
      <PageHead title={id} sub={<span className="m">{a.repo}</span>} acts={acts} crumb={crumb} />
      {a.kind === "service" && (
        <div className="box fillbox">
          <div className="bb">
            {/* MOCK: 서현님 샘플 앱이 정해지면 서비스 목록과 주소를 바꾼다 */}
            <p>서비스 도메인은 Cloudflare와 게이트웨이를 거칩니다. 게이트웨이가 모든 요청을 {ENV[a.loc ?? "aws"].name}로 보내고 있습니다.</p>
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
