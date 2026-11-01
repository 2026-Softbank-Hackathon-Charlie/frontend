// Demo fixtures. Everything here is fictional; the UI says so in the top banner.

export type EnvKey = "aws" | "gcp" | "onprem";

export interface Env {
  name: string;
  region: string;
  nodes: number;
  k8s: string;
  storage: string;
  sc: string;
}

export const ENV: Record<EnvKey, Env> = {
  aws: { name: "AWS EKS", region: "ap-northeast-2 (서울)", nodes: 3, k8s: "1.34", storage: "S3", sc: "gp3 (EBS CSI)" },
  gcp: { name: "GCP GKE", region: "asia-northeast3 (서울)", nodes: 3, k8s: "1.34", storage: "GCS (S3 호환 모드)", sc: "standard-rwo" },
  onprem: { name: "온프레미스 k3s", region: "팀 서버 1대", nodes: 1, k8s: "1.34", storage: "MinIO", sc: "local-path" },
};
export const ENV_ORDER: EnvKey[] = ["aws", "gcp", "onprem"];

export interface Repo {
  label: string;
  ok: boolean;
  commit?: string;
  lang?: string;
  yaml?: string;
}

export const REPOS: Record<string, Repo> = {
  "todo-api": { label: "team-charlie/todo-api", ok: true },
  "notice-board": {
    label: "team-charlie/notice-board",
    ok: true,
    commit: "3f9c1a0",
    lang: "Node.js 22, 멀티 스테이지 빌드",
    yaml: "name: notice-board\nservices:\n  - name: web\n    path: .\n    port: 3000\n    healthCheck: /healthz\n    public: true\nresources:\n  - name: main-db\n    type: postgres",
  },
  "analytics-worker": { label: "team-charlie/analytics-worker", ok: false },
};

/** [at seconds, message] */
export type LogEntry = [number, string];
/** [label, detail, start, end] — end null means "until deploy end" */
export type Stage = [string, string, number, number | null];

export const RATE = 20;
export const FILE_RATE = 0.5;

export const DEP_STAGES: Stage[] = [
  ["코드 받기", "main, 3f9c1a0", 0, 2],
  ["DB와 버킷 생성", "빌드와 동시에 진행", 2, 38],
  ["이미지 빌드", "BuildKit, 대기열 1/3", 2, 52],
  ["이미지 업로드", "Zot, notice-board:3f9c1a0", 52, 55],
  ["배포", "Argo CD 동기화, 선택한 환경에 동시 배포", 55, null],
];
export const DEP_READY: Record<EnvKey, number> = { gcp: 141, onprem: 150, aws: 161 };
export const DEP_LOG: LogEntry[] = [
  [0, "push 이벤트 수신 (main, 3f9c1a0)"],
  [2, "빌드 시작 (대기열 1/3), DB와 버킷 생성 시작"],
  [2, "#1 [internal] load build definition from Dockerfile"],
  [3, "#2 [internal] load metadata for docker.io/library/node:22-alpine"],
  [5, "#4 [deps 1/2] COPY package.json package-lock.json ./"],
  [6, "#5 [deps 2/2] RUN --mount=type=cache,target=/root/.npm npm ci"],
  [31, "#5 added 412 packages in 24s"],
  [33, "#6 [build 1/1] RUN npm run build"],
  [38, "DB와 버킷 생성 완료"],
  [47, "#7 [runtime 1/2] COPY --from=build /app/dist ./dist"],
  [50, "#8 exporting to image"],
  [52, "#9 pushing zot.charlie.example/notice-board:3f9c1a0"],
  [55, "배포 설정 커밋, Argo CD 동기화 요청"],
];

export type OnbStep = 1 | 2 | 3 | 4;
export const ONB_LOG: Record<2 | 3 | 4, LogEntry[]> = {
  2: [
    [0, "AI 에이전트 컨테이너 생성 (권한: 클라우드 읽기 전용)"],
    [3, "aws ec2 describe-instances: shop-app-1 (t3.medium) 1대"],
    [6, "aws rds describe-db-instances: shop-db (PostgreSQL 16) 1개"],
    [9, "aws s3api list-buckets: shop-files (파일 1,284개)"],
    [14, "레포 분석: Java 17, Gradle, Spring Boot, 포트 8080"],
    [20, "발견: Dockerfile 없음"],
    [24, "발견: RDS 주소가 application.yml에 직접 적혀 있음"],
    [28, "발견: S3 주소가 코드 3곳에 직접 적혀 있음"],
    [32, "발견: 상품 이미지의 전체 URL을 DB에 저장"],
    [36, "확인: 기본 키가 없는 테이블 0개"],
    [40, "확인: 클라우드 전용 서비스 사용 안 함"],
    [44, "점검 리포트 작성 완료: 고칠 항목 4개"],
  ],
  3: [
    [0, "브랜치 onboard/platform 생성"],
    [6, "Dockerfile, platform.yaml 추가"],
    [12, "application.yml: DB 주소를 DATABASE_URL로 변경"],
    [18, "S3 주소 3곳을 S3_ENDPOINT로 변경, 전체 URL 대신 파일 키 저장"],
    [24, "샌드박스 네임스페이스 sandbox-shop-7f3a 생성"],
    [30, "브랜치 빌드 shop:c07e4b8"],
    [52, "1차 테스트 실패: /healthz 응답 404"],
    [55, "차단됨: kubectl get secrets -n shop-prod"],
    [63, "헬스 체크 경로 /healthz 추가"],
    [68, "차단됨: 기존 RDS 직접 접속"],
    [72, "다시 빌드 shop:9d2b71f"],
    [96, "2차 테스트 통과: 스모크 테스트 12/12"],
    [98, "PR #14 생성, 샌드박스 네임스페이스 삭제"],
  ],
  4: [
    [0, "운영자 승인 확인 (GitHub 리뷰)"],
    [1, "AI가 PR #14 머지"],
    [2, "main 빌드 시작 (대기열 1/3)"],
    [74, "이미지 빌드 완료 shop:9d2b71f"],
    [75, "shop 등록 완료"],
  ],
};
export const ONB_END: Record<2 | 3 | 4, number> = { 2: 44, 3: 98, 4: 75 };

