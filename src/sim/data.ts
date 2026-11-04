// Demo fixtures. Everything here is fictional; the UI says so in the top banner.

export type EnvKey = "aws" | "gcp" | "onprem";

export interface Env {
  /** environment name in the platform API (Environment.name, PlanEndpoint.env) */
  id: string;
  name: string;
  short: string;
  region: string;
  nodes: number;
  k8s: string;
  storage: string;
  sc: string;
  bucket: string;
}

export const ENV: Record<EnvKey, Env> = {
  aws: { id: "eks", name: "AWS EKS", short: "EKS", region: "ap-northeast-2 (서울)", nodes: 3, k8s: "1.34", storage: "S3", sc: "gp3", bucket: "s3:moimroom-photos-eks" },
  gcp: { id: "gke", name: "GCP GKE", short: "GKE", region: "asia-northeast3 (서울)", nodes: 3, k8s: "1.34", storage: "GCS (S3 API)", sc: "standard-rwo", bucket: "gcs:moimroom-photos-gke" },
  onprem: { id: "k3s", name: "온프레미스 k3s", short: "k3s", region: "팀 서버 VM", nodes: 3, k8s: "1.34", storage: "MinIO", sc: "local-path", bucket: "minio:moimroom-photos-k3s" },
};
export const ENV_ORDER: EnvKey[] = ["aws", "gcp", "onprem"];

/** The six migration routes, in display order. */
export const ROUTES: [EnvKey, EnvKey][] = ENV_ORDER.flatMap((s) => ENV_ORDER.filter((t) => t !== s).map((t): [EnvKey, EnvKey] => [s, t]));
export const routeKey = (s: EnvKey, t: EnvKey) => s + ">" + t;
/** Platform environment name (eks, gke, k3s) → EnvKey, for data from the API. */
export function envKeyOf(name: string): EnvKey | undefined {
  return ENV_ORDER.find((k) => ENV[k].id === name || k === name);
}

// The migration sample app, moimroom (2026-Softbank-Hackathon-Charlie/moimroom): its shape follows the repo.
// platform.yaml has one service `web` (port 8080, /healthz, public) with a postgres `db` and an s3 `photos`;
// the Helm chart runs 2 replicas; deploy/cnpg/cluster.yaml names the cluster moimroom-db; internal/store/schema.sql
// creates 5 tables in schema `app`. The domain follows the platform's https://<app>.<PLATFORM_APP_DOMAIN>.
// MOCK: 버킷 이름, 파일 수, DB 크기는 시뮬레이션 수치다. 실제 값은 일반 모드에서 플랫폼이 준다.
export const SAMPLE = {
  id: "moimroom",
  repo: "2026-Softbank-Hackathon-Charlie/moimroom",
  services: ["web"],
  replicas: 2,
  domain: "moimroom.hopcharlie.dev",
  namespace: "moimroom",
  db: "moimroom-db",
  schema: "app",
  bucket: "moimroom-photos",
  files: 1284,
  dbSize: "2.1 GiB",
  tables: 5,
};

/** [at seconds, message] */
export type LogEntry = [number, string];

/** k6 successful writes per simulated second */
export const RATE = 20;
export const FILE_RATE = 0.5;

/** Simulated seconds after a deployment is created when each environment reports Synced, Healthy. */
export const DEP_READY: Record<EnvKey, number> = { gcp: 141, onprem: 150, aws: 161 };

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
