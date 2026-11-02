import { Chip, PageHead, Table, td } from "../components/ui";
import { ENV, ENV_ORDER } from "../sim/data";

export function Envs() {
  return (
    <div className="page">
      <PageHead
        title="환경"
        sub="환경마다 독립된 Kubernetes 클러스터를 둡니다. 환경 차이는 Helm values(환경 프로필)로만 흡수하고, 같은 chart로 모든 클러스터에 배포합니다."
        acts={
          <button type="button" className="btn ghost" disabled>
            환경 등록
          </button>
        }
      />
      <section className="sec">
        <h2>대상 클러스터</h2>
        <div className="box">
          <Table
            head={["환경", "위치", "Kubernetes", "노드", "파일 저장소", "StorageClass", "프로필", "상태"]}
            rows={ENV_ORDER.map((k) => {
              const e = ENV[k];
              return [
                td(<b>{e.name}</b>),
                td(e.region),
                td(e.k8s, "m"),
                td(e.nodes + "대"),
                td(e.storage),
                td(e.sc, "m"),
                td("values-" + k + ".yaml", "m"),
                td(<Chip kind="ok">정상</Chip>),
              ];
            })}
          />
        </div>
      </section>
      <section className="sec">
        <h2>관리 영역과 연결</h2>
        <div className="box">
          <Table
            head={["구성 요소", "위치", "역할"]}
            rows={[
              [td(<b>관리 호스트</b>), td("AWS"), td("플랫폼 API, 워크플로, Argo CD. 대상 클러스터와 분리")],
              [td(<b>Tailscale</b>), td("3개 클러스터 + 관리 호스트"), td("공인 IP 없이 사설망 연결, DB 복제와 rclone 경로")],
              [td(<b>Cloudflare</b>), td("외부"), td("도메인, HTTPS, Tunnel. DNS로 트래픽을 전환하지 않음")],
              [td(<b>트래픽 게이트웨이</b>), td("클러스터 밖 중립 위치"), td("환경별 비율, 전환 때 쓰기 보류, 연결 drain")],
              [td(<b>Amazon ECR</b>), td("AWS"), td("모든 클러스터가 같은 이미지를 받음")],
            ]}
          />
        </div>
      </section>
      <div className="box fillbox">
        <div className="bb">
          <p>새 클러스터는 Terraform으로 만든 뒤 여기에 등록합니다. 모든 클러스터에는 같은 CloudNativePG와 Tailscale을 설치합니다.</p>
        </div>
      </div>
    </div>
  );
}
