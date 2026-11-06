# src/api: 플랫폼 API 데이터 계층

콘솔이 실제 플랫폼 API(`platform/api/openapi.yaml`)와 통신하는 계층입니다. 화면 코드는 건드리지 않고, 페이지가 `src/sim` 대신 가져다 쓸 수 있게 준비해 둔 것입니다.

| 파일 | 내용 |
|------|------|
| `schema.d.ts` | openapi.yaml에서 생성한 타입. 손으로 고치지 않는다 |
| `types.ts` | `Session`, `DeviceLogin`, `DeviceLoginApproveRequest`, `Run`, `RunEvent`, `Environment`, `TrafficState`, `PlanRecord`, `Matrix`, `AuditEntry`, `SecurityReport`, `AgentSession`, `AppSpec`, `AppSpecValidation`, `Deployment`, `DeploymentEvent`, `GitHubRepo`, `AppSecrets`, `AppSecretsUpdate`, `AppSecretValue` 같은 짧은 이름 |
| `client.ts` | API 함수, `ApiError`, 토큰(메모리), 401 알림(`onUnauthorized`) |
| `sse.ts` | fetch 기반 SSE 파서와 `watchRun`, `watchAgentSession`, `watchDeployment` |
| `hooks.ts` | React 훅 (`useEnvironments`, `useTraffic`, `useRuns`, `useMatrix`, `useAudit`, `useRun`, `useApps`, `useApp`, `useDeployments`, `useDeployment`, `useAppSecrets`, `useGitHubRepos`, `useAppSpecValidation`, `useSecurity`, `useAgentSessions`, `useAgentSession`) |
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

## 로그인과 토큰

`/healthz`, `/openapi.yaml`, 로그인 엔드포인트(`POST /v1/auth/login`, CLI용 `POST /v1/auth/device`, `POST /v1/auth/device/token`)를 빼면 모든 요청에 `Authorization: Bearer <token>`이 필요하다. 콘솔은 관리자 아이디와 비밀번호로 로그인해 받은 세션 토큰(역할 operator, 12시간)을 쓴다. 토큰을 붙여 넣는 입력은 없다.

```ts
import { login, logout, onUnauthorized, setToken } from "../api/client";

const session = await login({ username, password }); // Session: token, expiresAt, principal
setToken(session.token); // 메모리에만 둔다
await logout();          // 서버에서 세션을 끝낸다. 그 토큰은 이후 401이다
setToken(null);
const off = onUnauthorized(() => {}); // 지금 토큰을 실어 보낸 요청이나 스트림이 401을 받으면 불린다
```

