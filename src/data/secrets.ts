// The secrets of a registered app (ADR 0019), from the simulation or the platform API.
// No value is kept here: reveal hands one to the caller, which shows it and drops it.
import { useState } from "react";
import { ApiError, getAppSecret, updateAppSecrets } from "../api/client";
import { useAppSecrets } from "../api/hooks";
import type { AppSecrets, AppSecretsUpdate } from "../api/types";
import type { Refusal } from "../sim/deploy";
import { iso } from "../sim/mig";
import * as sec from "../sim/secrets";
import { useSim } from "../sim/store";
import { deployErrorText } from "./deploy";
import { useAuth } from "./live";

export type RevealResult = { value: string } | { error: string };

export interface SecretsModel {
  live: boolean;
  /** the names, app-wide and per instance; undefined until they arrive */
  data: AppSecrets | undefined;
  /** why the names could not be read; "" otherwise */
  error: string;
  /** the server has no secrets key (503 secrets_not_configured) */
  notConfigured: boolean;
  /** false for a role that may read names only, and once the server answered 403 */
  canEdit: boolean;
  /** epoch ms, for when a secret was changed */
  now: number;
  /** One value; with `instance`, that instance's override. */
  reveal(name: string, instance: string | undefined, signal?: AbortSignal): Promise<RevealResult>;
  /** Sends one change (one scope); resolves with "" once saved, or an error message. */
  save(body: AppSecretsUpdate): Promise<string>;
  /** Reads the names again. */
  reload(): void;
}

/** A short Korean message for a failed secrets call. */
function secretErrorText(e: unknown): string {
  if (e instanceof ApiError && e.code === "app_not_registered") return "파일에만 있는 앱이라 시크릿을 쓸 수 없습니다";
  return deployErrorText(e);
}

const refusalText = (r: Refusal) => secretErrorText(new ApiError(r.status, r.code, r.message));

export function useSimSecrets(app: string): SecretsModel {
  const { S, dispatch } = useSim();
  return {
    live: false,
    data: sec.listSecrets(S.deploy, app),
    error: "",
    notConfigured: false,
    canEdit: true,
    now: Date.parse(iso(S.deploy.now)),
    reveal: async (name, instance) => {
      const r = sec.getSecret(S.deploy, app, name, instance);
      return "code" in r ? { error: refusalText(r) } : { value: r.value };
    },
    save: async (body) => {
      const refused = sec.checkUpdate(S.deploy, app, body);
      if (refused) return refusalText(refused);
      dispatch({ type: "secrets-update", name: app, body });
      return "";
    },
    reload: () => {},
  };
}

export function useLiveSecrets(app: string): SecretsModel {
  const list = useAppSecrets(app);
  const role = useAuth().session?.principal.role;
  const [forbidden, setForbidden] = useState(false);
  // The names a save answered with, until the list read after it arrives.
  const [saved, setSaved] = useState<{ base: AppSecrets | undefined; next: AppSecrets }>();
  const data = saved && saved.base === list.data ? saved.next : list.data;
  const notConfigured = list.error?.code === "secrets_not_configured";
  const failed = (e: unknown): string => {
    if (e instanceof ApiError && e.status === 403) setForbidden(true);
    // A secret or an instance that went away: read the names again.
    if (e instanceof ApiError && e.status === 404) list.reload();
    return secretErrorText(e);
  };
  return {
    live: true,
    data,
    error: list.error && !data && !notConfigured ? secretErrorText(list.error) : "",
    notConfigured,
    canEdit: role === "operator" && !forbidden,
    now: Date.now(),
    reveal: async (name, instance, signal) => {
      try {
        return { value: (await getAppSecret(app, name, { instance }, { signal })).value };
      } catch (e) {
        return { error: failed(e) };
      }
    },
    save: async (body) => {
      try {
        const next = await updateAppSecrets(app, body);
        setSaved({ base: list.data, next });
        list.reload();
        return "";
      } catch (e) {
        return failed(e);
      }
    },
    reload: list.reload,
  };
}
