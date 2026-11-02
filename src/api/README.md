# src/api: 플랫폼 API 데이터 계층

콘솔이 실제 플랫폼 API(`platform/api/openapi.yaml`)와 통신하는 계층입니다. 화면 코드는 건드리지 않고, 페이지가 `src/sim` 대신 가져다 쓸 수 있게 준비해 둔 것입니다.

| 파일 | 내용 |
|------|------|
| `schema.d.ts` | openapi.yaml에서 생성한 타입. 손으로 고치지 않는다 |
| `types.ts` | `Run`, `RunEvent`, `Environment`, `TrafficState`, `PlanRecord`, `Matrix`, `AuditEntry` 같은 짧은 이름 |
| `client.ts` | API 함수, `ApiError`, 토큰 |
| `sse.ts` | fetch 기반 SSE 파서와 `watchRun` |
| `hooks.ts` | React 훅 (`useEnvironments`, `useTraffic`, `useRuns`, `useMatrix`, `useAudit`, `useRun`) |
| `fakes.ts` | 테스트 전용 가짜 fetch. 앱 코드에서 import하지 않는다 |
| `gen-schema.mjs` | `npm run gen:api` 스크립트 |

## 서버에 연결하기

프로젝트 루트에 `.env.local`을 만들고 서버 주소를 적는다. `*.local`은 gitignore에 들어 있어서 커밋되지 않는다.

```bash
VITE_PLATFORM_URL=https://api.3-36-23-54.sslip.io
```

1. `.env.local`을 저장한 뒤 `npm run dev`를 다시 시작한다. Vite는 시작할 때만 env를 읽는다.
2. 배포된 서버는 `http://localhost:5173`에서 오는 CORS 요청만 허용하므로 개발 서버 포트를 바꾸지 않는다.
3. 값을 비워 두면 같은 origin(`/v1/...`)으로 요청한다.

## 토큰 설정

`/healthz`와 `/openapi.yaml`을 빼면 모든 요청에 `Authorization: Bearer <token>`이 필요하다. 토큰마다 역할(viewer, agent, operator)이 있고, 승인이나 시작, 전환, 중단은 operator만 할 수 있다.

```ts
import { hasToken, setToken } from "../api/client";

setToken(token);                    // 메모리에만 둔다. 새로고침하면 사라진다
setToken(token, { persist: true }); // sessionStorage에도 둔다. 이 탭을 새로고침해도 유지된다
setToken(null);                     // 지운다
hasToken();
```

- 기본은 메모리 보관이다. `persist`를 켜면 같은 origin에서 도는 모든 스크립트(XSS 버그, 브라우저 확장)가 sessionStorage에서 토큰을 읽을 수 있다. 짧게 쓰는 토큰에만 켜고, 공용 PC에서는 operator 토큰에 켜지 않는다.
- 토큰은 로그에 찍지 않고 오류 메시지에도 넣지 않는다. 화면에서도 토큰 값을 다시 보여 주지 않는다.

## 타입 다시 만들기

```bash
npm run gen:api                                                    # ../platform/api/openapi.yaml
PLATFORM_OPENAPI=https://api.3-36-23-54.sslip.io/openapi.yaml npm run gen:api   # 배포된 서버 기준
```

1. 계약이 바뀌면 `npm run gen:api`로 `src/api/schema.d.ts`를 다시 만들고 함께 커밋한다.
2. 새 스키마를 쓰려면 `types.ts`에 별칭을 추가하고, 새 엔드포인트는 `client.ts`에 함수로 추가한다.
3. `PLATFORM_OPENAPI`에는 파일 경로나 http(s) URL을 넣는다.

openapi-typescript는 6.7.6을 쓴다. 7.x는 TypeScript 5의 컴파일러 API가 필요한데, 이 프로젝트의 TypeScript 7은 그 API를 제공하지 않아 설치부터 충돌한다. 6.x는 원격 URL을 읽을 때만 undici를 쓰고, `package.json`의 `overrides`로 보안 패치된 undici 7.30.1을 쓰게 했다.

## 클라이언트

함수 이름은 openapi.yaml의 operationId와 같고, 응답 본문을 계약 그대로 돌려준다.

