import { useWrittenRecords } from "../api/hooks";
import { errorText } from "../data/live";
import { fmt } from "../sim/format";
import { Chip } from "./ui";
import "../styles/write-verification.css";

/** The platform's registered-app stream convention; invalid names are not queried. */
export function appWriteStream(app: string): string | null {
  const stream = "app-" + app;
  return app && /^[a-z0-9][a-z0-9-]{0,62}$/.test(stream) ? stream : null;
}

export function LiveWriteCollection({ app }: { app: string }) {
  const stream = appWriteStream(app);
  const records = useWrittenRecords(stream);
  const data = records.data;
  const latest = data?.latestAt && Number.isFinite(Date.parse(data.latestAt)) ? data.latestAt : undefined;
  return <section className="box" aria-label="앱 쓰기 기록 수집">
    <div className="bh"><b>앱 쓰기 기록 수집</b>{data && <Chip kind={data.count > 0 ? "" : "warn"}>{data.count > 0 ? "수집 기록 있음" : "수집 기록 없음"}</Chip>}</div>
    <div className="bb write-verification">
      {!stream ? <p className="hint">기본 쓰기 기록 스트림을 조회할 수 없는 앱 이름입니다. 명시적으로 지정한 기록 스트림은 해당 이전 리포트에서 확인해 주세요.</p>
        : !data ? records.error ? <><p className="hint">쓰기 기록을 조회하지 못했습니다. {errorText(records.error)}</p><button type="button" className="btn sm ghost" onClick={records.reload}>쓰기 기록 다시 조회</button></>
          : <p className="hint" role="status">쓰기 기록을 조회하고 있습니다.</p>
          : <>
            {records.error && <p className="hint" role="status">갱신하지 못했습니다. 마지막으로 받은 수집 정보입니다.</p>}
            <dl className="write-verification-metrics">
              <div><dt>현재 스트림 기록</dt><dd>{fmt(data.count)}건</dd></div>
              <div><dt>마지막 쓰기 기록 시각</dt><dd>{latest ? <time dateTime={latest}>{new Date(latest).toLocaleString("ko-KR", { hour12: false })}</time> : data.count === 0 ? "기록 없음" : "시각 미제공"}</dd></div>
            </dl>
            <p className="hint">현재 스트림 전체 기록입니다. 이전별로 고정된 검증 입력과 검사 결과는 실행 리포트에서 확인합니다.</p>
            <p className="hint">표시 시각은 쓰기 기록에 담긴 시각 중 가장 최근 값입니다. 플랫폼 도착 시각은 제공되지 않습니다.</p>
            {data.count === 0 && <p className="hint">수집된 기록이 없어 아직 쓰기 누락을 검사할 수 없습니다. 앱의 기록 수집 연결을 확인해 주세요.</p>}
            {data.scope === "application_commits" && <p className="hint">앱 DB 커밋 기록이며 클라이언트의 성공 응답 수신을 증명하지 않습니다.</p>}
            {data.coverage === "reservation_inserts" && <p className="hint">예약 생성 기록만 수집합니다. 수정·삭제와 다른 종류의 쓰기는 포함하지 않습니다.</p>}
          </>}
      {stream && <p className="hint">기록 스트림 <code>{stream}</code></p>}
      <p className="hint">기록이 있다는 사실만으로 현재 수집기가 정상 동작 중이라고 판단하지 않습니다.</p>
    </div>
  </section>;
}