- `client.ts`는 토큰을 메모리에만 둔다. 세션 보관은 `src/data/live.ts`가 맡는다. 로그인하면 `Session`을 localStorage `hopcharlie.session`에 JSON으로 저장하고 `setToken`으로 넘긴다. 그래서 새로고침하거나 새 탭을 열어도 `expiresAt`까지 로그인이 유지된다. 시작할 때 `expiresAt`이 지났거나 읽을 수 없는 세션은 지운다. 열어 둔 동안에도 `expiresAt`에 맞춘 타이머로 세션을 끝낸다. 잠자기에서 깨어난 노트북처럼 타이머가 늦을 수 있어서, 페이지가 다시 보일 때와 일반 모드로 바꿀 때도 확인한다.
- 모드(`demo`, `live`)는 localStorage `hopcharlie.mode`에 둔다. 저장된 모드가 없으면 모드 선택 화면을 보여 준다. 모드를 바꿔도 세션은 지우지 않는다. 페이지는 `useLive()`로 API와 시뮬레이션 중 하나를 고르는데, 일반 모드이고 세션이 있을 때만 true다. 일반 모드에서 세션이 없으면 로그인 화면이 페이지 자리를 대신한다.
- localStorage를 쓸 수 없거나 접근이 예외를 던지면 모드와 세션을 그 페이지의 메모리에만 둔다.
- 401은 한곳에서 처리한다. `client.ts`의 요청과 `sse.ts`의 스트림이 401을 받으면 `onUnauthorized` 리스너를 부른다. 보낸 토큰이 지금 토큰과 같을 때만 부르므로 앞선 세션의 늦은 응답이 새 세션을 끝내지 않는다. `live.ts`는 리스너에서 저장된 세션을 다시 읽는다. 다른 탭이 그사이 새로 로그인해 다른 세션을 저장해 두었으면 그 세션으로 바꾸고, 아니면 세션을 지우고 "세션이 만료되었습니다. 다시 로그인하세요"를 띄운 로그인 화면으로 돌아간다. 페이지는 401을 따로 다루지 않는다.
- 저장된 세션은 끝내는 세션과 토큰이 같을 때만 지운다(401, 만료, 로그아웃 모두). 오래된 세션을 쥔 탭이 다른 탭의 새 세션을 지우지 않게 하려는 것이다.
- 탭 사이 동기화: `storage` 이벤트로 다른 탭의 로그인과 로그아웃을 따라간다. 다른 탭에서 로그아웃하면 만료 안내 없이 로그인 화면으로 돌아가고, 다른 탭에서 로그인하면 로그인 화면이 그 세션으로 넘어간다. 모드는 탭마다 따로 둔다.
- 로그아웃은 `logout()`을 보낸 뒤 응답을 기다리지 않고 바로 세션을 지운다. 서버에 닿지 않아도 이 브라우저에서는 로그아웃된다. `logout`은 fetch `keepalive`로 보내서 로그아웃하고 바로 탭을 닫아도 요청이 끊기지 않는다.
- 로그인 요청이 끝나기 전에 "로그인하지 않고 데모 모드로 보기"를 누르거나 로그인 화면을 떠나면 그 요청을 취소한다. 늦게 온 응답이 일반 모드로 되돌리지 않는다.
- localStorage는 같은 origin에서 도는 모든 스크립트(XSS 버그, 브라우저 확장)가 읽을 수 있다. 세션이 12시간이면 끝나고 로그아웃하면 서버에서도 무효가 되게 한 이유다. 공용 PC에서는 다 쓰고 로그아웃한다.
- 토큰은 로그에 찍지 않고 오류 메시지에도 넣지 않는다. 화면에서도 토큰 값을 보여 주지 않는다.

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
| 인증 | `login`, `logout`, `getDeviceLogin`, `approveDeviceLogin(userCode, role)`, `denyDeviceLogin`, `onUnauthorized(cb)` |
| 계획 | `listPlans`, `getPlan`, `submitPlan`, `approvePlan`, `rejectPlan`, `listApps`, `draftPlan`, `putPlanAttachment`, `getPlanAttachment` |
| 이전 | `listMigrations`, `getMigration`, `startMigration`, `switchMigration`, `abortMigration`, `resumeMigration`, `rollbackMigration`, `getWrittenRecords` |
| 환경, 트래픽 | `listEnvironments`, `getEnvironment`, `getTraffic(window, app)` |
| 보안 | `getSecurity({ environment, severity, refresh })` |
| 에이전트 활동 | `listAgentSessions({ planRef, runId, limit })`, `getAgentSession`, `listAgentEvents(id, { after, limit })`, `listAllAgentEvents` |
| GitHub 앱 배포 | `createApp`, `getApp`, `deleteApp`, `validateAppSpec`, `createDeployment(name, { branch, ref, environments, redeploy })`, `listDeployments(name, { branch, limit })`, `createAppInstance(name, { branch, autoDeploy })`, `deleteAppInstance(name, instance)`, `getDeployment`, `listGitHubRepos`, `specInvalid(e)` |
| 앱 시크릿 | `listAppSecrets(name)`, `updateAppSecrets(name, { instance, set, delete })`, `getAppSecret(name, secret, { instance })` |
| 기타 | `getMatrix`, `listAudit({ limit, before })` |