| 영역 | 함수 |
|------|------|
| 시스템 | `getHealth`, `getMe` |
| 계획 | `listPlans`, `getPlan`, `submitPlan`, `approvePlan`, `rejectPlan` |
| 이전 | `listMigrations`, `getMigration`, `startMigration`, `switchMigration`, `abortMigration`, `resumeMigration` |
| 환경, 트래픽 | `listEnvironments`, `getEnvironment`, `getTraffic(window)` |
| 기타 | `getMatrix`, `listAudit({ limit, before })` |

- 실패하면 `ApiError`를 던진다. `status`는 HTTP 상태, `code`와 `message`는 서버의 `{"error":{"code","message"}}` 값이다.
- 응답이 오지 않으면 `status`가 0이다. `code`는 `timeout`(기본 15초) 또는 `network_error`(서버 다운, CORS 거부)다.
- 호출한 쪽이 `signal`을 abort하면 `ApiError`가 아니라 fetch의 `AbortError`로 끝난다. 취소와 실패를 구분하려는 것이다.
- `startMigration`은 Idempotency-Key를 꼭 받는다. 사용자가 시작 버튼을 누를 의도 하나마다 `newIdempotencyKey()`로 키를 한 번 만들고, 재시도에는 같은 키를 다시 보낸다. 그러면 버튼을 두 번 눌러도 run이 하나만 생긴다.

## 훅

| 훅 | 돌려주는 값 |
|----|-------------|
| `useEnvironments(pollMs)` | `Environment[]` |
| `useTraffic(pollMs, window)` | `TrafficState` |
| `useRuns(pollMs)` | `Run[]` (최신순) |
| `useMatrix()` | `Matrix` |
| `useAudit(limit)` | `AuditEntry[]` (최신순) |
| `useRun(runId)` | `{ run, events, error, connected }` |

- 목록 훅은 `{ data, error, loading, reload }`를 돌려준다. `pollMs`가 0이거나 없으면 한 번만 읽고, 있으면 응답을 받은 뒤 `pollMs`마다 다시 읽는다.
- 폴링 중 실패하면 마지막 `data`는 그대로 두고 `error`만 채운다. 다음 성공에서 `error`가 지워진다.
- 모든 훅은 언마운트할 때 요청과 타이머, 스트림을 정리한다.

## 페이지를 src/sim에서 훅으로 바꾸는 방법

페이지마다 sim 데이터를 읽던 줄을 훅으로 바꾸고, 계약 필드 이름에 맞춰 표시만 고친다. 예를 들어 환경 페이지는 이렇게 바뀐다.

```tsx
import { useEnvironments } from "../api/hooks";

export function Envs() {
  const envs = useEnvironments(10_000); // 10초마다 다시 읽는다
  if (envs.error?.status === 401) return <p>토큰을 설정하세요.</p>;
  if (envs.loading) return <p>불러오는 중</p>;
  return (
    <Table
      head={["환경", "위치", "Kubernetes", "노드", "상태"]}
      rows={(envs.data ?? []).map((e) => [
        td(<b>{e.displayName}</b>),
        td(e.region ?? ""),
        td(e.status.kubernetesVersion ?? "", "m"),
        td(e.status.nodes ? `${e.status.nodes.ready}/${e.status.nodes.total}대` : ""),
        td(<Chip kind={e.status.reachable ? "ok" : "bad"}>{e.status.reachable ? "정상" : "연결 안 됨"}</Chip>),
      ])}
    />
  );
}
```

이전 페이지는 run 하나를 `useRun`으로 따라간다.

```tsx
const [key] = useState(newIdempotencyKey);         // 이 화면에서 시작 의도 하나에 키 하나
const [runId, setRunId] = useState<string | null>(null);
const { run, events, error, connected } = useRun(runId);

async function start() {
  const res = await startMigration({ planRef, canary: { weights: [10, 50] } }, key);
  setRunId(res.runId);
}

// 복제 지연은 Run에 필드가 없어서 마지막 metric 이벤트에서 읽는다.
const lag = [...events].reverse().find((e) => typeof e.data?.lagBytes === "number")?.data?.lagBytes;
```

