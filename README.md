# HopCharlie 콘솔 (frontend)

HopCharlie 운영 콘솔입니다. 처음 열면 모드를 고릅니다. **일반 모드**는 관리자 아이디와 비밀번호로 로그인해 **실제 플랫폼 API**(`src/api`)를 읽고, **데모 모드**는 로그인 없이 **시연용 시뮬레이션**으로 같은 화면을 보여 줍니다. 모드는 화면 위쪽 버튼으로 언제든 바꿀 수 있고, 바꿔도 로그아웃되지 않습니다. 로그인은 새로고침하거나 새 탭을 열어도 세션이 끝날 때(12시간)까지 유지됩니다. `charlie login`이 보여 준 코드는 일반 모드의 **CLI 연결**(`#device`)에서 승인합니다. 시뮬레이션도 플랫폼 계약과 같은 데이터 모양(`PlanRecord`, `Run`, `RunEvent`, `AgentSession`, `AgentEvent`, `App`, `Deployment`, `DeploymentEvent`, `AppSpecValidation`)을 만듭니다.

- 스택: Vite 8 + React 19 + TypeScript, 테스트는 Vitest + Testing Library
- 디자인: SoftBank 디자인 시스템 토큰 (`src/styles/tokens.css`)

```bash
npm install
npm run dev        # 개발 서버
npm test           # 시뮬레이션·화면 테스트
npm run build      # 타입 검사 + 프로덕션 빌드
```

## 버전 히스토리

머지된 PR마다 그 시점의 콘솔을 띄워서 단계별로 찍은 화면은 [docs/HISTORY.md](docs/HISTORY.md)에 있습니다. 머지 시각은 한국 시간입니다.