- 실패하면 `ApiError`를 던진다. `status`는 HTTP 상태, `code`와 `message`는 서버의 `{"error":{"code","message"}}` 값이다.
- 응답이 오지 않으면 `status`가 0이다. `code`는 `timeout`(기본 15초) 또는 `network_error`(서버 다운, CORS 거부)다.
- 호출한 쪽이 `signal`을 abort하면 `ApiError`가 아니라 fetch의 `AbortError`로 끝난다. 취소와 실패를 구분하려는 것이다.
- `startMigration`은 Idempotency-Key를 꼭 받는다. 사용자가 시작 버튼을 누를 의도 하나마다 `newIdempotencyKey()`로 키를 한 번 만들고, 재시도에는 같은 키를 다시 보낸다. 그러면 버튼을 두 번 눌러도 run이 하나만 생긴다.
- `approvePlan`에는 사용자가 본 계획의 `revision`을 `{ revision: plan.revision }`으로 보낸다. 첨부가 있는 계획은 revision이 없거나 그사이 첨부가 올라와 바뀌었으면 409 `plan_state_conflict`로 실패한다. 이때는 계획을 다시 읽어 보여 주고 다시 승인받는다.
- `putPlanAttachment`는 파일 내용을 `application/octet-stream` 그대로 보낸다(최대 1 MiB). 올릴 때마다 계획의 revision이 1 오른다. `getPlanAttachment`는 올린 내용을 그대로(`ArrayBuffer`) 돌려준다. 오류는 다른 호출처럼 JSON이다. 이전 화면은 이 내용을 보여 주고, 기록의 `sha256`과 맞는지 확인한다.
- `rollbackMigration`은 Idempotency-Key를 받지 않는다. 서버가 run 하나를 한 번만 되돌리므로 다시 눌러도 run이 둘 생기지 않고, 이미 시작된 되돌리기는 409 `run_state_conflict`로 알려 준다.
- `createApp`, `createDeployment`, `createAppInstance`는 platform.yaml이 규칙을 어기면 422 `invalid_app_spec`으로 실패한다. 본문의 `validation`이 `ApiError.validation`에 들어 있고, `specInvalid(e)`로 꺼내면 `validateAppSpec`의 답과 같은 모양이다. 화면은 이 경우를 일반 오류가 아니라 확인 결과(고칠 항목과 위치)로 보여 준다.
- `deleteApp`은 본문 없는 202로 끝난다. Argo CD가 앱과 그 데이터(DB, 버킷)를 지우므로 되돌릴 수 없다. 파일(`PLATFORM_APPS_FILE`)에만 있는 앱은 409 `app_not_registered`다.
- 앱은 기본 브랜치를 인스턴스 `<app>`으로, 추가한 브랜치를 `<app>--<slug>`로 배포한다(ADR 0015). `createAppInstance`는 브랜치를 더하고 그 인스턴스의 첫 배포를 돌려준다. 이미 배포하는 브랜치는 409 `branch_exists`, 슬러그가 같은 다른 브랜치가 있으면 409 `instance_exists`, 인스턴스가 이미 3개면 409 `instance_limit`이다. `deleteAppInstance`는 `deleteApp`처럼 본문 없는 202로 끝나고, 기본 인스턴스는 409 `default_instance`다.
- `createDeployment`의 `branch`가 배포할 인스턴스를 고른다. 비우면 기본 인스턴스다.
- `createDeployment(name, { branch, redeploy: true })`는 빌드하지 않고 GitHub도 읽지 않는다. 그 인스턴스의 마지막 healthy 배포를 같은 커밋과 이미지로, 지금 시크릿을 넣어 다시 배포한다(trigger `redeploy`). healthy 배포가 없으면 409 `nothing_to_redeploy`, 그 인스턴스에 끝나지 않은 배포(queued, building, committing, syncing)가 있으면 409 `deployment_in_progress`, `ref`와 함께 보내면 400 `invalid_request`다. 진행 중인 배포도 gitops에 커밋할 때의 시크릿을 쓰므로, 콘솔은 그동안 그 인스턴스의 재배포 버튼을 끄고 "진행 중인 배포가 끝난 뒤 재배포할 수 있습니다"라고 적는다. 버튼에는 다시 배포할 커밋(배포 목록이나 인스턴스의 마지막 healthy 배포)의 앞 7자리를 붙이고, `branch`를 늘 채워 보낸다.
- 앱 시크릿(ADR 0019)은 앱 공통 시크릿과 인스턴스별 덮어쓰기로 나뉜다. 인스턴스는 앱 공통 시크릿 위에 자기 덮어쓰기를 얹은 값을 받는다.
  - `listAppSecrets`는 앱 공통(`app`)과 덮어쓰기가 하나라도 있는 인스턴스(`instances`)의 이름, 바꾼 시각, 바꾼 사람만 돌려준다. 값은 없다. 역할 viewer로 된다.
  - `updateAppSecrets`는 한 범위를 한 번에 바꾼다. `instance`가 없으면 앱 공통, 있으면 그 인스턴스의 덮어쓰기다. `set`은 넣거나 바꿀 이름과 값, `delete`는 지울 이름이다. 덮어쓰기를 지우면 그 인스턴스는 앱 공통 값으로 돌아간다. 응답은 바뀐 뒤의 이름 목록이다.
  - 이름은 `^[A-Z_][A-Z0-9_]*$`에 64자까지이고 PORT, DATABASE_URL, S3_로 시작하는 이름은 쓸 수 없다. 값은 1바이트에서 4096바이트까지(빈 값은 안 된다), 범위마다 50개까지다. 어기거나 같은 이름을 넣으면서 지우거나 바꿀 것이 없으면 400 `invalid_request`, 앱에 없는 인스턴스는 404 `instance_not_found`, 파일에만 있는 앱은 409 `app_not_registered`다. 콘솔은 같은 규칙을 `src/sim/secrets.ts`로 먼저 확인하고, 서버의 400 메시지도 그대로 보여 준다.
  - `getAppSecret(name, secret, { instance })`는 값 하나를 돌려준다. `instance`를 주면 그 인스턴스의 덮어쓰기를 읽고, 비우면 쿼리를 붙이지 않는다. 부를 때마다 서버 감사 로그에 이름이 남는다. 없는 이름은 404 `secret_not_found`다.
  - 세 함수 모두 서버에 시크릿 키가 없으면 503 `secrets_not_configured`다. `updateAppSecrets`와 `getAppSecret`은 operator이고 다른 역할은 403이다. 콘솔은 세션 역할이 operator가 아니거나 403을 받으면 이름만 보여 주고 보기와 수정 버튼을 숨긴다.
  - 값은 PUT 본문과 `getAppSecret`의 응답에만 실린다. URL에 넣지 않고, 로그에 찍지 않고, localStorage나 sessionStorage에 두지 않는다. 화면(`src/components/secrets.tsx`)은 보기를 누른 값만 컴포넌트 state에 두고, 다시 누르거나 페이지나 인스턴스를 떠나거나(언마운트) 60초가 지나면 지운다. 진행 중인 요청은 취소한다. 수정 칸은 가린 입력(type password, 비밀번호 관리자 저장 끔)이고 React state가 아니라 입력의 DOM 값에만 두어 HTML value 속성에 나오지 않는다. 불러온 값은 고치지 않으면 60초 뒤 지운다. 저장하지 않은 변경은 저장, 취소, 페이지를 떠날 때, 그리고 403으로 이름만 보게 될 때 사라진다. 저장하는 동안에는 표의 버튼과 추가 칸을 끄고, 저장이 끝나면 보낸 변경만 지운다.
  - 저장해도 실행 중인 인스턴스는 다시 배포할 때까지 이전 값을 쓴다. 그래서 저장한 뒤 `createDeployment`의 `redeploy`로 재배포한다.
