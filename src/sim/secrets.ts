// App secrets (ADR 0019) in the contract's shapes (AppSecrets, AppSecretValue)
// and the server's rules for names and values, which the console checks
// before it sends a change. The demo's values are fake and live only in this
// tab's memory, like the rest of the simulation.
import type { AppSecretInfo, AppSecrets, AppSecretsUpdate, AppSecretValue } from "../api/types";
import type { DeploySim, Refusal } from "./deploy";
import { iso } from "./mig";

export const MAX_SECRET_NAME = 64;
/** Bytes of UTF-8. */
export const MAX_SECRET_VALUE = 4096;
/** App-wide secrets per app, and overrides per instance. */
export const MAX_SECRETS = 50;

/** Names the platform sets itself (appspec.Reserved). */
export const reservedSecretName = (n: string) => n === "PORT" || n === "DATABASE_URL" || n.startsWith("S3_");

/** Why the server would refuse `name`, in Korean; "" when it is fine. */
export function secretNameError(name: string): string {
  if (!name) return "이름을 입력하세요";
  if (name.length > MAX_SECRET_NAME) return "이름은 " + MAX_SECRET_NAME + "자까지입니다";
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return "이름은 영문 대문자, 숫자, _만 쓰고 숫자로 시작할 수 없습니다";
  if (reservedSecretName(name)) return "PORT, DATABASE_URL, S3_로 시작하는 이름은 플랫폼이 넣는 값이라 쓸 수 없습니다";
  return "";
}

/** Why the server would refuse `value` (1 to MAX_SECRET_VALUE bytes), in Korean; "" when it is fine. */
export function secretValueError(value: string): string {
  if (!value) return "값을 입력하세요";
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > MAX_SECRET_VALUE) return "값은 " + MAX_SECRET_VALUE + "바이트까지입니다 (지금 " + bytes + "바이트)";
  return "";
}

interface Stored {
  value: string;
  updatedAt: string;
  updatedBy: string;
}

/** app, then instance ("" for the app-wide secrets), then name. */
export type SecretsSim = Record<string, Record<string, Record<string, Stored>>>;

// MOCK: 데모용 가짜 값. 실제 값은 플랫폼이 암호화해 보관하고 눈 버튼을 누를 때만 내려 준다.
export function freshSecrets(): SecretsSim {
  const s = (value: string): Stored => ({ value, updatedAt: iso(-3_600), updatedBy: "operator" });
  return { "todo-api": { "": { ADMIN_TOKEN: s("demo-admin-token-not-real"), JWT_SECRET: s("demo-jwt-secret-not-real") } } };
}

const byName = (m: Record<string, Stored>): AppSecretInfo[] =>
  Object.keys(m)
    .sort()
    .map((name) => ({ name, updatedAt: m[name].updatedAt, updatedBy: m[name].updatedBy }));

/** Like GET /v1/apps/{name}/secrets. */
export function listSecrets(d: DeploySim, app: string): AppSecrets {
  const all = d.secrets[app] ?? {};
  return {
    app: byName(all[""] ?? {}),
    instances: Object.keys(all)
      .filter((i) => i && Object.keys(all[i]).length > 0)
      .sort()
      .map((instance) => ({ instance, secrets: byName(all[instance]) })),
  };
}

function scopeRefusal(d: DeploySim, app: string, instance: string | undefined): Refusal | null {
  const a = d.apps.find((x) => x.name === app);
  if (!a?.deploy) return { status: 404, code: "app_not_found", message: "app not found" };
  if (instance && !a.deploy.instances.some((i) => i.name === instance)) return { status: 404, code: "instance_not_found", message: `instance ${instance} not found` };
  return null;
}

/** Like GET /v1/apps/{name}/secrets/{secret}?instance=. */
export function getSecret(d: DeploySim, app: string, name: string, instance?: string): AppSecretValue | Refusal {
  const refused = scopeRefusal(d, app, instance);
  if (refused) return refused;
  const scope = d.secrets[app]?.[instance ?? ""] ?? {};
  if (!Object.hasOwn(scope, name)) return { status: 404, code: "secret_not_found", message: `secret ${name} not found` };
  const x = scope[name];
  return { name, ...(instance ? { instance } : {}), value: x.value, updatedAt: x.updatedAt, updatedBy: x.updatedBy };
}

/** What PUT /v1/apps/{name}/secrets would refuse, or null when it would apply. */
export function checkUpdate(d: DeploySim, app: string, body: AppSecretsUpdate): Refusal | null {
  const refused = scopeRefusal(d, app, body.instance);
  if (refused) return refused;
  const bad = (message: string): Refusal => ({ status: 400, code: "invalid_request", message });
  const set = Object.entries(body.set ?? {});
  const del = body.delete ?? [];
  if (set.length + del.length === 0) return bad("바꿀 것이 없습니다");
  for (const [name, value] of set) {
    const e = secretNameError(name) || secretValueError(value);
    if (e) return bad(name + ": " + e);
    if (del.includes(name)) return bad(name + "을(를) 넣으면서 지울 수 없습니다");
  }
  const after = new Set(Object.keys(d.secrets[app]?.[body.instance ?? ""] ?? {}));
  for (const n of del) after.delete(n);
  for (const [n] of set) after.add(n);
  if (after.size > MAX_SECRETS) return bad("시크릿은 " + MAX_SECRETS + "개까지입니다");
  return null;
}

/** Applies a change that checkUpdate passes. */
export function updateSecrets(d: DeploySim, app: string, body: AppSecretsUpdate, by = "operator"): void {
  if (checkUpdate(d, app, body)) return;
  const scope = ((d.secrets[app] ??= {})[body.instance ?? ""] ??= {});
  for (const n of body.delete ?? []) delete scope[n];
  for (const [n, value] of Object.entries(body.set ?? {})) scope[n] = { value, updatedAt: iso(d.now), updatedBy: by };
}
