import type { SecuritySource, StorageKey, StorageKeyState, StorageKeyUse } from "../api/types";
import { ms } from "./deploy";
import { envName } from "./shared";
import { Chip, Table, td, type ChipKind } from "./ui";
const SRC_STATUS = { ok: ["정상", "ok"], unavailable: ["응답 없음", "bad"], not_configured: ["설정 안 됨", ""], error: ["오류", "bad"] } as const;
const KEY_USE: Record<StorageKeyUse, string> = { current: "사용 중인 키", old: "교체 전 키(파드가 아직 쓸 수 있음)", unrecorded: "플랫폼 기록에 없는 키" };
const KEY_STATE: Record<StorageKeyState, [string, ChipKind]> = { ok: ["확인", "ok"], inactive: ["비활성", "warn"], missing: ["클라우드에 없음", "warn"], unread: ["확인 못 함", ""] };

/** The state chip of a key: a key the platform has no record of is a warning even when active, and a deactivated key in use breaks the app. */
function keyChip(k: StorageKey): [string, ChipKind] {
  if (k.use === "unrecorded" && k.state === "ok") return ["기록에 없음", "warn"];
  if (k.use === "current" && k.state === "inactive") return ["비활성", "bad"];
  return KEY_STATE[k.state] ?? [k.state, ""];
}
const KEY_DRIVER: Record<string, string> = { aws: "IAM 액세스 키", gcs: "GCS HMAC 키", minio: "MinIO 키" };
/** The AWS account check (aws.access-key-age) flags access keys from this age on. */
const OLD_KEY_DAYS = 90;
const DAY = 86_400_000;

/** The bucket keys the platform made for app instances: when the cloud made each and what it may do (platform ADR 0027). */
export function SecurityStorageKeys({ keys, sources }: { keys: StorageKey[] | undefined; sources: SecuritySource[] }) {
  const now = Date.now();
  // An environment whose storage-keys source is not ok may have keys missing from the list.
  const unread = sources.filter((x) => x.status !== "ok");
  return (
    <section className="sec">
      <h2>앱 저장소 키</h2>
      <p className="hint">
        플랫폼이 앱 인스턴스마다 만든 버킷 전용 키입니다. 만든 시각은 클라우드에서 읽고(AWS IAM, GCS HMAC), 허용 범위는 플랫폼이 배포할 때마다 거는 권한입니다. 키 id는 끝
        4자만 보입니다.
      </p>
      {keys != null && unread.length > 0 && (
        <div className="hint" role="status">
          다음 환경의 키는 확인하지 못했습니다. 목록에서 빠졌거나 &lsquo;확인 못 함&rsquo;으로 나옵니다.
          {unread.map((x) => (
            <small key={x.environment} className="block">
              <b>{envName(x.environment)}</b> <Chip kind={SRC_STATUS[x.status]?.[1] ?? ""}>{SRC_STATUS[x.status]?.[0] ?? x.status}</Chip> {x.message}
            </small>
          ))}
        </div>
      )}
      {keys == null ? (
        <p className="hint">연결한 플랫폼이 아직 저장소 키를 보고하지 않습니다.</p>
      ) : keys.length === 0 ? (
        sources.length === 0 ? (
          <p className="hint">저장소 드라이버가 있는 환경이 없습니다.</p>
        ) : (
          unread.length === 0 && <p className="hint">버킷이 있는 앱 인스턴스가 없습니다.</p>
        )
      ) : (
        <div className="box">
          <Table
            head={["앱 인스턴스", "환경", "키", "만든 시각", "허용 범위", "상태"]}
            rows={keys.map((k) => {
              // A state or use a newer platform adds shows as its raw value instead of breaking the page.
              const [stateLabel, stateKind] = keyChip(k);
              const made = k.createdAt ? ms(k.createdAt) : NaN;
              const days = Math.floor((now - made) / DAY);
              return [
                td(
                  <>
                    <b>{k.instance}</b>
                    {k.instance !== k.app && <small className="block">앱 {k.app}</small>}
                  </>,
                ),
                td(
                  <>
                    {envName(k.environment)}
                    <small className="block">{KEY_DRIVER[k.driver] ?? k.driver}</small>
                  </>,
                  "nw",
                ),
                td(
                  <>
                    <span className="m">{k.keyId}</span>
                    <small className="block">{KEY_USE[k.use] ?? k.use}</small>
                  </>,
                ),
                td(
                  Number.isNaN(made) ? (
                    <span className="hint">{k.state === "ok" ? "기록하지 않음" : "-"}</span>
                  ) : (
                    <>
                      {new Date(made).toLocaleString("ko-KR", { hour12: false })}
                      <small className="block">
                        {days < 1 ? "만든 지 하루 안 됨" : "만든 지 " + days + "일"} {k.state === "ok" && days >= OLD_KEY_DAYS && <Chip kind="warn">{OLD_KEY_DAYS}일 넘음</Chip>}
                      </small>
                    </>
                  ),
                ),
                td(
                  <>
                    <span className="m">{k.bucket}</span>
                    {k.scope ? (
                      <>
                        <small className="block">{k.scope.actions.join(", ")}</small>
                        {k.scope.boundary && <small className="block">상한(permissions boundary): {k.scope.boundary.replace(/^.*:policy\//, "")}</small>}
                      </>
                    ) : (
                      <small className="block">권한을 확인하지 못했습니다.</small>
                    )}
                  </>,
                ),
                td(
                  <>
                    <Chip kind={stateKind}>{stateLabel}</Chip>
                    {k.message && <small className="block">{k.message}</small>}
                  </>,
                ),
              ];
            })}
          />
        </div>
      )}
    </section>
  );
}
