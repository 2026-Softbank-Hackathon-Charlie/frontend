# 이전 실행 보안 비교

이전 결과의 `실행 상세`에서 전환 판단 다음에 보안 비교 카드를 보여준다. 데이터 이전 결과와 통제 판정을 각각 읽을 수 있게 한다.

데모 모드의 **moimroom-mig 보안 비교 예시**에서 AWS EKS → GCP GKE 예시 실행을 연다. 동일한 `moimroom-mig` 네임스페이스와 `Deployment/moimroom-mig-web`을 `HC-POL-02`로 비교한다. 원본의 이전 직전 판정과 대상 워크로드가 시작된 뒤 쓰기 전환 직전의 판정을 고정한 예시다.

| 예시 | 이전 전 · AWS EKS | 전환 직전 · GCP GKE | 카드에서 강조하는 내용 |
| --- | --- | --- | --- |
| 통과 → 실패 | 조회한 컨테이너에서 특권 설정을 찾지 않음 | `web`의 `securityContext.privileged: true`를 확인 | 새 위반과 설정을 확인할 위치 |
| 통과 → 미확인 | 같은 원본 평가 | Pod 조회 권한이 없어 증거를 수집하지 못함 | 확인 필요와 조회 권한 확인 후 재평가 |

카드는 통제 ID, 정책 버전, 워크로드, 판정 이유와 평가 또는 시도 시각을 함께 표시한다. 색상과 상태 문구로 두 결과를 구분하고, 좁은 화면에서는 두 환경을 세로로 배치한다. `HC-POL-02`는 [Kubernetes PSS Baseline의 Privileged Containers 조건](https://kubernetes.io/docs/concepts/security/pod-security-standards/#baseline)을 근거로 한다.

예시 실행과 판정은 합성 데이터다. 예시 진입은 데모 결과 화면에서만 제공한다. 실제 연동 시에는 이전 실행 ID에 두 평가 스냅샷을 연결하고 각 환경의 워크로드 대응을 확인한다. 같은 통제와 정책 버전의 결과를 비교하며, 근거가 없거나 비교 조건이 맞지 않으면 미확인으로 남긴다. 이번 카드에서는 시나리오 선택으로 표시만 바뀐다.

1. 데모의 예시 실행을 열어 `통과 → 실패`의 위반 근거와 `통과 → 미확인`의 조회 실패 근거를 확인한다.
2. 같은 ID를 가진 일반 모드 실행에서 예시 카드와 예시 진입 버튼이 숨겨지는지 확인한다.
3. 동일 예시 실행과 화면 크기로 Before, After 실패, After 미확인을 캡처한다. Before는 예시를 기존 실행 상세 레이아웃에 렌더링한 화면이다.

[Before](screenshots/migration-security-comparison/before.jpg) · [After 통과 → 실패](screenshots/migration-security-comparison/after-fail.jpg) · [After 통과 → 미확인](screenshots/migration-security-comparison/after-unknown.jpg)
