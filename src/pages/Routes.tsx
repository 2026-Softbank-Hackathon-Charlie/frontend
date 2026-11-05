import { RoutesTable } from "../components/shared";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/ui";
import { dur } from "../sim/format";
import { TARGET_SEC } from "../sim/mig";

export function Routes() {
  return (
    <div className="page">
      <PageHead
        icon="route"
        title="경로별 결과"
        sub={"GKE, EKS, 온프레미스 k3s 사이 6개 방향의 이전 결과입니다. 목표는 전체 " + dur(TARGET_SEC) + " 이내, 실패 요청 0건, 누락 0건입니다."}
        acts={
          <a className="btn primary" href="#migrate-app">
            <Icon name="arrow-right-left" size={16} />
            이전하기
          </a>
        }
      />
      <RoutesTable withCount />
    </div>
  );
}
