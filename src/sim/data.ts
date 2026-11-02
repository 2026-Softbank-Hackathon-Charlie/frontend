// Demo fixtures. Everything here is fictional; the UI says so in the top banner.

export type EnvKey = "aws" | "gcp" | "onprem";

export interface Env {
  name: string;
  short: string;
  region: string;
  nodes: number;
  k8s: string;
  storage: string;
  sc: string;
}

export const ENV: Record<EnvKey, Env> = {
  aws: { name: "AWS EKS", short: "EKS", region: "ap-northeast-2 (서울)", nodes: 3, k8s: "1.34", storage: "S3", sc: "gp3" },
  gcp: { name: "GCP GKE", short: "GKE", region: "asia-northeast3 (서울)", nodes: 3, k8s: "1.34", storage: "GCS (S3 API)", sc: "standard-rwo" },
  onprem: { name: "온프레미스 k3s", short: "k3s", region: "팀 서버 VM", nodes: 3, k8s: "1.34", storage: "MinIO", sc: "local-path" },
};
export const ENV_ORDER: EnvKey[] = ["aws", "gcp", "onprem"];

/** The six migration routes, in display order. */
export const ROUTES: [EnvKey, EnvKey][] = ENV_ORDER.flatMap((s) => ENV_ORDER.filter((t) => t !== s).map((t): [EnvKey, EnvKey] => [s, t]));
export const routeKey = (s: EnvKey, t: EnvKey) => s + ">" + t;

// MOCK: 샘플 앱은 서현님이 만드는 MSA 앱으로 교체한다. 서비스 이름과 수치는 자리표시.
export const SAMPLE = {
  id: "shop",
  repo: "team-charlie/sample-shop",
  services: ["web", "api-gateway", "order", "product", "user"],
  db: "shop-db",
  bucket: "shop-files",
  files: 1284,
  dbSize: "2.1 GiB",
  tables: 38,
};

// 3장 2번(DB 이전 방식)이 정해지기 전까지 화면에는 방식 이름을 쓰지 않는다.
export const DB_METHOD = "복제 방식 미정 (CNPG replica 또는 논리 복제)";

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

/** k6 successful writes per simulated second */
export const RATE = 20;
export const FILE_RATE = 0.5;

export const DEP_STAGES: Stage[] = [
  ["코드 받기", "main, 3f9c1a0", 0, 2],
  ["DB와 버킷 생성", "빌드와 동시에 진행", 2, 38],
  ["이미지 빌드", "BuildKit, 대기열 1/3", 2, 52],
  ["이미지 업로드", "ECR, notice-board:3f9c1a0", 52, 55],
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
  [52, "#9 pushing <계정>.dkr.ecr.ap-northeast-2.amazonaws.com/notice-board:3f9c1a0"],
  [55, "배포 설정 커밋, Argo CD 동기화 요청"],
];

/* ---------- onboarding: bring an app running outside the platform onto a cluster ---------- */
// 3장 7번(AI 범위) 결정 전 시안. 결정에 따라 빠질 수 있다.

export type OnbStep = 1 | 2 | 3 | 4;
export const ONB_LOG: Record<2 | 3, LogEntry[]> = {
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
    [6, "Dockerfile, Helm values 추가"],
    [12, "application.yml: DB 주소를 DATABASE_URL로 변경"],
    [18, "S3 주소 3곳을 S3_ENDPOINT로 변경, 전체 URL 대신 파일 키 저장"],
    [24, "샌드박스 네임스페이스 sandbox-shop-7f3a 생성"],
    [30, "브랜치 빌드 shop:c07e4b8"],
    [52, "1차 테스트 실패: /healthz 응답 404"],
    [55, "차단됨: kubectl get secrets -n shop (RBAC)"],
    [63, "헬스 체크 경로 /healthz 추가"],
    [68, "차단됨: 기존 RDS 직접 접속 (NetworkPolicy)"],
    [72, "다시 빌드 shop:9d2b71f"],
    [96, "2차 테스트 통과: 스모크 테스트 12/12"],
    [98, "PR #14 생성, 샌드박스 네임스페이스 삭제"],
  ],
};
export function onbFinishLog(env: EnvKey): LogEntry[] {
  const e = ENV[env];
  return [
    [0, "운영자 승인 확인 (GitHub 리뷰)"],
    [1, "플랫폼이 PR #14 머지"],
    [2, "main 빌드 시작 (대기열 1/3)"],
    [40, "이미지 빌드 완료, ECR에 shop:9d2b71f 푸시"],
    [44, "Argo CD로 " + e.name + "에 배포, CloudNativePG와 버킷 생성"],
    [60, "기존 RDS·S3 데이터 첫 복사 (pg_dump/restore, rclone)"],
    [72, "게이트웨이 연결: " + e.name + " 100%"],
    [75, "shop 등록 완료"],
  ];
}
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

/* ---------- migration: AI plan → rehearsal → approval → engine ---------- */

