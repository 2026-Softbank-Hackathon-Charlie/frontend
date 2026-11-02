# HopCharlie 콘솔 (frontend)

HopCharlie 운영 콘솔입니다. 플랫폼 API 토큰을 넣으면 **실제 플랫폼 API**(`src/api`)를 읽고, 토큰이 없으면 **시연용 시뮬레이션**으로 같은 화면을 보여 줍니다. 시뮬레이션도 플랫폼 계약과 같은 데이터 모양(`PlanRecord`, `Run`, `RunEvent`, `AgentSession`, `AgentEvent`)을 만듭니다.

- 스택: Vite 8 + React 19 + TypeScript, 테스트는 Vitest + Testing Library
- 디자인: SoftBank 디자인 시스템 토큰 (`src/styles/tokens.css`)

```bash
npm install
npm run dev        # 개발 서버
npm test           # 시뮬레이션·화면 테스트
npm run build      # 타입 검사 + 프로덕션 빌드
```

## 화면

시연용 시뮬레이션 화면입니다. 숫자와 로그는 모두 가상입니다. (1440px 너비, 전체 페이지)

### 개요
클러스터 3개의 상태, 6개 경로 결과표, 앱, 최근 활동을 한 화면에서 봅니다.

![개요](docs/screenshots/overview.png)

### 기존 앱 가져오기
플랫폼 밖(EC2, RDS, S3)에서 돌던 앱을 AI가 점검하고 고쳐서 클러스터에 첫 배포합니다. AI 범위 결정(3장 7번) 전 시안입니다.

| 1. 연결 정보 | 2. AI 점검 |
| --- | --- |
| ![연결 정보](docs/screenshots/onboard-1-connect.png) | ![AI 점검](docs/screenshots/onboard-2-ai-check.png) |
| **3. 샌드박스 테스트** | **4. PR 승인과 첫 배포** |
| ![샌드박스 테스트](docs/screenshots/onboard-3-sandbox.png) | ![첫 배포](docs/screenshots/onboard-4-done.png) |

### 이전
**설정:** 원본은 앱이 지금 쓰기를 받는 클러스터이고, 옮겨 갈 클러스터를 고릅니다.

![이전 설정](docs/screenshots/migrate-1-setup.png)

**AI 계획 → 리허설 → 승인:** Plan(`PlanRecord`: revision, 원본·대상 엔드포인트, 첨부), AI 세션 3개(계획, 리허설, 진단)의 도구 호출 기록, 막힌 명령, AI 수정안(values diff, Plan 첨부로 올라가며 revision이 오름)을 보고 승인합니다. 승인은 화면에 보이는 revision으로 보냅니다.

![승인 대기](docs/screenshots/migrate-2-approve.png)

**실행:** 엔진 9단계(사전 확인, 대상 준비, 초기 복사, 변경분 동기화 → 쓰기 보류, 대상 승격, 트래픽 전환 → 검증, 마무리)와 읽기 카나리(10%, 50%, 단계마다 게이트)를 보여 줍니다. 데이터가 맞으면 **전환 승인 대기**(`awaiting_switch`)에서 운영자가 전환을 누릅니다.

| 동기화 | 전환 승인 대기 (카나리 통과) |
| --- | --- |
| ![동기화](docs/screenshots/migrate-3-sync.png) | ![전환 승인 대기](docs/screenshots/migrate-4-awaiting-switch.png) |
| **전환 중 (쓰기 보류, 승격)** | **이전 리포트** |
| ![전환 중](docs/screenshots/migrate-5-cutover.png) | ![이전 리포트](docs/screenshots/migrate-6-report.png) |

리포트는 `RunResult`(전체 시간, 쓰기 보류, 실패 요청, 누락 행·쓰기·파일, 검증)를 보여 주고, 성공한 이전은 **롤백**(1-click, 반대 방향의 새 run)할 수 있습니다.

### 경로별 결과
EKS, GKE, k3s 사이 6개 방향의 결과표입니다.

![경로별 결과](docs/screenshots/routes.png)

### AI 활동, 보안
**AI 활동**(`#agents`)은 에이전트 세션과 이벤트(도구 호출, 결과, 막힌 명령, 결정)를 모읍니다. **보안**(`#security`)은 환경별 보안 점검 결과입니다. 시뮬레이션의 보안 데이터는 `MOCK:` 고정값입니다.

| AI 활동 | 보안 |
| --- | --- |
| ![AI 활동](docs/screenshots/agents.png) | ![보안](docs/screenshots/security.png) |

### 앱, 새 앱 배포, 환경

| 앱 목록 | 앱 상세 (shop) |
| --- | --- |
| ![앱](docs/screenshots/apps.png) | ![shop](docs/screenshots/app-shop.png) |
| **새 앱 배포** | **환경** |
| ![새 앱 배포](docs/screenshots/new-app.png) | ![환경](docs/screenshots/envs.png) |

