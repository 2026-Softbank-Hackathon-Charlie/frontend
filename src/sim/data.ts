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
}

export const ENV: Record<EnvKey, Env> = {
  aws: { id: "eks", name: "AWS EKS", short: "EKS", region: "ap-northeast-2 (서울)", nodes: 3, k8s: "1.34", storage: "S3", sc: "gp3" },
  gcp: { id: "gke", name: "GCP GKE", short: "GKE", region: "asia-northeast3 (서울)", nodes: 3, k8s: "1.34", storage: "GCS (S3 API)", sc: "standard-rwo" },
  onprem: { id: "k3s", name: "온프레미스 k3s", short: "k3s", region: "팀 서버 VM", nodes: 3, k8s: "1.34", storage: "MinIO", sc: "local-path" },
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
// MOCK: 파일 수와 DB 크기는 시뮬레이션 수치다. 실제 값은 일반 모드에서 플랫폼이 준다.
export const SAMPLE = {
  id: "moimroom",
  repo: "2026-Softbank-Hackathon-Charlie/moimroom",
  services: ["web"],
  replicas: 2,
  domain: "moimroom.hopcharlie.dev",
  namespace: "moimroom",
  db: "moimroom-db",
  schema: "app",
  files: 1284,
  dbSize: "2.1 GiB",
  tables: 5,
};

// The demo's app without a database or files, after docker-doom (a static web game in one container): it migrates with
// the gateway route only, without the AI plan, the rehearsal, the database pair or a bucket (platform ADR 0018).
export const STATELESS_SAMPLE = {
  id: "docker-doom",
  namespace: "docker-doom",
};

// The platform names an app's bucket <bucketPrefix><instance> (platform ADR 0016), and eks's prefix is hopcharlie-eks-.
// MOCK: gke와 k3s는 플랫폼이 아직 접두어를 정하지 않아 eks와 같은 모양으로 지어 둔 이름이다.
const BUCKET_REMOTE: Record<EnvKey, string> = { aws: "s3:hopcharlie-eks-", gcp: "gcs:hopcharlie-gke-", onprem: "minio:hopcharlie-k3s-" };
/** The sample app's bucket on an environment as an rclone remote path, e.g. s3:hopcharlie-eks-moimroom. */
export const sampleBucket = (k: EnvKey) => BUCKET_REMOTE[k] + SAMPLE.id;
/** The bucket's own name, without the remote: what the console shows. */
export const sampleBucketName = (k: EnvKey) => sampleBucket(k).split(":")[1];

/** [at seconds, message] */
export type LogEntry = [number, string];

/** k6 successful writes per simulated second */
export const RATE = 20;
export const FILE_RATE = 0.5;

/** Simulated seconds after a deployment is created when each environment reports Synced, Healthy. */
export const DEP_READY: Record<EnvKey, number> = { gcp: 141, onprem: 150, aws: 161 };
