import { Chip, PageHead, Table, td } from "../components/ui";
import { ENV, ENV_ORDER } from "../sim/data";

export function Envs() {
  return (
    <div className="page">
      <PageHead
        title="환경"
        sub="플랫폼에 등록된 배포 환경입니다. 환경마다 다른 부분은 환경 프로필로 흡수하고, 앱은 platform.yaml 하나로 모든 환경에 배포합니다."
        acts={
          <button type="button" className="btn ghost" disabled>
            환경 등록
          </button>
        }
      />
      <div className="box">
        <Table
          head={["환경", "위치", "Kubernetes", "노드", "파일 저장소", "디스크", "진입점", "상태"]}
          rows={ENV_ORDER.map((k) => {
            const e = ENV[k];
            return [
              td(<b>{e.name}</b>),
              td(e.region),
              td(e.k8s, "m"),
              td(e.nodes + "대 (amd64)"),
              td(e.storage),
              td(e.sc, "m"),
              td("Traefik (사설망)"),
              td(<Chip kind="ok">정상</Chip>),
            ];
          })}
        />
      </div>
      <div className="box fillbox">
        <div className="bb">
          <p>새 환경은 Terraform으로 클러스터를 만든 뒤 여기에 등록합니다. 모든 클러스터에는 같은 Traefik, CloudNativePG, Tailscale을 설치하고, 이미지는 같은 Zot 주소에서 받습니다.</p>
        </div>
      </div>
    </div>
  );
}