export const PLAN_END = 24;
export const REH_END = 70;
export const PREP_END = 100;
export const SW_END = 13.6;
export const CL_END = 40;
export const SW_FLIP = 6.8;
export const SW_HOLD_START = 1.2;
export const SW_CATCHUP = 4.5;
export const HOLD_MAX = 30;
/** Whole-run target the topic commits to. */
export const TARGET_SEC = 180;

export function planLog(src: EnvKey, tgt: EnvKey): LogEntry[] {
  const s = ENV[src];
  const t = ENV[tgt];
  return [
    [0, "AI 계획 시작 (도구: 읽기 전용 조회만 허용)"],
    [2, "원본 " + s.name + " 조회: Deployment " + SAMPLE.services.length + "개, CNPG 클러스터 1개, 버킷 1개"],
    [5, "DB " + SAMPLE.db + ": " + SAMPLE.dbSize + ", 테이블 " + SAMPLE.tables + "개, 기본 키 없는 테이블 0개"],
    [8, "버킷 " + SAMPLE.bucket + ": 객체 " + SAMPLE.files.toLocaleString("ko-KR") + "개 (S3 API)"],
    [11, "대상 " + t.name + " 조회: StorageClass " + t.sc + ", 노드 여유 CPU 6, 메모리 18 GiB"],
    [15, "Plan 초안 생성 (단계 6개)"],
    [16, "스키마 검증 실패: steps[2].timeoutSec 값 없음, 오류를 넣어 다시 요청"],
    [21, "Plan 다시 생성, 스키마 검증 통과"],
    [24, "고정 검사 통과: 쓰기 주체 1곳, 원본 삭제는 사람 승인 필요"],
  ];
}

/** [at, rule, ok] — what the platform checks on the AI's Plan before anything runs */
export function planChecks(): [number, string, boolean][] {
  return [
    [16, "JSON 스키마 (1차)", false],
    [21, "JSON 스키마 (2차)", true],
    [24, "쓰기 주체는 한 곳", true],
    [24, "전환 단계에 타임아웃 있음 (최대 30초)", true],
    [24, "원본 삭제는 사람 승인 단계 뒤", true],
  ];
}

export function planJson(src: EnvKey, tgt: EnvKey): string {
  return [
    "{",
    '  "app": "' + SAMPLE.id + '",',
    '  "from": "' + src + '", "to": "' + tgt + '",',
    '  "profile": "values-' + tgt + '.yaml",',
    '  "steps": [',
    '    { "id": "precopy",  "db": "initial-copy", "files": "rclone sync" },',
    '    { "id": "sync",     "until": { "dbLagSec": 1, "filesBehind": 0 } },',
    '    { "id": "fence",    "holdWrites": true, "timeoutSec": 30 },',
    '    { "id": "verify",   "rows": "pk-compare", "files": "rclone check" },',
    '    { "id": "cutover",  "gateway": { "' + tgt + '": 100 } },',
    '    { "id": "cleanup",  "source": "scale-to-zero", "delete": "needs-approval" }',
    "  ],",
    '  "rollback": "auto-until-target-accepts-writes"',
    "}",
  ].join("\n");
}

export function rehLog(src: EnvKey, tgt: EnvKey): LogEntry[] {
  const t = ENV[tgt];
  const s = ENV[src];
  return [
    [0, "샌드박스 sandbox-shop-7f3a 생성 (" + t.name + ", 토큰 1시간)"],
    [3, "ResourceQuota, NetworkPolicy 적용"],
    [6, "임시 PostgreSQL, 임시 MinIO 준비 (테스트 데이터 10,000건)"],
    [10, "1차 리허설: Plan 6단계를 테스트 데이터로 실행"],
    [22, "차단됨: kubectl get secrets -n shop (RBAC)"],
    [28, "1차 실패: 대상 DB의 PVC가 Pending (StorageClass " + s.sc + " 없음)"],
    [32, "AI 진단: values에 원본 프로필의 StorageClass가 남아 있음"],
    [36, "AI 수정안: values-" + tgt + ".yaml storageClass " + s.sc + " → " + t.sc],
    [38, "차단됨: curl 169.254.169.254 (NetworkPolicy)"],
    [42, "2차 리허설 시작 (수정안 적용)"],
    [64, "2차 통과: 데이터 10,000/10,000 일치, 스모크 12/12, 원본 차단 테스트 통과"],
    [70, "샌드박스 삭제, 승인 대기"],
  ];
}

export const SANDBOX = {
  ns: "sandbox-shop-7f3a",
  quota: "CPU 4, 메모리 8 GiB, Pod 20개",
  net: "같은 네임스페이스와 DNS만 허용 (운영망, Tailscale 대역, 169.254.169.254 차단)",
  data: "임시 PostgreSQL, 임시 MinIO, 외부 호출은 mock 서버",
  ttl: "최대 1시간 뒤 자동 삭제",
};