/** [at, area, finding, chip class, action] */
export const FINDINGS: [number, string, string, "run" | "ok", string][] = [
  [20, "실행 방법", "Dockerfile 없음 (Java 17, Gradle, 포트 8080)", "run", "Dockerfile 작성"],
  [24, "설정", "RDS 주소가 application.yml에 직접 적혀 있음", "run", "환경 변수로 변경"],
  [28, "파일 저장소", "S3 주소가 코드 3곳에 직접 적혀 있음", "run", "S3_ENDPOINT로 변경"],
  [32, "파일 저장소", "상품 이미지의 전체 URL을 DB에 저장", "run", "파일 키만 저장"],
  [36, "DB", "기본 키가 없는 테이블 0개", "ok", "문제 없음"],
  [40, "클라우드 전용 서비스", "SQS, DynamoDB 사용 안 함", "ok", "문제 없음"],
];

export const PREP_END = 151;
export const SW_END = 13.6;
export const CL_END = 67;
export const SW_FLIP = 6.8;
export const SW_HOLD_START = 1.2;
export const SW_CATCHUP = 4.5;

export function prepItems(target: EnvKey): [string, string, number, number][] {
  const t = ENV[target];
  return [
    ["네임스페이스와 비밀값 생성", "shop", 0, 6],
    ["버킷 생성", t.storage, 6, 12],
    ["DB 생성", "CloudNativePG 클러스터 1개", 6, 40],
    ["앱 배포", "shop:9d2b71f, Pod 2개, 이미 빌드된 이미지 사용", 12, 52],
    ["S3 파일 복사", "rclone, 이후 몇 초마다 바뀐 파일만 복사", 40, 118],
    ["DB 스키마 복사, 논리 복제 시작", "RDS를 구독", 52, 70],
    ["DB 기존 데이터 복사", "초기 복사", 70, 110],
    ["동기화 확인", "복제 지연 2초 이내, S3 복사 최신", 118, 151],
  ];
}

export function prepLog(target: EnvKey): LogEntry[] {
  const t = ENV[target];
  return [
    [0, "이전 시작: 기존 AWS(EC2)에서 " + t.name + "로"],
    [6, "네임스페이스 shop과 비밀값 생성"],
    [12, "버킷 생성 (" + t.storage + ")"],
    [40, "DB 생성 완료 (CloudNativePG), S3 파일 복사 시작"],
    [52, "앱 배포 완료, 사용자 요청은 아직 보내지 않음"],
    [70, "DB 스키마 복사, RDS 구독 시작"],
    [110, "DB 기존 데이터 복사 완료"],
    [118, "S3 파일 1,284개 복사 완료"],
    [151, "준비 완료: 복제 지연 0.4초"],
  ];
}

export const SW_ITEMS: [string, number][] = [
  ["사전 확인", 1.2],
  ["처리 중인 쓰기 마무리", 0.4],
  ["기존 DB 쓰기 권한 회수", 0.3],
  ["마지막 변경 반영, 시퀀스 맞춤", 2.6],
  ["S3 마지막 복사 (파일 3개)", 2.1],
  ["게이트웨이 전환", 0.2],
  ["새 환경 응답 확인", 6.8],
];
export const SW_LOG: LogEntry[] = [
  [0, "전환 시작"],
  [1.2, "사전 확인 통과, 쓰기 요청 보류 시작"],
  [1.6, "처리 중인 쓰기 요청 마무리"],
  [1.9, "기존 DB 앱 계정의 쓰기 권한 회수"],
  [4.5, "마지막 변경 반영, 시퀀스 맞춤 완료"],
  [6.6, "S3 마지막 복사 3개"],
  [6.8, "게이트웨이 전환, 보류한 쓰기 112건 전달"],
  [13.6, "전환 완료 13.6초, 실패 0건"],
];
export const CL_ITEMS: [string, string, number, number][] = [
  ["원본으로 가는 요청 0건 확인", "30초 관찰", 0, 30],
  ["원본 EC2 중지", "중지 전용 권한 사용", 30, 36],
  ["원본 차단 테스트", "사설망 경로를 끊고 스모크 테스트", 36, 53],
  ["기존 RDS와 S3 접근 차단", "삭제는 운영자 확인 후", 53, 57],
  ["이전 리포트 생성", "", 57, 67],
];
export const CL_LOG: LogEntry[] = [
  [0, "정리 시작"],
  [30, "원본으로 가는 요청 0건 확인"],
  [36, "원본 EC2 중지 (중지 전용 권한)"],
  [53, "사설망 경로 해제 후 스모크 테스트 12/12 통과"],
  [57, "기존 RDS와 S3 접근 차단"],
  [67, "이전 리포트 생성, 이전 완료"],
];