| 버전 | PR | 머지 | 내용 |
| --- | --- | --- | --- |
| v1 | [#1](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/1) | 11/2 01:48 | 시연용 시뮬레이션 콘솔 첫 버전 |
| v2 | [#3](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/3) | 11/2 15:03 | 실제 플랫폼 API를 읽는 코드 (화면 변화 없음) |
| v3 | [#2](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/2) | 11/2 15:37 | 이전 화면을 플랫폼 흐름에 맞추고 실제 API 연결 |
| v4 | [#4](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/4) | 11/2 19:48 | 전환 후 관찰 표시 (실제 API 모드에서만) |
| v5 | [#6](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/6) | 11/3 12:07 | GitHub 레포로 앱 등록, 배포 진행 화면 |
| v6 | [#5](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/5) | 11/3 13:25 | GitOps로 콘솔 이미지 배포 (화면 변화 없음) |
| v7 | [#7](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/7) | 11/3 14:07 | 버전별 화면 히스토리 문서 (화면 변화 없음) |

## 화면

### 모드 선택, 로그인, CLI 연결
처음 열면 전체 화면으로 모드를 고릅니다.

- **데모 모드**: 가상 데이터로 시연합니다. 로그인하지 않습니다. 상단 배너의 "처음 상태로 되돌리기"로 시뮬레이션을 처음 상태로 돌립니다.
- **일반 모드**: 실제 플랫폼 API를 읽습니다. 로그인 화면에서 관리자 아이디와 비밀번호(플랫폼 서버의 `PLATFORM_ADMINS`)를 넣습니다. 틀린 아이디나 비밀번호, 너무 잦은 시도(기다릴 초를 함께 표시), 관리자가 설정되지 않은 서버, 연결 실패를 각각 한국어로 알려 줍니다. 로그인 화면에서 데모 모드로 바로 갈 수도 있습니다.
- **헤더**: 일반 모드에서는 로그인한 관리자 이름, "로그아웃", "데모 모드로 전환"이 있고, 데모 모드에서는 "일반 모드로 전환"이 있습니다. 모드를 바꿔도 로그아웃되지 않습니다.
- **CLI 연결**(`#device`, 일반 모드에서만 메뉴에 보임): 터미널에서 `charlie login`을 실행하면 나오는 코드(XXXX-XXXX, 소문자나 공백을 섞어 넣어도 됨)를 입력하고 "확인"을 누르면 요청한 클라이언트, 요청 시각, 남은 시간이 나옵니다. 승인하기 전에 그 CLI에 줄 역할을 고릅니다. 기본으로 골라 둔 역할은 없고, 고르기 전에는 "승인"을 누를 수 없습니다.
  - 관리자(operator): 배포, 앱 등록과 삭제, Plan 승인까지 모두
  - 조회와 Plan 제출(agent): 승인과 배포는 못 함
  - 조회만(viewer)

  봇(Rin 등)에게는 꼭 필요한 역할만 주고, 배포를 맡길 때만 관리자를 고릅니다. "승인"하면 그 CLI가 30일 동안 내 이름과 고른 역할로 동작하고, 결과에 준 역할을 보여 줍니다. "거절"하면 그 CLI 로그인은 끝납니다. 없거나 만료된 코드, 이미 승인하거나 거절한 요청(검토한 사람과, 승인이면 준 역할도 표시), CLI 토큰처럼 비밀번호로 로그인하지 않은 세션은 따로 알려 줍니다. 승인은 콘솔에 비밀번호로 로그인한 세션만 할 수 있어서 CLI 토큰으로 다른 토큰을 만들 수 없습니다. 로그인하지 않은 채 `#device`를 열면 로그인 화면이 먼저 나오고, 로그인하면 일반 모드로 이 화면에 돌아옵니다.

아래는 데모 모드(시연용 시뮬레이션) 화면입니다. 숫자와 로그는 모두 가상입니다. (1440px 너비, 전체 페이지)

### 개요
클러스터 3개의 상태, 6개 경로 결과표, 앱, 최근 활동을 한 화면에서 봅니다.

![개요](docs/screenshots/overview.png)

### 기존 앱 가져오기
플랫폼 밖(EC2, RDS, S3)에서 돌던 앱을 AI가 점검하고 고쳐서 클러스터에 첫 배포합니다. AI 범위 결정(팀 주제 정리 문서 3장 7번) 전 시안입니다.

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

**실행:** 엔진 9단계(사전 확인, 대상 준비, 초기 복사, 변경분 동기화 → 쓰기 보류, 대상 승격, 트래픽 전환 → 검증, 마무리)와 읽기 카나리(10%, 50%, 단계마다 게이트)를 보여 줍니다. 카나리는 플랫폼 게이트웨이(http)를 거치는 Plan에서만 합니다. 데이터가 맞으면 **전환 승인 대기**(`awaiting_switch`)에서 운영자가 전환을 누릅니다. 승인할 때 전환 후 관찰을 켰으면, 전환 뒤에도 정한 시간 동안 대상을 게이트로 판정하고 위반하면 기록하거나 자동 롤백합니다(실제 API 모드).

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

GitHub 레포로 앱을 등록하고 배포하는 화면입니다(ADR 0011).

- **새 앱 배포**(`#new`): GitHub App이 볼 수 있는 레포, 브랜치(기본은 레포의 기본 브랜치), 배포 환경, push 자동 배포를 고릅니다. 고르는 대로 platform.yaml을 확인해서, 통과하면 서비스와 포트, 공개 주소(`https://<이름>.hopcharlie.dev`), 리소스를 보여 주고, 아니면 **직접 고쳐야 하는 항목**(위치, 내용, 고칠 방법)을 보여 줍니다. 플랫폼 기본값을 쓰는 항목도 따로 보여 줍니다. 레포에는 서비스마다 Dockerfile, 루트에 platform.yaml이 있어야 합니다.
- **앱 목록**(`#apps`): 파일 앱(이전 대상)과 GitHub에서 등록한 앱을 함께 보여 줍니다. 등록한 앱에는 GitHub 표시, 환경별 상태, 공개 주소, 최근 배포가 붙습니다. 위의 전체, 정상, 문제 있음, 배포 중 칸을 누르면 그 상태로 거르고, 거른 목록은 주소(`#apps-healthy`, `#apps-problem`, `#apps-deploying`)로 공유할 수 있습니다.
- **앱 상세**(`#app-<이름>`): 레포와 브랜치, 자동 배포, platform.yaml 요약, 환경별 상태(Argo CD sync와 health, 커밋, 주소), 배포 이력을 보여 줍니다. **다시 배포**는 브랜치의 head를 모든 환경에 배포하고, 인스턴스마다 있는 **재배포 (빌드 없이, 커밋 7자리)**는 그 인스턴스의 마지막 정상 배포를 같은 이미지와 지금 시크릿으로 다시 배포합니다(배포 이력의 트리거는 재배포). 그 인스턴스의 배포가 진행 중이면 끝날 때까지 버튼이 꺼집니다. **앱 삭제**는 화면 안에서 한 번 더 확인한 뒤 지웁니다. 이전 설정이 있는 앱은 이전 버튼이 그대로 있습니다.
- **앱 상세의 시크릿**(ADR 0019): 앱 공통 시크릿과, 고른 인스턴스가 받는 시크릿(앱 공통에서 받은 것과 덮어쓴 것)을 표로 보여 줍니다. 표에는 이름, 바꾼 때, 바꾼 사람만 있고, 보기를 누른 값만 서버에서 불러와 보여 줍니다. 다시 누르거나 페이지를 떠나거나 60초가 지나면 값을 지웁니다. 추가, 수정, 삭제, 덮어쓰기, 덮어쓰기 지우기는 저장하지 않은 변경으로 모았다가 범위마다 저장 한 번으로 보내고, 취소로 버릴 수 있습니다. 저장한 뒤에는 실행 중인 인스턴스가 이전 값을 쓴다고 알리고 인스턴스별 재배포와 모든 인스턴스 재배포 버튼을 보여 줍니다. operator가 아닌 토큰은 이름만 봅니다. 데모 모드에서는 todo-api의 가짜 시크릿으로 같은 흐름을 보여 줍니다.
- **배포 진행**(`#deploy-<id>`): 단계(대기열, 이미지 빌드, gitops 커밋, Argo CD 동기화, 그리고 정상, 실패, 대체됨)와 단계 번호(예: 2/4 빌드), 환경별 상태, 실시간 빌드 로그(자동 스크롤, 멈춤 가능), 배포를 만든 때부터 끝날 때까지의 경과 시간(목표 5분)을 보여 줍니다. 성공하면 공개 주소를 누를 수 있고, 실패하면 로그 위에 한 줄 요약을 띄우고 첫 오류 줄로 스크롤해서 표시합니다.
- 시뮬레이션 레포: `notice-board`(바로 배포 가능, `dev` 브랜치는 빌드 실패), `photo-album`(`main`은 규칙 위반, `fix-worker`는 통과), `analytics-worker`(platform.yaml 없음). `todo-api`는 처음부터 등록되어 있습니다.

| 앱 목록 | 새 앱 배포 |
| --- | --- |
| ![앱](docs/screenshots/apps.png) | ![새 앱 배포](docs/screenshots/new-app.png) |
| **새 앱 배포: 규칙 위반 (photo-album)** | **새 앱 배포: platform.yaml 없음 (analytics-worker)** |
| ![규칙 위반](docs/history/pr6/04-new-app-2-rule-violation.png) | ![platform.yaml 없음](docs/history/pr6/05-new-app-3-no-platform-yaml.png) |
| **배포 진행 (진행 중, 2/4 빌드)** | **앱 목록: 문제 있음 필터** |
| ![배포 진행 중](docs/history/pr6/06-deploy-1-in-progress.png) | ![문제 있음](docs/history/pr6/10-apps-filter-problem.png) |
| **앱 상세 (todo-api, GitHub에서 등록)** | **앱 상세 (shop, 이전 대상)** |
| ![todo-api](docs/screenshots/app-todo-api.png) | ![shop](docs/screenshots/app-shop.png) |
| **배포 진행 (완료)** | **배포 진행 (빌드 실패)** |
| ![배포 완료](docs/screenshots/deploy.png) | ![빌드 실패](docs/screenshots/deploy-failed.png) |
| **환경** | |
| ![환경](docs/screenshots/envs.png) | |

### 디자인 시스템 (`#design-system`)
메뉴에는 없는 화면입니다. 주소창에 `#design-system`을 붙여서 엽니다. 색(대비 포함), 글꼴, 간격과 모서리, 상태 표현, 컴포넌트, 움직임을 화면과 같은 토큰과 클래스로 보여줍니다.

![디자인 시스템](docs/screenshots/design-system.png)

### Figma로 옮기기
- **이미지로:** `docs/screenshots/`의 PNG를 Figma에 끌어다 놓습니다.
- **편집 가능한 레이어로:** html.to.design 크롬 확장을 설치하고, `npm run dev`로 띄운 화면(`http://localhost:5173/#...`)에서 확장을 눌러 캡처한 뒤 Figma의 html.to.design 플러그인에서 불러옵니다. 진행 상태가 있는 화면(승인 대기, 전환 중, 리포트)은 그 상태까지 진행한 뒤 캡처합니다.

## 실제 API에 연결하기

1. 프로젝트 루트에 `.env.local`을 만들고 `VITE_PLATFORM_URL=<플랫폼 주소>`를 적은 뒤 `npm run dev`를 다시 시작합니다 (자세한 내용은 `src/api/README.md`).
2. 처음 화면에서 **일반 모드**를 고르거나, 데모 모드 헤더의 **일반 모드로 전환**을 누릅니다.
3. 로그인 화면에서 관리자 아이디와 비밀번호를 넣습니다. 관리자 세션의 역할은 operator라서 승인, 시작, 전환, 중단, 롤백, 앱 등록, 다시 배포, 앱 삭제를 모두 할 수 있습니다.
4. 로그인하면 상단 배너가 바뀌고 개요, 앱, 새 앱 배포, 배포 진행, 이전, 경로별 결과, AI 활동, 보안, 환경, CLI 연결 화면이 API를 읽습니다. 기존 앱 가져오기는 아직 시연 화면입니다.

로그인 세션(토큰, 만료 시각, 관리자 이름)은 localStorage `hopcharlie.session`에, 고른 모드는 `hopcharlie.mode`에 둡니다. 새로고침하거나 새 탭을 열어도 세션이 끝날 때(12시간)까지 로그인이 유지되고, 한 탭에서 로그인하거나 로그아웃하면 다른 탭도 따라갑니다. 모드는 탭마다 따로입니다. 세션이 만료되거나 서버가 401로 답하면 "세션이 만료되었습니다. 다시 로그인하세요"와 함께 로그인 화면으로 돌아갑니다. 로그아웃은 서버에서 세션을 끝내고(`POST /v1/auth/logout`), 서버에 닿지 않아도 이 브라우저에서는 바로 로그아웃합니다. 화면과 로그에는 토큰을 보여 주지 않습니다.

## 이전 흐름

| 단계 | 시뮬레이션 | 실제 API |
| --- | --- | --- |
| Plan | AI 계획 세션이 Plan을 만들고 제출 (`pending_approval`) | `POST /v1/plans/draft` → `POST /v1/plans` |
| 리허설·진단 | AI 세션(리허설, 진단)과 이벤트, 수정안 첨부로 revision 상승 | `GET /v1/agent/sessions?planRef=`, 세션 SSE |
| 승인 | 보고 있는 revision으로 승인. 다르면 다시 확인하라는 안내 | `POST /v1/plans/{ref}/approve` `{revision}` (바뀌었으면 409) |
| 시작 | 게이트웨이(http) Plan은 읽기 카나리 10%, 50%. 승인 화면에서 전환 후 관찰(1~10분)과 위반 시 자동 롤백을 고름 (실제 API 모드) | `POST /v1/migrations` (Idempotency-Key, `canary`, `observe`) |
| 진행 | 9단계, 카나리 게이트, 복제 지연, 쓰기 보류 | run SSE (`useRun`) |
| 전환 | `awaiting_switch`에서 전환 버튼 | `POST /v1/migrations/{id}/switch` |
| 중단·재개 | 승격 요청 전까지 중단 가능, 중단·실패는 이어서 실행 | `/abort`, `/resume` |
| 롤백 | 성공한 이전을 반대 방향으로 (전환 대기 없이) | `POST /v1/migrations/{id}/rollback` |

상태는 계약의 8가지(`running`, `awaiting_switch`, `succeeded`, `rolled_back`, `halted`, `failed`, `aborted`, `interrupted`)를 각각 다르게 표시합니다. 대상 승격을 요청하기 전(`promoteRequested` 전)에는 실패하면 원복하고, 그 뒤에는 멈춥니다.

- 샘플 앱 서비스 목록과 보안 시연 데이터는 자리표시입니다. `MOCK:` 주석을 검색하면 바꿀 곳이 나옵니다.
- 기존 앱 가져오기(AI 점검 → 샌드박스 테스트 → PR 승인 → 첫 배포)는 AI 범위 결정(팀 주제 정리 문서 3장 7번) 전 시안입니다.

## 구조
```
src/api/            플랫폼 API 데이터 계층 (계약 타입, 클라이언트, SSE, 훅) — #3
src/data/live.ts    모드와 로그인 세션(localStorage, 탭 사이 동기화, 만료, 401 처리), Plan 목록 폴링, 오류 문구
src/data/migration.ts  이전 화면용 보기 모델: 시뮬레이션과 실제 API를 같은 모양으로
src/data/deploy.ts  새 앱 배포, 앱 목록과 상세, 배포 진행 화면용 보기 모델
src/data/secrets.ts 앱 시크릿 보기 모델 (이름 목록, 값 하나 불러오기, 저장)
src/sim/mig.ts      계약 모양으로 만드는 이전 시뮬레이션 (Plan, Run, RunEvent, AgentSession)
src/sim/deploy.ts   계약 모양으로 만드는 GitHub 앱 배포 시뮬레이션 (App, Deployment, DeploymentEvent, AppSpecValidation)
src/sim/secrets.ts  앱 시크릿 시뮬레이션과 서버의 이름, 값 규칙
src/sim/state.ts    시뮬레이션 상태 머신 (배포, 가져오기, 이전)
src/sim/store.tsx   100ms 틱, React 구독
src/router.ts       해시 라우팅 (#overview, #apps, #apps-<상태>, #app-<id>, #deploy-<id>, #new, #onboard, #migrate, #migrate-shop, #routes, #agents, #security, #envs, #device, #design-system)
src/pages/          화면 (실제 API 모드와 시뮬레이션 모드를 각각 감싸고, 그리는 코드는 하나). Entry.tsx는 모드 선택과 로그인, Device.tsx는 CLI 연결
src/components/     공통 UI (Chip, Ind, LogBox, Table, PageHead, AI 세션 표, 배포 화면 조각)
```

## 배포 (GitHub Actions)

[Deploy frontend](.github/workflows/deploy.yml)은 **main에 push할 때마다** 자동으로 실행됩니다. Actions의 Run workflow로 main을 다시 게시할 수도 있습니다. 연달아 push하면 진행 중인 이전 실행을 취소하므로 마지막 커밋만 게시됩니다. PR에서는 실행하지 않습니다.

Node 24에서 `npm ci`, GitOps helper 시험, `npm test`, `npm run build`를 통과하면 기존 플랫폼과 같은 Caddy 이미지로 빌드합니다. ECR에 frontend 커밋의 **7자리 SHA 태그** 하나를 게시하고, 빌드 결과의 digest로 infra의 다음 두 파일을 바꾸는 커밋 하나를 **infra main에 바로** 넣습니다(infra ADR 0025). 그사이 infra main이 바뀌면 새 main을 다시 읽어 커밋을 다시 만듭니다.

- `clusters/aws-dev-management/values/hopcharlie-platform.yaml`의 `images.console`: `<ECR 저장소>:<7자리 SHA>@sha256:<digest>`
- `helm/images.lock.json`의 같은 `<ECR 저장소>:<7자리 SHA>` 키: 같은 digest

다른 이미지와 설정은 유지합니다. 같은 이미지가 infra main에 이미 반영돼 있으면 커밋하지 않습니다. `latest` 태그는 게시하지 않으며, 이미지의 `version.txt`에는 추적용 전체 frontend SHA를 둡니다. 인라인 Dockerfile은 platform의 `deploy/console/Dockerfile`과 동기화합니다.

**workflow 성공은 ECR 게시와 infra main 커밋까지입니다.** 실제 콘솔 `https://console.hopcharlie.dev` 반영은 관리 EKS의 Argo CD Application이 infra main을 동기화해야 완료됩니다. workflow는 EC2·SSM·클러스터를 직접 갱신하지 않습니다.

### 최초 준비

Settings → Secrets and variables → Actions → **Variables**에 다음 값을 설정합니다. ECR 저장소와 OIDC 역할은 먼저 준비돼 있어야 합니다.

| 변수 | 값 / 출처 |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | 필수. frontend 이미지 게시용 GitHub OIDC 역할 ARN |
| `ECR_CONSOLE_REPOSITORY` | 필수. infra `terraform/platform/aws`의 `console_repository_url`. 태그 없는 전체 ECR 주소이며 현재 infra 콘솔 저장소와 같아야 합니다 |
| `AWS_REGION` | 선택. 기본 `ap-northeast-2`, ECR과 같은 리전 |
| `VITE_PLATFORM_URL` | 선택. 기본 `https://api.hopcharlie.dev`. 빌드에 포함되는 공개 HTTPS API 주소 |

Terraform output의 소유 위치는 infra `terraform/platform/aws`입니다. 그중 `api_url`, `console_url`, `instance_id`는 기존 EC2 호스트용 값이므로 이 EKS 배포의 입력으로 쓰지 않습니다. `PLATFORM_INSTANCE_ID`와 `CONSOLE_URL` 변수는 필요하지 않습니다. 콘솔 로그인에 쓰는 관리자 계정(`PLATFORM_ADMINS`)은 플랫폼 서버 설정이라 이 workflow에서 다루지 않습니다.

**Secrets**에는 `INFRA_PR_TOKEN`을 준비합니다. 대상 infra 저장소에만 접근하는 fine-grained PAT 또는 GitHub App installation token이며, `Contents: read/write` 권한이 필요합니다(infra main에 바로 커밋). frontend의 기본 `GITHUB_TOKEN`은 다른 비공개 infra 저장소에 쓸 수 없습니다. 토큰은 helper 단계에서만 전달하며 npm 설치·빌드에는 전달하지 않습니다. 토큰의 유효기간과 조직 승인을 확인하고, installation token을 직접 등록했다면 만료 전에 새 실행용 토큰을 준비합니다.

AWS 역할에는 `ecr:GetAuthorizationToken`과 지정된 콘솔 ECR 저장소의 이미지 push 권한이 필요합니다. SSM·EC2 변경·EKS 관리 권한은 필요하지 않습니다. OIDC 신뢰 정책은 `aud=sts.amazonaws.com`과 **이 저장소 main**으로 제한합니다. 조회한 immutable subject는 다음과 같습니다. GitHub Environment를 쓰도록 바꾼다면 subject도 다시 확인합니다.

```text
repo:2026-Softbank-Hackathon-Charlie@350278309/frontend@1441992854:ref:refs/heads/main
```

공식 설정: [AWS용 GitHub OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [GitHub 토큰 권한](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

### 배포 순서

1. main에 push합니다. 다시 게시할 때는 Actions → **Deploy frontend** → **Run workflow**에서 main을 고릅니다.
2. 실행 요약에서 이미지 digest와 infra main 커밋을 확인합니다.
3. `charlie-management-hopcharlie-platform` Application이 그 커밋을 동기화했는지 확인합니다.
4. `https://console.hopcharlie.dev/version.txt`가 전체 frontend SHA와 일치하는지 확인하고, 일반 모드로 로그인해 화면이 실제 API를 읽는지 확인합니다.

롤백은 infra main의 해당 커밋을 되돌리는(revert) 것으로 합니다. workflow는 IAM 역할·토큰·저장소 변수를 만들지 않고, Terraform apply·클러스터 생성·앱 데이터 이전도 수행하지 않습니다.