1. `run.status`가 `awaiting_switch`이면 전환 버튼을 보여 주고 `switchMigration(run.runId)`를 부른다.
2. 끝난 상태 `succeeded`, `rolled_back`, `halted`, `failed`, `aborted`, `interrupted`는 각각 따로 표시한다. `failed`, `aborted`, `interrupted`는 `resumeMigration`으로 이어 갈 수 있다.
3. 카나리 진행은 `run.canary.steps`에서, 단계 로그는 `events`에서 그린다.
4. 실제 데이터로 바꾼 페이지에서는 상단 시연 배너를 지운다.

## SSE 계약 (`GET /v1/migrations/{runId}/events`)

서버가 보내는 순서는 다음과 같다.

1. 첫 메시지는 `snapshot`이다. data는 `Run`이고 SSE id가 없다.
2. 이어서 저장된 `RunEvent`를 보낸다. SSE event 이름은 `kind`, SSE id는 `seq`다.
3. run이 진행 중(`running`, `awaiting_switch`)인 동안 연결을 유지하고 15초마다 `: keep-alive` 주석을 보낸다.
4. run이 끝나면 마지막 `snapshot`을 보내고 연결을 닫는다.
5. 다시 연결할 때 `Last-Event-ID`(또는 `?after=`)에 마지막 seq를 보내면 놓친 이벤트를 다시 보내 준다. 이벤트는 저장되므로 빠지는 것이 없다.

브라우저의 EventSource는 Authorization 헤더를 못 붙이므로 fetch와 ReadableStream으로 읽는다. CORS가 허용하는 요청 헤더는 `Authorization`, `Content-Type`, `Idempotency-Key`, `Last-Event-ID`, `X-Request-Id`뿐이라 `Cache-Control` 헤더 대신 fetch의 `cache: "no-store"`를 쓴다.

`watchRun(runId, handlers, { signal })`은 이렇게 동작한다.

- 연결마다 오는 snapshot은 모두 `onSnapshot`으로 넘기고, 이벤트는 `onEvent`로 seq마다 한 번만 넘긴다. 다시 보내진 seq는 버린다.
- 연결이 끊기면 0.5초부터 최대 15초까지 늘어나는 간격으로 다시 연결하고, 마지막 seq를 `Last-Event-ID`로 보낸다. 45초 동안 keep-alive조차 오지 않으면 죽은 연결로 보고 다시 연결한다.
- 마지막 snapshot의 상태가 `running`, `awaiting_switch`가 아니고 서버가 연결을 닫으면 끝난다. 끝난 run을 열면 이력을 모두 받은 뒤 끝난다.
- 4xx(408, 429 제외)와 계약을 어긴 응답은 다시 연결해도 같으므로 바로 멈추고 `ApiError`로 reject한다. 네트워크 오류, 타임아웃, 5xx는 계속 다시 연결한다.

`useRun`은 이벤트를 run에 이렇게 반영한다.

- snapshot이 오면 run을 snapshot으로 바꾼다. snapshot이 기준이다.
- 시각(`time`)이 snapshot의 `updatedAt`보다 늦은 이벤트만 run을 바꾼다. 시각은 나노초까지 비교한다. 그보다 이른 이벤트는 snapshot에 이미 들어 있으므로 `events`에만 쌓는다.
- `status_changed`는 status, phase, statusReason을 바꾼다. `canary_step`은 카나리 단계를 열고, `gate_result`는 그 단계에 게이트 결과를 넣는다. `metric`의 `downtimeMillis`는 `run.result.downtimeMillis`가 된다.
- 같은 이벤트를 두 번 반영해도 결과가 같다. 서버가 문서를 저장하기 직전에 찍은 snapshot은 `updatedAt`이 실제보다 이르지만, 이벤트를 그 시각이 속한 단계에 맞춰 넣으므로 단계가 두 번 생기지 않는다.
- 서버 snapshot에는 끝난 카나리 단계만 들어 있다. 그래서 진행 중인 단계에서 다시 연결하면 그 단계가 잠시 사라졌다가 `gate_result`가 오면 다시 보인다.

## 테스트

```bash
npm test
```

`sse.test.ts`는 파서의 경계 사례(여러 줄 data, 주석, CRLF와 CR, 청크 경계에서 나뉜 CRLF와 UTF-8 문자, id 이어받기)와 재연결 중복 제거를, `client.test.ts`는 오류 해석과 요청 형식을, `hooks.test.tsx`는 가짜 fetch로 훅의 폴링, 정리, 이벤트 반영을 확인한다. 실제 서버에는 요청하지 않는다.
