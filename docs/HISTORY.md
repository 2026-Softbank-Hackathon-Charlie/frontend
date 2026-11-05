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
| [v8](#v8--pr-8-버전-표-정리) | [#8](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/8) | 11/3 15:04 | 변화 없음 | 버전 표에서 작성자 빼고 칸 비율 정리 |
| [v9](#v9--pr-9-개요-스크린샷-갱신) | [#9](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/9) | 11/3 15:29 | 변화 없음 | README 개요 스크린샷을 지금 화면으로 |
| [v10](#v10--pr-10-시작-전-검사-표시) | [#10](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/10) | 11/3 16:28 | 2장 | 이전 시작 전 검사 결과 표시 |
| [v11](#v11--pr-11-보안-매트릭스) | [#11](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/11) | 11/3 16:58 | 2장 | 보안 화면에 환경 × 분류 매트릭스 |
| [v12](#v12--pr-12-배포-workflow-테스트-수정) | [#12](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/12) | 11/3 17:00 | 변화 없음 | 배포 workflow의 테스트 실패 수정 |
| [v13](#v13--pr-13-main-push마다-콘솔-배포) | [#13](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/13) | 11/3 18:06 | 변화 없음 | main push마다 콘솔 배포 |
| [v14](#v14--pr-14-브랜치-인스턴스) | [#14](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/14) | 11/3 22:27 | 4장 | 브랜치 인스턴스 추가, 삭제, 브랜치별 배포 |
| [v15](#v15--pr-15-로고와-아이콘) | [#15](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/15) | 11/4 00:35 | 2장 | HopCharlie 로고와 아이콘 |
| [v16](#v16--pr-16-모드-선택과-로그인) | [#16](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/16) | 11/4 11:35 | 4장 | 데모·일반 모드 선택, 관리자 로그인, CLI 연결 |
| [v17](#v17--pr-17-대기-서버-설정-검사) | [#17](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/17) | 11/4 14:42 | 실제 API만 | 시작 전 검사의 대기 서버 설정 문장 |
| [v18](#v18--pr-18-전환-후-관찰-시작-옵션) | [#18](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/18) | 11/4 16:01 | 실제 API만 | 승인 화면에서 전환 후 관찰과 자동 롤백 선택 |
| [v19](#v19--pr-19-샘플-앱-moimroom) | [#19](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/19) | 11/4 16:12 | 3장 | 데모 모드의 이전 대상을 moimroom으로 |
| [v20](#v20--pr-20-앱-시크릿과-빌드-없는-재배포) | [#20](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/20) | 11/4 16:36 | 3장 | 앱 시크릿 편집과 빌드 없는 재배포 |
| [v21](#v21--pr-21-버전-히스토리-보강) | [#21](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/21) | 11/4 16:40 | 변화 없음 | 버전 히스토리에 v8~v19 추가 |
| [v22](#v22--pr-22-읽기-카나리-7단계) | [#22](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/22) | 11/4 16:56 | 1장 | 읽기 카나리 7단계와 판단 보류 표시 |
| [v23](#v23--pr-24-빠른-카나리-기본값) | [#24](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/24) | 11/4 17:35 | 1장 | 읽기 카나리 기본값을 10%, 50%, 100%로 |
| [v24](#v24--pr-25-self-hosted-runner) | [#25](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/25) | 11/4 21:18 | 변화 없음 | 콘솔 게시를 self-hosted runner에서 |
| [v25](#v25--pr-23-ai-계획-세션-표시) | [#23](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/23) | 11/4 21:46 | 실제 API만 | 이전 화면에 AI 실행기의 계획 세션 |
| [v26](#v26--pr-26-콘솔-개편-1단계) | [#26](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/26) | 11/5 10:20 | 2장 | 묶음 사이드 메뉴, 상태 색, SUIT 글꼴 |
| [v27](#v27--pr-27-콘솔-개편-2단계) | [#27](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/27) | 11/5 10:27 | 4장 | 이전 상태 카드, 앱 상세 탭, 개요 |
| [v28](#v28--pr-28-마감-다듬기) | [#28](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/28) | 11/5 12:04 | 2장 | 간격, 글자, 컨트롤 다듬기와 넓은 화면 정렬 |
| [v29](#v29--pr-29-광고-차단과-겹치는-클래스-이름) | [#29](https://github.com/2026-Softbank-Hackathon-Charlie/frontend/pull/29) | 11/5 12:09 | 변화 없음 | 광고 차단 확장이 앱 상세를 숨기지 않게 클래스 접두사 변경 |

머지 시각은 한국 시간입니다. 지금 main의 화면은 [README의 화면](../README.md#화면)에 있습니다. 화면이 "변화 없음"인 버전은 바로 앞 버전과 화면이 같고, "실제 API만"인 버전은 플랫폼에 연결한 일반 모드에서만 바뀌어서 시뮬레이션 스크린샷이 없습니다. v16부터는 처음에 모드를 고르므로 데모 모드를 고른 뒤 찍었습니다.

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

## v8 · PR #8: 버전 표 정리

머지 커밋 `04bd85b` · 11/3 15:04 · **화면 변화 없음**

README와 이 문서의 버전 표에서 작성자 열을 빼고, 칸이 두 줄로 꺾이지 않게 내용을 줄였습니다. 문서만 바뀌었습니다.

---

## v9 · PR #9: 개요 스크린샷 갱신

머지 커밋 `098b7b7` · 11/3 15:29 · **화면 변화 없음**

README의 개요 스크린샷이 v3 화면이라, v5(#6)에서 바뀐 앱 목록이 빠져 있었습니다. 지금 화면으로 다시 찍고, README가 인용한 팀 문서의 출처를 밝혔습니다. 앱 코드는 바뀌지 않았습니다.

---

## v10 · PR #10: 시작 전 검사 표시

머지 커밋 `afcb787` · 11/3 16:28

플랫폼이 이전을 시작할 때 실행하는 **시작 전 검사**(데이터 레지던시 platform #37, 용량 platform #38) 결과를 이전 화면에 보여 줍니다.

- 승인 화면에 검사 설명을, 이전 설정의 진행 순서에 "시작 전 검사" 단계를 넣었습니다.
- 실행 화면(읽기 카나리 위)에 검사 표가 나옵니다. 레지던시와 용량(접속 수, 복제 따라잡기, 초기 복사)을 측정값으로 만든 한국어 문장으로 보여 줍니다.
- 시작이 막히면 원인 문구와 함께 승인된 Plan을 화면에 남기고 **다시 시작**, **새 Plan 작성** 버튼을 둡니다. 막히는 경우는 실제 API에서만 생깁니다.

| 승인 화면 (시작 전 검사 설명) | 실행 화면 (시작 전 검사 표) |
| --- | --- |
| ![승인 화면](history/pr10/01-migrate-1-approve.png) | ![시작 전 검사](history/pr10/02-migrate-2-preflight.png) |

---

## v11 · PR #11: 보안 매트릭스

머지 커밋 `6daae9e` · 11/3 16:58

보안 화면 맨 위에 **환경 × 분류 매트릭스**를 넣었습니다. 클라우드마다 다른 보안 서비스(GuardDuty, Security Hub, Security Command Center, Kubernetes 점검)의 결과를 같은 6개 분류와 심각도로 한 표에서 봅니다.

- 칸을 누르면 아래 "찾은 항목"이 그 칸으로 걸러집니다.
- 항목이 없는 칸은 이상 없음, 확인 못 함, 점검 안 함으로 나눠서 0건을 안전으로 보이지 않게 했습니다.

| 매트릭스 | 칸을 눌러 거른 항목 |
| --- | --- |
| ![매트릭스](history/pr11/01-security-matrix.png) | ![거른 항목](history/pr11/02-security-filtered.png) |

---

## v12 · PR #12: 배포 workflow 테스트 수정

머지 커밋 `ceeb50f` · 11/3 17:00 · **화면 변화 없음**

Deploy frontend workflow가 빌드용 API 주소를 테스트에도 넘겨서, 상대 경로를 기대하는 테스트가 실패했습니다. 테스트에서만 그 주소를 뺐습니다.

---

## v13 · PR #13: main push마다 콘솔 배포

머지 커밋 `8deb471` · 11/3 18:06 · **화면 변화 없음**

main에 push하면 테스트, 빌드, ECR 게시를 거쳐 infra main의 콘솔 이미지 고정 값을 바로 바꾸고, Argo CD가 그 커밋을 배포합니다(infra ADR 0025). 사람이 workflow를 실행하고 infra PR을 머지하던 단계가 없어졌습니다.

---

## v14 · PR #14: 브랜치 인스턴스

머지 커밋 `1676409` · 11/3 22:27

platform ADR 0015(등록한 브랜치마다 인스턴스를 따로 띄운다)를 반영했습니다.

- 앱 상세에 **브랜치별 인스턴스** 표가 생겼습니다. 브랜치, 인스턴스, 주소, 환경별 상태, 최근 배포, 자동 배포, 배포 버튼, 추가 인스턴스 삭제(이름 입력 확인)가 있습니다.
- **브랜치 추가** 폼은 인스턴스 이름을 미리 보여 주고, 기본 인스턴스를 포함해 3개가 되면 꺼집니다.
- 배포 이력과 배포 화면에 브랜치와 인스턴스가 나오고, 앱 목록에 "브랜치 N"이 붙습니다.
- 아래 화면은 notice-board를 등록한 뒤 `feature/search` 브랜치를 추가한 것입니다.

| 브랜치 추가 폼 | 추가한 브랜치의 첫 배포 |
| --- | --- |
| ![브랜치 추가](history/pr14/01-app-branch-add-form.png) | ![첫 배포](history/pr14/02-deploy-branch-instance.png) |
| **인스턴스 2개 (main, feature/search)** | **앱 목록** |
| ![인스턴스](history/pr14/03-app-instances.png) | ![앱 목록](history/pr14/04-apps-branches.png) |

---

## v15 · PR #15: 로고와 아이콘

머지 커밋 `256a441` · 11/4 00:35

헤더 왼쪽 위의 글자 "HopCharlie"를 가로형 로고로 바꾸고, 브라우저 탭, 홈 화면, 링크 미리보기 아이콘을 넣었습니다. 디자인 시스템 페이지에 로고 섹션을 더했습니다.

| 헤더 로고 | 디자인 시스템 |
| --- | --- |
| ![헤더 로고](history/pr15/01-overview-logo.png) | ![디자인 시스템](history/pr15/02-design-system.png) |

---

## v16 · PR #16: 모드 선택과 로그인

머지 커밋 `664e8be` · 11/4 11:35

처음 들어오면 **데모 모드**와 **일반 모드** 중 하나를 고릅니다. 일반 모드는 관리자 아이디와 비밀번호로 로그인하고(platform #48, ADR 0018), 토큰을 붙여 넣던 "API 연결"은 없앴습니다.

- 헤더에서 언제든 모드를 바꿀 수 있고, 바꿔도 로그아웃되지 않습니다.
- 일반 모드의 사이드 메뉴에 **CLI 연결**(`#device`)이 생겼습니다. `charlie login`이 보여 준 코드를 넣고, 역할을 골라 승인하거나 거절합니다.
- CLI 연결 화면은 플랫폼 없이 찍어서 코드 입력 칸까지만 보입니다.

| 모드 선택 | 관리자 로그인 |
| --- | --- |
| ![모드 선택](history/pr16/01-mode-select.png) | ![로그인](history/pr16/02-login.png) |
| **CLI 연결 (일반 모드)** | **데모 모드 (헤더의 일반 모드로 전환)** |
| ![CLI 연결](history/pr16/03-cli-device.png) | ![데모 모드](history/pr16/04-demo-overview.png) |

---

## v17 · PR #17: 대기 서버 설정 검사

머지 커밋 `04e6f01` · 11/4 14:42 · **실제 API만**

platform #47이 시작 전 용량 검사에 `standby_settings`를 더했습니다. 대상은 원본의 hot standby로 뜨므로 `max_connections`, `max_worker_processes`가 원본보다 작으면 시작이 막힙니다.

- 검사 이름 "대기 서버 설정"과 결과별 한국어 문장을 넣었습니다. 막히면 원본보다 작은 설정만, 통과면 비교한 설정과 비교하지 못한 설정, 이 검사가 보지 않는 설정 3개를 함께 보여 줍니다.
- 시뮬레이션은 이 검사를 만들지 않아서 시뮬레이션 화면은 v16과 같습니다.

---

## v18 · PR #18: 전환 후 관찰 시작 옵션

머지 커밋 `a4e1b1e` · 11/4 16:01 · **실제 API만**

승인 화면과 "다시 시작" 화면에 **전환 후 관찰**을 넣었습니다. CLI의 `migrate start --observe --auto-rollback`과 같은 일을 콘솔에서 합니다.

- 관찰 여부, 관찰 시간(1·2·5·10분, 20초마다 판정), 게이트를 어기면 바로 롤백(slo-guard)을 고릅니다. 게이트 기준은 플랫폼 기본값입니다.
- 카나리와 관찰은 게이트웨이(http) Plan에서만 보냅니다. 게이트웨이가 없는 Plan을 콘솔에서 시작하지 못하던 문제도 고쳤습니다.
- 데모 모드는 관찰을 흉내 내지 않아 옵션을 보여 주지 않습니다. 그래서 시뮬레이션 화면은 v17과 같습니다.

---

## v19 · PR #19: 샘플 앱 moimroom

머지 커밋 `5cb16f9` · 11/4 16:12

데모 모드의 이전 대상을 서비스 5개짜리 가짜 shop에서 팀 샘플 앱 **moimroom**의 구성으로 바꿨습니다.

- 서비스 `web` 하나(레플리카 2개), CNPG `moimroom-db`, 스키마 `app` 테이블 5개, 사진 버킷, 주소 `moimroom.hopcharlie.dev`를 따릅니다.
- AI 계획·리허설과 엔진 Plan이 moimroom 기준(namespace, 클러스터, 검증 스키마, 버킷)으로 바뀌었습니다.
- 이전 화면 주소는 `#migrate-app`이고, 예전 `#migrate-shop`도 열립니다.
- 기존 앱 가져오기 시안은 shop 줄거리 그대로이고, 가져온 기록에는 "가져오기 시안(shop)"이 붙습니다.

| 이전 설정 | 승인 화면 (moimroom 기준 AI 기록) |
| --- | --- |
| ![이전 설정](history/pr19/01-migrate-setup.png) | ![승인 화면](history/pr19/02-migrate-approve.png) |
| **moimroom 앱 상세** | |
| ![moimroom](history/pr19/03-app-moimroom.png) | |

---

## v20 · PR #20: 앱 시크릿과 빌드 없는 재배포

머지 커밋 `0b77dfc` · 11/4 16:36

platform #52(ADR 0019)의 앱 시크릿 API를 앱 상세에 연결했습니다. 시크릿을 바꾸면 이미지를 다시 빌드하지 않고 재배포해서 적용합니다.

- 앱 상세에 **시크릿** 섹션이 생겼습니다. 앱 공통 시크릿과, 고른 인스턴스가 받는 시크릿(앱 공통, 덮어씀, 이 인스턴스만)을 따로 보여 줍니다.
- 값은 **보기**를 누른 시크릿만 서버에서 불러오고, 다시 누르거나 60초가 지나거나 화면을 떠나면 지웁니다.
- 추가, 수정, 삭제, 덮어쓰기는 저장하지 않은 변경으로 모았다가 범위마다 **저장** 한 번으로 보냅니다.
- 저장한 뒤에는 실행 중인 인스턴스가 이전 값을 쓴다고 알리고 재배포 버튼을 보여 줍니다. 인스턴스 표에도 **재배포 (빌드 없이)** 버튼이 생겼고, 배포 이력의 트리거는 "재배포"로 나옵니다.
- 데모 모드는 todo-api의 가짜 시크릿으로 같은 흐름을 보여 줍니다. 아래 화면은 JWT_SECRET을 고치고 ADMIN_TOKEN 값을 본 뒤, 저장하고 재배포한 것입니다.

| 값 보기와 저장하지 않은 변경 | 저장 뒤 재배포 안내 |
| --- | --- |
| ![시크릿](history/pr20/01-app-secrets.png) | ![저장 뒤](history/pr20/02-app-secrets-saved.png) |
| **빌드 없는 재배포** | |
| ![재배포](history/pr20/03-redeploy.png) | |

---

## v21 · PR #21: 버전 히스토리 보강

머지 커밋 `ed8a8ba` · 11/4 16:40 · **화면 변화 없음**

이 문서와 README의 버전 표에 v8~v19를 더하고, 화면이 바뀐 버전의 스크린샷 18장을 넣었습니다. 앱 코드는 바뀌지 않았습니다.

---

## v22 · PR #22: 읽기 카나리 7단계

머지 커밋 `cba4d8f` · 11/4 16:56

읽기 카나리를 1%, 10%, 25%, 50%, 75%, 90%, 100%의 7단계(단계마다 10초)로 바꿨습니다. platform #53이 카나리 단계마다 판정(`verdict`)을 남기는 것에 맞춘 변경입니다.

- 요청이 모자라 판정을 미룬 단계(`inconclusive`)는 실패 대신 "판단 보류: 요청 부족, 다음 단계로"로 표시합니다. `verdict`가 없는 예전 run은 게이트 통과 여부로 판단합니다.
- 시뮬레이션은 1% 단계의 요청이 3건이라 판단 보류로 넘어가고, 나머지 단계는 통과합니다.
- 전환 후 관찰은 카나리 단계 길이와 떼어 그대로 20초마다 판정합니다.

| 읽기 카나리 진행 중 (1% 판단 보류, 50% 관찰 중) |
| --- |
| ![읽기 카나리](history/pr22/01-migrate-canary.png) |

---

## v23 · PR #24: 빠른 카나리 기본값

머지 커밋 `6c2229f` · 11/4 17:35

발표 시간에 맞춰 읽기 카나리의 기본값을 10%, 50%, 100%(단계마다 5초, 약 15초)로 줄였습니다. v22의 7단계는 점진 카나리로 남겨 두고 고를 수 있게 했습니다.

- 승인 화면의 시작 옵션에 "읽기 카나리" 선택칸(빠른 카나리, 점진 카나리)이 생겼습니다. 시작 옵션은 실제 API 모드에서만 보여서 데모 모드에는 이 선택칸이 없습니다.
- 승인 화면의 "실행 방식"과 이전 설정의 진행 순서 문구가 카나리 단계를 따라갑니다.
- 시뮬레이션은 빠른 카나리로 돕니다. 10% 단계는 요청이 15건이라 판단 보류로 넘어가고, 50%와 100%는 통과합니다.
- 플랫폼에는 카나리 기본값이 없어서, 이 기본값은 콘솔에서 시작한 이전에만 적용됩니다.

| 전환 승인 대기 (10% 판단 보류, 50%와 100% 통과) |
| --- |
| ![읽기 카나리](history/pr24/01-migrate-canary.png) |

---

## v24 · PR #25: self-hosted runner

머지 커밋 `9600fb1` · 11/4 21:18 · **화면 변화 없음**

GitHub-hosted runner 사용량이 Free 플랜 한도를 넘어 job이 시작되지 않아서, 콘솔 게시 workflow를 조직 self-hosted runner(infra ADR 0042)로 옮겼습니다. runner 호스트는 job 사이에 지워지지 않으므로 ECR 로그인을 `$RUNNER_TEMP` 아래에서 해서 자격 증명이 남지 않게 했습니다. 앱 코드는 바뀌지 않았습니다.

---

## v25 · PR #23: AI 계획 세션 표시

머지 커밋 `81cc4f3` · 11/4 21:46 · **실제 API만**

AI 실행기(ai-sandbox `hopai run`)의 계획 세션은 Plan을 제출하기 전에 열려서 planRef가 없습니다. 그래서 일반 모드의 이전 화면에는 계획하는 동안 아무것도 나오지 않았고, 제출한 뒤에는 계획 세션이 빠졌습니다.

- 계획하는 동안에는 최근 AI 세션을 3초마다 읽어, 그 앱의 진행 중인 계획 세션을 "AI 계획" 단계로 실시간 보여 줍니다. 계획이 Plan 없이 끝나면 이유와 "설정으로 돌아가기"를 보여 줍니다.
- 제출한 뒤에는 리허설 세션이 남긴 계획 세션 ID를 따라가, 계획 세션을 Plan의 AI 세션 목록에 붙입니다.
- 일반 모드의 "Plan 작성" 안내에 AI 없이 초안을 만든다는 것과 AI 실행기로 계획하는 방법을 적었습니다.
- 바뀐 부분은 모두 일반 모드에만 있어서 시뮬레이션 화면은 v24와 같습니다.

---

## v26 · PR #26: 콘솔 개편 1단계

머지 커밋 `d6fe763` · 11/5 10:20

화면 구조와 스타일을 바꾸는 콘솔 개편의 첫 단계입니다. API와 시뮬레이션은 그대로입니다.

- 위쪽 배너와 헤더 버튼을 없애고, 회색 세로 사이드 메뉴(개요, 작업, 결과, 인프라 묶음)와 얇은 위쪽 막대(지금 위치, 모드 안내, 계정)를 두었습니다. 900px보다 좁으면 메뉴가 가로로 바뀝니다.
- 데모 모드의 메뉴에 이전 진행 상태와 보안 높음 건수를 배지로 붙입니다. 일반 모드는 API 호출을 늘리지 않으려고 배지를 두지 않습니다.
- "새 앱 배포"와 "이전하기" 버튼은 개요와 이전 목록 머리로 옮겼습니다.
- 상태 칩을 테두리 없는 연한 바탕으로 바꾸고 색의 뜻을 정했습니다. 진행은 파랑, 사람을 기다림은 주황, 성공은 초록, 실패는 빨강, 중립은 회색입니다.
- 본문 글꼴을 SUIT로, 카드 모서리를 8px로 바꿨습니다.

| 개요 (묶음 사이드 메뉴, 보안 배지) | 전환 승인 대기 (메뉴의 주황 배지) |
| --- | --- |
| ![개요](history/pr26/01-overview.png) | ![전환 승인 대기](history/pr26/02-migrate-awaiting-switch.png) |

---

## v27 · PR #27: 콘솔 개편 2단계

머지 커밋 `87a8b65` · 11/5 10:27

개편의 나머지 화면입니다. 데모 모드와 일반 모드가 같은 화면을 쓰고, API와 시뮬레이션 데이터는 그대로입니다.

- **이전 화면:** 맨 위 상태 카드에 지금 상태, 다음 행동, 핵심 숫자 4개를 모았습니다. 진행 막대는 동기화, 읽기 카나리, 전환, 검증 네 칸이고, 전환 승인을 기다리면 그 칸이 주황입니다. 엔진 9단계는 네 묶음으로 보여 주고, 엔진 기록, 시작 전 검사, AI 기록, Plan은 탭으로 넣었습니다.
- **끝난 이전:** 리포트와 구간별 시간 막대(사람이 기다린 시간은 주황)가 상태 카드 바로 아래에 옵니다.
- **승인 화면:** AI 수정안(diff)과 "확인한 것" 목록을 먼저 보여 주고, 오른쪽 승인 카드에 시작 옵션과 승인 버튼을 둡니다.
- **앱 상세:** 개요, 인스턴스, 시크릿, 배포 이력 탭으로 나눴습니다(`#app-<이름>/instances`, `/secrets`, `/deploys`). 앱 삭제는 더 보기 메뉴로 옮기고, 시크릿 추가, 덮어쓰기 추가, 브랜치 추가 폼은 버튼을 눌렀을 때만 엽니다.
- **개요:** "지금 볼 것"에 사람을 기다리는 일, 문제, 진행 중인 일, 최근 24시간 안에 끝난 이전을 차례로 보여 주고, 경로별 결과를 3×3 격자로 바꿨습니다. 앱 표의 환경별 상태는 짧은 칩 3개와 범례로 바꿨습니다.
- 일반 모드에서 실패하거나 원복된 run이 네 칸 모두 완료로 보이던 문제와, 관찰 게이트 위반을 성공으로 보이던 문제를 고쳤습니다.

| 개요 (지금 볼 것, 경로 격자) | 전환 승인 대기 (상태 카드와 진행 막대) |
| --- | --- |
| ![개요](history/pr27/01-overview.png) | ![전환 승인 대기](history/pr27/02-migrate-awaiting-switch.png) |
| **이전 리포트 (상태 카드 바로 아래)** | **앱 상세의 시크릿 탭** |
| ![이전 리포트](history/pr27/03-migrate-report.png) | ![시크릿 탭](history/pr27/04-app-secrets-tab.png) |

---

## v28 · PR #28: 마감 다듬기

머지 커밋 `2aa3f54` · 11/5 12:04

개편 뒤의 마감입니다. 화면 구조와 동작, API와 시뮬레이션은 그대로입니다.

- 간격은 4px 단위로, 글자 크기는 7단계(12, 13, 14, 16, 18, 24, 32px)로, 굵기는 400, 500, 700으로 맞췄습니다. 숫자 열은 고정폭 숫자로 오른쪽 정렬하고, 고정폭 글꼴은 ID, 커밋, 시각에만 씁니다.
- 컨트롤 높이는 36px(터치 화면은 44px)로 맞추고, 비활성 버튼에는 이유를 적습니다.
- 불러오는 중에는 문장 대신 150ms 뒤에 나타나는 Skeleton을 보여 주고, 오류는 무엇을 못 불러왔는지와 다시 불러오기를 한 모양으로 보여 줍니다.
- 위쪽 막대와 본문을 같은 가운데 열에 맞춰, 넓은 화면에서 내용이 왼쪽 위에 붙지 않습니다.
- 끝난 이전에서는 상태 카드의 진행 막대를 숨기고, 결과가 없을 때 개요의 경로 격자는 한 줄 안내로 바꿨습니다. 앱 범례는 앱 목록 화면에만 둡니다.
- 화면 문구에서 줄표와 메타 정보의 가운뎃점을 없앴습니다.

| 개요 (2000px 너비, 처음 상태) | 이전 리포트 (진행 막대 없는 상태 카드) |
| --- | --- |
| ![넓은 화면](history/pr28/01-overview-wide.png) | ![이전 리포트](history/pr28/02-migrate-report.png) |

## v29 · PR #29: 광고 차단과 겹치는 클래스 이름

머지 커밋 `4e96956` · 11/5 12:09

광고 차단 확장을 켠 브라우저에서 앱 상세가 환경별 상태 칸만 보이던 문제를 고쳤습니다. 확장의 일반 규칙이 `ad-head`, `ad-tabs`처럼 `ad-`로 시작하는 클래스를 광고로 보고 숨겼기 때문입니다. 앱 상세의 클래스 접두사를 `appd-`로 바꿨고, 화면은 그대로입니다.

---

## 스크린샷을 다시 찍으려면

1. 버전마다 머지 커밋을 따로 꺼냅니다: `git worktree add --detach ../fe-history/pr2 0064c16`
2. `node_modules`는 v2 이후 의존성이 같아서 main의 것을 연결해 써도 됩니다(v1도 그대로 동작).
3. `npx vite ../fe-history/pr2 --port 5202`로 띄우고, 시뮬레이션 화면을 1440px 너비로 진행하면서 전체 페이지를 찍습니다.
4. v16부터는 처음에 모드 선택 화면이 나오므로 "데모 모드"를 고른 뒤 진행합니다. v19부터 이전 화면 주소는 `#migrate-app`입니다.