- `login`은 토큰 없이 보내고 `Session`(`token`, `expiresAt`, `principal`)을 돌려준다. 아이디나 비밀번호가 틀리면 401 `invalid_credentials`, 10분 안에 10번 틀리면 429 `too_many_attempts`, 서버에 관리자가 없으면 503 `login_not_configured`다. 429의 `Retry-After`(초)는 `ApiError.retryAfter`에 들어 있다. 서버가 CORS로 이 헤더를 노출한다.
- `logout`은 본문 없는 204로 끝나고, 그 토큰은 이후 401이다.
- `getDeviceLogin(userCode)`는 CLI가 보여 준 코드로 만료되지 않은 기기 로그인(`DeviceLogin`: `client`, `status`, `createdAt`, `expiresAt`, 승인한 뒤에는 `reviewedBy`와 `role`)을 돌려준다. 서버는 코드의 대소문자, 공백, '-'를 가리지 않는다. 없거나 만료된 코드는 404 `device_login_not_found`다.
- `approveDeviceLogin(userCode, role)`은 본문 `{ role }`(`DeviceLoginApproveRequest`, `operator`, `agent`, `viewer` 중 하나)을 꼭 보낸다. CLI 토큰은 승인한 관리자의 이름과 이 역할을 30일 동안 갖는다. 승인하면 CLI가 토큰을 받아 갈 시간이 지금부터 10분 늘어나므로 응답의 `expiresAt`이 늦어질 수 있다. 화면은 서버가 돌려준 값을 그대로 보여 준다. 역할이 없거나 모르는 값이면 400 `invalid_request`다.
- `approveDeviceLogin`, `denyDeviceLogin`은 이미 승인하거나 거절한 요청이면 409 `device_login_state_conflict`다. 세 함수 모두 operator이고 콘솔에 비밀번호로 로그인한 세션이어야 한다. CLI 토큰이나 정적 토큰은 403 `console_session_required`다. CLI가 쓰는 `startDeviceLogin`, `pollDeviceLogin`은 콘솔에 넣지 않았다.
- `listAgentEvents`는 `format=json`으로 저장된 이벤트를 한 쪽씩 읽는다. `listAllAgentEvents`는 `nextAfter`를 따라 끝까지 읽어 모두 돌려준다.

