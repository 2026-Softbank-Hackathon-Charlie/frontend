import { navigate } from "../router";
import { ENV, ENV_ORDER } from "../sim/data";
import { appsIn, migActive, migLabel, type App } from "../sim/state";
import { useSim } from "../sim/store";
import { Chip, Table, td } from "./ui";

export function EnvGrid() {
  const { S } = useSim();
  return (
    <div className="grid4">
      {ENV_ORDER.map((k) => {
        const e = ENV[k];
        return (
          <div className="cell" key={k}>
            <div className="cellh">
              <b>{e.name}</b>
              <Chip kind="ok">정상</Chip>
            </div>
            <dl className="kv sm">
              <dt>위치</dt>
              <dd>{e.region}</dd>
              <dt>노드</dt>
              <dd>
                {e.nodes}대, Kubernetes {e.k8s}
              </dd>
              <dt>파일 저장소</dt>
              <dd>{e.storage}</dd>
              <dt>앱</dt>
              <dd>{appsIn(S, k)}개</dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

export function LocChips({ a }: { a: App }) {
  const { S } = useSim();
  if (a.kind === "platform") {
    return (
      <div className="chips">
        {(a.envs ?? []).map((k) => (
          <Chip key={k}>{ENV[k].name}</Chip>
        ))}
      </div>
    );
  }
  return (
    <div className="chips">
      <Chip>{a.loc === "legacy" || !a.loc ? "기존 AWS (EC2)" : ENV[a.loc].name}</Chip>
      {migActive(S) && <Chip kind="run">{migLabel(S)}</Chip>}
    </div>
  );
}

export function AppsTable({ full }: { full: boolean }) {
  const { S } = useSim();
  const rows = S.appOrder.map((id) => {
    const a = S.apps[id];
    const r = [td(<a href={"#app-" + id}>{id}</a>)];
    if (full) r.push(td(a.repo, "m"));
    r.push(td(<LocChips a={a} />), td(a.deploys[0][2] + " (" + a.deploys[0][0] + ")", "nw"), td(<Chip kind="ok">정상</Chip>));
    if (full)
      r.push(
        td(
          a.kind === "legacy" ? (
            <a className="btn ghost" href="#migrate-shop">
              이전
            </a>
          ) : (
            ""
          ),
        ),
      );
    return r;
  });
  const head = full ? ["이름", "레포", "실행 위치", "최근 변경", "상태", ""] : ["이름", "실행 위치", "최근 변경", "상태"];
  return (
    <div className="box">
      <Table head={head} rows={rows} />
    </div>
  );
}

export function EmptyShop() {
  const { dispatch } = useSim();
  return (
    <div className="box">
      <div className="empty-state">
        <b>이전할 수 있는 앱이 아직 없습니다.</b>
        <p className="hint">우리 서비스 없이 AWS에서 돌고 있는 shop을 먼저 가져오면, 여기서 다른 환경으로 옮길 수 있습니다.</p>
        <div className="actrow">
          <a className="btn primary" href="#onboard">
            기존 앱 가져오기
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              dispatch({ type: "onb-skip" });
              navigate("#migrate-shop");
            }}
          >
            가져오기 완료 상태로 건너뛰기
          </button>
        </div>
      </div>
    </div>
  );
}
