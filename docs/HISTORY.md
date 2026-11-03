# 버전 히스토리

main에 머지된 PR 순서대로, 그 시점의 콘솔이 어떤 모습이었는지 정리했습니다. 각 버전의 스크린샷은 **그 PR의 머지 커밋을 그대로 띄워서** 시뮬레이션 모드로 찍었습니다(1440px 너비, 전체 페이지). 숫자와 로그는 모두 가상입니다.

| 버전 | PR | 머지 | 화면 | 내용 |
| --- | --- | --- | --- | --- |
| [v1](#v1--pr-1-charlie-콘솔-첫-버전) | [#1](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/1) | 11/2 01:48 | 19장 | 시연용 시뮬레이션 콘솔 첫 버전 |
| [v2](#v2--pr-3-실제-플랫폼-api-데이터-계층) | [#3](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/3) | 11/2 15:03 | 변화 없음 | 실제 플랫폼 API를 읽는 코드 |
| [v3](#v3--pr-2-플랫폼-api-계약-기준-콘솔) | [#2](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/2) | 11/2 15:37 | 13장 | 이전 화면을 플랫폼 흐름에 맞추고 실제 API 연결 |
| [v4](#v4--pr-4-전환-후-관찰) | [#4](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/4) | 11/2 19:48 | 실제 API만 | 전환 후 관찰 표시 |
| [v5](#v5--pr-6-github-레포로-앱-등록과-배포) | [#6](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/6) | 11/3 12:07 | 10장 | GitHub 레포로 앱 등록, 배포 진행 화면 |
| [v6](#v6--pr-5-gitops-배포-workflow) | [#5](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/5) | 11/3 13:25 | 변화 없음 | GitOps로 콘솔 이미지 배포 |
| [v7](#v7--pr-7-버전별-화면-히스토리) | [#7](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/7) | 11/3 14:07 | 변화 없음 | 버전별 화면 히스토리 문서 |

머지 시각은 한국 시간입니다. 지금 main의 화면은 [README의 화면](../README.md#화면)에 있습니다. v6 이후 화면 변화는 없어서 v5와 같습니다.

---

## v1 · PR #1: Charlie 콘솔 첫 버전

머지 커밋 `6c58504` · 11/2 01:48

팀의 콘솔 시안을 Vite + React + TypeScript로 옮긴 첫 버전입니다. SoftBank 디자인 시스템 토큰과 softbank.jp의 애니메이션 방식을 적용했고, 데이터는 모두 시연용 시뮬레이션입니다. 메뉴는 개요, 앱, 이전, 환경 네 개였습니다.

### 개요, 앱, 환경

| 개요 | 앱 |
| --- | --- |
| ![개요](history/pr1/01-overview.png) | ![앱](history/pr1/02-apps.png) |
| **환경** | |
| ![환경](history/pr1/03-envs.png) | |

### 새 앱 배포
레포와 환경을 고르면 빌드부터 세 환경 동시 배포까지 진행합니다.

| 1. 레포와 환경 고르기 | 2. 빌드·배포 진행 |
| --- | --- |
| ![레포 고르기](history/pr1/04-new-app-1-repo.png) | ![배포 진행](history/pr1/05-new-app-2-deploying.png) |
| **3. 배포 완료** | |
| ![배포 완료](history/pr1/06-new-app-3-done.png) | |

### 기존 앱 가져오기
플랫폼 밖(AWS EC2, RDS, S3)에서 돌던 shop을 AI가 점검하고 고쳐서 첫 배포합니다.

| 1. 연결 정보 | 2. AI 점검 |
| --- | --- |
| ![연결 정보](history/pr1/07-onboard-1-connect.png) | ![AI 점검](history/pr1/08-onboard-2-ai-check.png) |
| **3. 샌드박스 테스트** | **4. PR 승인 대기** |
| ![샌드박스 테스트](history/pr1/09-onboard-3-sandbox.png) | ![PR 승인 대기](history/pr1/10-onboard-4-pr.png) |
| **5. 머지와 첫 배포** | |
| ![첫 배포](history/pr1/11-onboard-5-first-deploy.png) | |

### 이전 (shop: AWS → GCP GKE)
준비(동기화) → 전환(쓰기 보류, 트래픽 전환) → 정리 순서입니다. 이 버전에는 AI 계획과 승인 단계가 없고, 실패 경로도 없었습니다.

| 1. 이전할 앱 | 2. 이전 설정 |
| --- | --- |
| ![이전할 앱](history/pr1/12-migrate-1-list.png) | ![이전 설정](history/pr1/13-migrate-2-setup.png) |
| **3. 준비 (DB·S3 동기화)** | **4. 전환 대기** |
| ![준비](history/pr1/14-migrate-3-prepare.png) | ![전환 대기](history/pr1/15-migrate-4-awaiting-switch.png) |
| **5. 전환 확인** | **6. 전환 중** |
| ![전환 확인](history/pr1/16-migrate-5-confirm-switch.png) | ![전환 중](history/pr1/17-migrate-6-cutover.png) |
| **7. 전환 완료, 정리 대기** | **8. 정리 완료** |
| ![전환 완료](history/pr1/18-migrate-7-switched.png) | ![정리 완료](history/pr1/19-migrate-8-done.png) |

---

## v2 · PR #3: 실제 플랫폼 API 데이터 계층

머지 커밋 `91a38af` · 11/2 15:03 · **화면 변화 없음**

콘솔이 실제 플랫폼 API를 부를 때 쓸 `src/api`를 추가했습니다. 화면 코드는 건드리지 않아서 화면은 v1과 같습니다.

- `schema.d.ts`: platform 레포의 `api/openapi.yaml`에서 만든 계약 타입 (`npm run gen:api`)
- `client.ts`: Plan 제출·승인, 이전 시작·전환·중단·재개·롤백, 앱, 보안 뷰, 에이전트 세션 등 API 함수와 토큰 관리
- `sse.ts`: Authorization 헤더를 붙이는 fetch 기반 SSE. 끊기면 `Last-Event-ID`로 다시 접속하고 빠진 이벤트를 한 번씩만 전달
- `hooks.ts`: `useRun`, `useApps`, `useSecurity`, `useAgentSessions` 등 React hook
- 테스트 55개

---

## v3 · PR #2: 플랫폼 API 계약 기준 콘솔

머지 커밋 `0064c16` · 11/2 15:37

v2의 `src/api` 위에서 콘솔을 다시 짰습니다. 토큰을 넣으면 실제 플랫폼 API를 읽고, 없으면 같은 화면을 시뮬레이션으로 보여 줍니다. 시뮬레이션도 계약과 같은 모양(`PlanRecord`, `Run`, `RunEvent`, `AgentSession`)을 만들어서 화면 코드는 하나입니다. 이름이 HopCharlie로 바뀌었고, 경로별 결과, AI 활동, 보안, 디자인 시스템 화면이 생겼습니다.

### 바뀐 개요, 새 화면

| 개요 (6개 경로 결과표 추가) | 경로별 결과 |
| --- | --- |
| ![개요](history/pr2/01-overview.png) | ![경로별 결과](history/pr2/02-routes.png) |
| **AI 활동 (이전 뒤 세션 3개)** | **보안 (시연 데이터는 `MOCK:`)** |
| ![AI 활동](history/pr2/13-agents.png) | ![보안](history/pr2/03-security.png) |

### 이전: AI 계획 → 리허설 → 승인 → 실행
AI가 Plan을 만들고 샌드박스에서 리허설한 뒤, 운영자가 화면에 보이는 revision으로 승인하면 엔진 9단계가 돕니다. 읽기 카나리(10%, 50%)를 지나 데이터가 맞으면 **전환 승인 대기**(`awaiting_switch`)에서 운영자가 전환합니다.

| 1. 이전 설정 | 2. AI 계획, 리허설 중 |
| --- | --- |
| ![이전 설정](history/pr2/05-migrate-1-setup.png) | ![AI 계획](history/pr2/06-migrate-2-plan-rehearsal.png) |
| **3. 승인 대기 (revision 2, AI 수정안 반영)** | **4. 동기화** |
| ![승인 대기](history/pr2/07-migrate-3-approve.png) | ![동기화](history/pr2/08-migrate-4-sync.png) |
| **5. 읽기 카나리** | **6. 전환 승인 대기** |
| ![카나리](history/pr2/09-migrate-5-canary.png) | ![전환 승인 대기](history/pr2/10-migrate-6-awaiting-switch.png) |
| **7. 전환 중 (쓰기 보류, 승격)** | **8. 이전 리포트 (롤백 가능)** |
| ![전환 중](history/pr2/11-migrate-7-cutover.png) | ![리포트](history/pr2/12-migrate-8-report.png) |

### 디자인 시스템 (`#design-system`)
메뉴에는 없는 화면입니다. 색, 글꼴, 간격, 상태 표현, 컴포넌트, 움직임을 실제 토큰으로 보여 줍니다.

<details><summary>펼쳐 보기 (긴 화면)</summary>

![디자인 시스템](history/pr2/04-design-system.png)

</details>

새 앱 배포와 기존 앱 가져오기는 이 버전에서 큰 변화가 없어서 v1 스크린샷으로 갈음합니다.

---

## v4 · PR #4: 전환 후 관찰

머지 커밋 `5712152` · 11/2 19:48 · **시뮬레이션 화면 변화 없음**

platform #19(전환 후 SLO 관찰과 자동 롤백)를 콘솔에 반영했습니다.

- 단계 이름에 "전환 후 관찰"(`observe`)을 추가했습니다.
- 이전 화면의 카나리 표 아래에 **전환 후 관찰** 표(단계별 판정, 요청, 오류율, p95, 자동 롤백 run)를 추가했습니다.
- 이 표는 관찰 옵션을 켜고 시작한 **실제 API의 run**에서만 나옵니다. 시뮬레이션은 관찰 데이터를 만들지 않아서 시뮬레이션 화면은 v3과 같습니다.
- 시작 버튼이 보내는 옵션은 그대로 두었습니다(관찰을 켜면 데모가 2분 늘어나서, 켤지는 팀에서 정함).

---

## v5 · PR #6: GitHub 레포로 앱 등록과 배포

머지 커밋 `b43ca12` · 11/3 12:07

platform #30(GitHub 앱 배포 계약, ADR 0011)을 콘솔에 연결했습니다. 새 앱 배포는 고르는 대로 platform.yaml을 확인하고, 배포는 전용 진행 화면(`#deploy-<id>`)에서 봅니다. 앱 목록에는 상태 필터가 생겼습니다.

### 개요, 앱 목록

| 개요 | 앱 목록 (전체, 정상, 문제 있음, 배포 중 필터) |
| --- | --- |
| ![개요](history/pr6/01-overview.png) | ![앱 목록](history/pr6/02-apps.png) |

### 새 앱 배포: platform.yaml 확인
시뮬레이션 레포마다 결과가 다릅니다.

| notice-board: 배포 가능 | photo-album: 규칙 위반 (직접 고쳐야 하는 항목) |
| --- | --- |
| ![배포 가능](history/pr6/03-new-app-1-check-ok.png) | ![규칙 위반](history/pr6/04-new-app-2-rule-violation.png) |
| **analytics-worker: platform.yaml 없음** | |
| ![platform.yaml 없음](history/pr6/05-new-app-3-no-platform-yaml.png) | |

### 배포 진행

| 진행 중 (2/4 빌드) | 완료 (공개 주소) |
| --- | --- |
| ![진행 중](history/pr6/06-deploy-1-in-progress.png) | ![완료](history/pr6/07-deploy-2-done.png) |
| **빌드 실패 (`dev` 브랜치, 첫 오류 줄 표시)** | **앱 목록: 문제 있음 필터** |
| ![빌드 실패](history/pr6/09-deploy-3-build-failed.png) | ![문제 있음](history/pr6/10-apps-filter-problem.png) |

### 앱 상세

| todo-api (GitHub에서 등록) |
| --- |
| ![앱 상세](history/pr6/08-app-detail-todo-api.png) |

---

## v6 · PR #5: GitOps 배포 workflow

머지 커밋 `7427b4f` · 11/3 13:25 · **화면 변화 없음**

콘솔 이미지 배포 방식만 바꿨습니다. 화면은 v5와 같습니다.

- Actions에서 **Run workflow**를 누를 때만 돕니다(main만).
- 테스트와 빌드를 통과하면 ECR에 7자리 SHA 태그로 이미지를 올리고, infra의 `images.console`과 `images.lock.json`을 바꾸는 **검토용 PR**을 엽니다. 자동 머지는 하지 않습니다.
- 실제 반영은 infra PR을 머지한 뒤 관리 EKS의 Argo CD가 동기화해야 끝납니다.
- 자세한 준비와 순서는 [README의 수동 배포](../README.md#배포-github-actions)에 있습니다.

---

## v7 · PR #7: 버전별 화면 히스토리

머지 커밋 `1a163c0` · 11/3 14:07 · **화면 변화 없음**

이 문서와 README의 버전 표를 추가했습니다. 버전마다 머지 커밋을 그대로 띄워 찍은 스크린샷 42장이 `docs/history/`에 있습니다. 앱 코드는 바뀌지 않았습니다.

---

## 스크린샷을 다시 찍으려면

1. 버전마다 머지 커밋을 따로 꺼냅니다: `git worktree add --detach ../fe-history/pr2 0064c16`
2. `node_modules`는 v2 이후 의존성이 같아서 main의 것을 연결해 써도 됩니다(v1도 그대로 동작).
3. `npx vite ../fe-history/pr2 --port 5202`로 띄우고, 시뮬레이션 화면을 1440px 너비로 진행하면서 전체 페이지를 찍습니다.