## 훅

| 훅 | 돌려주는 값 |
|----|-------------|
| `useEnvironments(pollMs)` | `Environment[]` |
| `useTraffic(pollMs, window, app)` | `TrafficState` |
| `useRuns(pollMs)` | `Run[]` (최신순) |
| `useMatrix()` | `Matrix` |
| `useAudit(limit)` | `AuditEntry[]` (최신순) |
| `useRun(runId)` | `{ run, events, error, connected }` |
| `useApps(pollMs)` | `App[]` (파일 앱 먼저, 그다음 GitHub에서 등록한 앱. 등록한 앱은 `deploy`가 있다) |
| `useApp(name, pollMs)` | `App` |
| `useDeployments(name, pollMs, limit)` | `Deployment[]` (최신순) |
| `useAppSecrets(name, pollMs)` | `AppSecrets` (이름만, 값 없음) |
| `useGitHubRepos()` | `GitHubRepo[]` |
| `useAppSpecValidation(repo, branch, debounceMs)` | `{ data, error, loading, reload }` |
| `useDeployment(id)` | `{ deployment, events, error, connected }` |
| `useSecurity(pollMs, { environment, severity, refresh })` | `SecurityReport` |
| `useAgentSessions(pollMs, { planRef, runId, limit })` | `AgentSession[]` (최신순) |
| `useAgentSession(id)` | `{ session, events, error, connected }` |

- 목록 훅은 `{ data, error, loading, reload }`를 돌려준다. `pollMs`가 0이거나 없으면 한 번만 읽고, 있으면 응답을 받은 뒤 `pollMs`마다 다시 읽는다.
- 폴링 중 실패하면 마지막 `data`는 그대로 두고 `error`만 채운다. 다음 성공에서 `error`가 지워진다.
- 모든 훅은 언마운트할 때 요청과 타이머, 스트림을 정리한다.
- `useApp`, `useDeployments`, `useAppSecrets`는 이름이 비어 있으면 아무것도 읽지 않는다.
- `useAppSpecValidation`은 레포나 브랜치가 바뀐 뒤 `debounceMs`(기본 0.4초)가 지나면 한 번만 확인하고, 앞선 요청은 취소한다. `reload()`는 같은 레포와 브랜치를 다시 확인한다(고친 커밋을 push한 뒤).

## 페이지를 src/sim에서 훅으로 바꾸는 방법

페이지마다 sim 데이터를 읽던 줄을 훅으로 바꾸고, 계약 필드 이름에 맞춰 표시만 고친다. 예를 들어 환경 페이지는 이렇게 바뀐다.

