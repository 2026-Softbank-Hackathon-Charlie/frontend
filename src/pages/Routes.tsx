import { RoutesTable } from "../components/shared";
import { PageHead } from "../components/ui";
import { ROUTES, TARGET_SEC, routeKey } from "../sim/data";
import { dur } from "../sim/format";
import { useSim } from "../sim/store";

export function Routes() {
  const { S } = useSim();
  const done = ROUTES.filter(([s, t]) => S.results[routeKey(s, t)]).length;
  return (
    <div className="page">
      <PageHead
        title="경로별 결과"
        sub={"GKE, EKS, 온프레미스 k3s 사이 6개 방향의 이전 결과입니다. 목표는 전체 " + dur(TARGET_SEC) + " 이내, 실패 요청 0건, 누락 0건입니다."}
        acts={
          <a className="btn primary" href="#migrate-shop">
            이전하기
          </a>
        }
      />
      <p className="hint">
        6개 중 {done}개 경로를 실행했습니다. 실패 요청과 누락은 k6가 성공 응답을 받은 쓰기 기록을 새 DB와 대조하고, 파일은 크기와 해시를 비교해서 셉니다.
      </p>
      <RoutesTable />
    </div>
  );
}