/** [at, command, guard] */
export const BLOCKED: [number, string, string][] = [
  [22, "kubectl get secrets -n shop", "다른 네임스페이스 접근 권한 없음 (RBAC)"],
  [38, "curl http://169.254.169.254/latest/meta-data/", "메타데이터 주소로 나가는 통신 차단 (NetworkPolicy)"],
];

/** HopCharlie migration order. [label, detail, phase, start, end] within that phase's clock. */
export type Step = [string, string, "prep" | "switch" | "cleanup", number, number];
export const STEPS: Step[] = [
  ["미리 복사", "Argo CD 배포, DB 초기 복사, 파일 초기 복사", "prep", 0, 50],
  ["변경분 동기화", "DB 복제 지연 1초 이내, 파일 증분", "prep", 50, PREP_END],
  ["쓰기 경계", "쓰기 요청 보류, 원본 쓰기 권한 회수", "switch", 0, 1.9],
  ["최종 반영 확인", "마지막 변경, 시퀀스, 행 수와 파일 해시", "switch", 1.9, 6.6],
  ["전환", "게이트웨이 100%, 보류한 쓰기 전달", "switch", 6.6, SW_END],
  ["원본 정리", "원본 요청 0건, 원본 차단 테스트, 축소", "cleanup", 0, CL_END],
];

export function prepItems(src: EnvKey, tgt: EnvKey): [string, string, number, number][] {
  const t = ENV[tgt];
  return [
    ["대상 네임스페이스와 비밀값", "shop, " + t.name, 0, 5],
    ["Argo CD 동기화", "공통 Helm chart + values-" + tgt + ", 이미지는 ECR", 5, 35],
    ["DB 생성", "CloudNativePG 1개, StorageClass " + t.sc, 5, 20],
    ["DB 초기 복사", DB_METHOD, 20, 50],
    ["파일 초기 복사", "rclone sync, " + ENV[src].storage + " → " + t.storage, 15, 70],
    ["변경분 동기화", "DB 복제 지연 1초 이내, rclone 증분 5초마다", 50, PREP_END],
  ];
}

export function prepLog(src: EnvKey, tgt: EnvKey): LogEntry[] {
  const s = ENV[src];
  const t = ENV[tgt];
  return [
    [0, "승인된 Plan 실행: " + s.name + " → " + t.name],
    [5, "네임스페이스 shop과 비밀값 생성"],
    [15, "파일 초기 복사 시작 (rclone)"],
    [20, "DB 생성 완료, 초기 복사 시작"],
    [35, "Argo CD 동기화 완료, Pod 준비 (사용자 요청은 아직 보내지 않음)"],
    [50, "DB 초기 복사 완료, 변경분 동기화 시작"],
    [70, "파일 " + SAMPLE.files.toLocaleString("ko-KR") + "개 복사 완료, 증분 동기화로 전환"],
    [100, "동기화 확인: 복제 지연 0.4초, 파일 최신"],
  ];
}

export const SW_ITEMS: [string, number][] = [
  ["사전 확인", 1.2],
  ["처리 중인 쓰기 마무리", 0.4],
  ["원본 DB 쓰기 권한 회수", 0.3],
  ["마지막 변경 반영, 시퀀스 맞춤", 2.6],
  ["파일 마지막 복사 (3개)", 2.1],
  ["게이트웨이 전환", 0.2],
  ["새 환경 응답 확인", 6.8],
];
export const SW_LOG: LogEntry[] = [
  [0, "쓰기 경계 시작"],
  [1.2, "사전 확인 통과, 쓰기 요청 보류 시작"],
  [1.6, "처리 중인 쓰기 요청 마무리"],
  [1.9, "원본 DB 앱 계정의 쓰기 권한 회수 (이 시점부터 원복은 원본으로 즉시 가능)"],
  [4.5, "마지막 변경 반영, 시퀀스 맞춤 완료"],
  [6.6, "파일 마지막 복사 3개, 행 수와 해시 일치"],
  [6.8, "게이트웨이 전환, 보류한 쓰기 112건 전달 (대상이 쓰기를 받기 시작)"],
  [13.6, "전환 완료 13.6초, 실패 0건"],
];
export const CL_ITEMS: [string, string, number, number][] = [
  ["원본으로 가는 요청 0건 확인", "20초 관찰", 0, 20],
  ["원본 차단 테스트", "Tailscale 경로를 끊고 스모크 테스트", 20, 32],
  ["원본 축소", "Deployment 0개, DB와 버킷은 읽기 전용으로 보존", 32, 36],
  ["이전 리포트 생성", "", 36, CL_END],
];
export const CL_LOG: LogEntry[] = [
  [0, "원본 정리 시작"],
  [20, "원본으로 가는 요청 0건 확인"],
  [32, "Tailscale 경로 해제 후 스모크 테스트 12/12 통과"],
  [36, "원본 Deployment 0개로 축소, DB와 버킷은 읽기 전용"],
  [40, "이전 리포트 생성, 이전 완료"],
];