```tsx
import { useEnvironments } from "../api/hooks";

export function Envs() {
  const envs = useEnvironments(10_000); // 10초마다 다시 읽는다
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
- 전환 후 관찰(`observe`, phase `observe`): `observe_step`은 끝난 관찰 단계 하나를 `run.observe.steps`에 넣는다. 이벤트 시각이 그 단계의 `endedAt`이고, 시작 시각은 `stepDuration`만큼 앞으로 잡는다. 판정이 `violated`면 `passed: false`와 `violation`을 넣는다. `observe_rollback`은 자동 롤백 run 번호(`rollbackRunId`)나 시작하지 못한 이유(`rollbackError`)를 넣는다.
- 관찰은 시작할 때 `startMigration`의 `observe` 옵션으로 켠다(`{ duration: "2m", autoRollback: true }` 등). 콘솔은 승인 화면에서 관찰 여부, 관찰 시간, 자동 롤백을 고르고, `src/data/migration.ts`의 `startRequest`가 요청을 만든다. 카나리와 관찰은 게이트웨이 mode `http` Plan에서만 보내고, 게이트 기준은 플랫폼 기본값을 쓴다.

## 에이전트 세션 SSE (`GET /v1/agent/sessions/{id}/events`)

run 이벤트와 계약이 같다. snapshot의 data는 `AgentSession`, 이벤트는 `AgentEvent`이고 SSE event 이름은 `type`(`tool_call`, `tool_result`, `message`, `blocked`, `decision`, `error`)이다.

- `watchAgentSession(id, handlers, { signal })`은 `watchRun`과 같은 재연결 루프를 쓴다. 재연결, `Last-Event-ID`, 중복 제거, 타임아웃, 재시도 규칙이 모두 같다.
- 세션은 `running`인 동안만 진행 중이다. `succeeded`, `failed`, `cancelled` snapshot 뒤에 서버가 연결을 닫으면 끝난다.
- `useAgentSession`의 `session`은 마지막 snapshot이고 이벤트로 바꾸지 않는다. 진행 중인 세션의 `totals`는 연결할 때 값이므로 실시간 수치는 `events`에서 센다.

## 배포 SSE (`GET /v1/deployments/{id}/events`)

run 이벤트와 계약이 같다. snapshot의 data는 `Deployment`, 이벤트는 `DeploymentEvent`이고 SSE event 이름은 `type`(`phase`, `log`, `environment`, `done`)이다.

- `watchDeployment(id, handlers, { signal })`은 `watchRun`과 같은 재연결 루프를 쓴다. 재연결, `Last-Event-ID`, 중복 제거, 타임아웃, 재시도 규칙이 모두 같다.
- `healthy`, `failed`, `superseded`가 끝난 상태다. `queued`를 포함해 끝나지 않은 동안 서버는 연결을 유지한다.
- `useDeployment`는 이벤트를 배포에 이렇게 반영한다.
  - snapshot이 오면 배포를 snapshot으로 바꾼다.
  - `phase`와 `done`은 상태를 앞으로만 옮긴다(queued, building, committing, syncing, 끝). 다시 받은 옛 `phase` 이벤트는 상태를 되돌리지 않고, 끝난 배포는 바꾸지 않는다. `done`의 `failed`는 `message`를 `error`에 넣는다.
  - `environment` 이벤트에는 환경 상태가 없고 메시지만 있다. 메시지는 그 환경의 `message`가 되고, 상태는 `GET /v1/deployments/{id}`로 다시 읽는다. 이벤트가 몰려도 마지막 이벤트 0.3초 뒤에 한 번, 동시에 하나만 읽는다. 끝난 배포는 다시 읽지 않는다.

## 테스트

```bash
npm test
```

`sse.test.ts`는 파서의 경계 사례(여러 줄 data, 주석, CRLF와 CR, 청크 경계에서 나뉜 CRLF와 UTF-8 문자, id 이어받기)와 재연결 중복 제거를, `client.test.ts`는 오류 해석과 요청 형식을, `hooks.test.tsx`는 가짜 fetch로 훅의 폴링, 정리, 이벤트 반영을 확인한다. 실제 서버에는 요청하지 않는다.