### 디자인 시스템 (`#design-system`)
메뉴에는 없는 화면입니다. 주소창에 `#design-system`을 붙여서 엽니다. 색(대비 포함), 글꼴, 간격과 모서리, 상태 표현, 컴포넌트, 움직임을 화면과 같은 토큰과 클래스로 보여줍니다.

![디자인 시스템](docs/screenshots/design-system.png)

### Figma로 옮기기
- **이미지로:** `docs/screenshots/`의 PNG를 Figma에 끌어다 놓습니다.
- **편집 가능한 레이어로:** html.to.design 크롬 확장을 설치하고, `npm run dev`로 띄운 화면(`http://localhost:5173/#...`)에서 확장을 눌러 캡처한 뒤 Figma의 html.to.design 플러그인에서 불러옵니다. 진행 상태가 있는 화면(승인 대기, 전환 중, 리포트)은 그 상태까지 진행한 뒤 캡처합니다.

## 실제 API에 연결하기

1. 프로젝트 루트에 `.env.local`을 만들고 `VITE_PLATFORM_URL=<플랫폼 주소>`를 적은 뒤 `npm run dev`를 다시 시작합니다 (자세한 내용은 `src/api/README.md`).
2. 화면 오른쪽 위 **API 연결**에 토큰을 넣습니다. 승인, 시작, 전환, 중단, 롤백은 operator 토큰이 필요합니다.
3. 연결되면 상단 배너가 바뀌고 개요, 앱, 이전, 경로별 결과, AI 활동, 보안, 환경 화면이 API를 읽습니다. 새 앱 배포와 기존 앱 가져오기는 아직 시연 화면입니다.

토큰은 기본으로 메모리에만 두고, "이 탭을 새로고침해도 유지"를 켜면 sessionStorage에 둡니다. 화면과 로그에는 토큰을 다시 보여 주지 않습니다.

## 이전 흐름

| 단계 | 시뮬레이션 | 실제 API |
| --- | --- | --- |
| Plan | AI 계획 세션이 Plan을 만들고 제출 (`pending_approval`) | `POST /v1/plans/draft` → `POST /v1/plans` |
| 리허설·진단 | AI 세션(리허설, 진단)과 이벤트, 수정안 첨부로 revision 상승 | `GET /v1/agent/sessions?planRef=`, 세션 SSE |
| 승인 | 보고 있는 revision으로 승인. 다르면 다시 확인하라는 안내 | `POST /v1/plans/{ref}/approve` `{revision}` (바뀌었으면 409) |
| 시작 | 읽기 카나리 10%, 50% | `POST /v1/migrations` (Idempotency-Key, `canary.weights`) |
| 진행 | 9단계, 카나리 게이트, 복제 지연, 쓰기 보류 | run SSE (`useRun`) |
| 전환 | `awaiting_switch`에서 전환 버튼 | `POST /v1/migrations/{id}/switch` |
| 중단·재개 | 승격 요청 전까지 중단 가능, 중단·실패는 이어서 실행 | `/abort`, `/resume` |
| 롤백 | 성공한 이전을 반대 방향으로 (전환 대기 없이) | `POST /v1/migrations/{id}/rollback` |

상태는 계약의 8가지(`running`, `awaiting_switch`, `succeeded`, `rolled_back`, `halted`, `failed`, `aborted`, `interrupted`)를 각각 다르게 표시합니다. 대상 승격을 요청하기 전(`promoteRequested` 전)에는 실패하면 원복하고, 그 뒤에는 멈춥니다.

- 샘플 앱 서비스 목록과 보안 시연 데이터는 자리표시입니다. `MOCK:` 주석을 검색하면 바꿀 곳이 나옵니다.
- 기존 앱 가져오기(AI 점검 → 샌드박스 테스트 → PR 승인 → 첫 배포)는 AI 범위 결정(3장 7번) 전 시안입니다.

## 구조
```
src/api/            플랫폼 API 데이터 계층 (계약 타입, 클라이언트, SSE, 훅) — #3
src/data/live.ts    API 연결 상태(토큰), Plan 목록 폴링, 오류 문구
src/data/migration.ts  이전 화면용 보기 모델: 시뮬레이션과 실제 API를 같은 모양으로
src/sim/mig.ts      계약 모양으로 만드는 이전 시뮬레이션 (Plan, Run, RunEvent, AgentSession)
src/sim/state.ts    시뮬레이션 상태 머신 (배포, 가져오기, 이전)
src/sim/store.tsx   100ms 틱, React 구독
src/router.ts       해시 라우팅 (#overview, #apps, #app-<id>, #new, #onboard, #migrate, #migrate-shop, #routes, #agents, #security, #envs, #design-system)
src/pages/          화면 (실제 API 모드와 시뮬레이션 모드를 각각 감싸고, 그리는 코드는 하나)
src/components/     공통 UI (Chip, Ind, LogBox, Table, PageHead, AI 세션 표)
```
