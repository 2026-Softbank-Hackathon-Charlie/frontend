import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { at, fakeDeployment, fakeSession, hang, installFetch, json, type FakeCall, type FakeHandler } from "../api/fakes";
import type { App as ApiApp, AppInstance, AppSecrets, AppSecretsUpdate, AppSpec, Session } from "../api/types";
import { App } from "../App";
import { initAuth, startSession } from "../data/live";
import { createSim, SimProvider } from "../sim/store";

function setup(hash: string) {
  window.location.hash = hash;
  localStorage.setItem("hopcharlie.mode", "demo");
  initAuth();
  const sim = createSim();
  const user = userEvent.setup();
  render(
    <SimProvider sim={sim} intervalMs={0}>
      <App />
    </SimProvider>,
  );
  return { sim, user };
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  initAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const spec: AppSpec = {
  name: "moimroom",
  services: [{ name: "web", path: ".", dockerfile: "Dockerfile", port: 8080, healthCheck: "/healthz", public: true, replicas: 1 }],
};
const commit = "9fceb02d0ae598e95dc970b74767f19372d61af8";
const instance = (name: string, branch: string, isDefault: boolean): AppInstance => ({
  name,
  branch,
  default: isDefault,
  autoDeploy: true,
  spec,
  specCommit: commit,
  createdAt: at(0),
  createdBy: "operator",
  status: [{ env: "eks", status: "healthy", syncStatus: "Synced", healthStatus: "Healthy", commit }],
});
const main = instance("moimroom", "main", true);
const dev = instance("moimroom--dev", "dev", false);
const app: ApiApp = {
  name: "moimroom",
  namespace: "moimroom",
  database: { name: "app", user: "app", schemas: [] },
  environments: [],
  deploy: { repo: "org/moimroom", branch: "main", environments: ["eks"], autoDeploy: true, spec, specCommit: commit, createdAt: at(0), createdBy: "operator", status: main.status, instances: [main, dev] },
};

type Extra = (c: FakeCall, u: URL) => Response | Promise<Response> | undefined;

/** The secrets endpoints over an in-memory store: two app-wide secrets, and moimroom--dev overriding ADMIN_TOKEN. */
function secretsServer(): Extra {
  const store: Record<string, Record<string, string>> = { "": { ADMIN_TOKEN: "app-token-1", HOST_CODE: "4821" }, "moimroom--dev": { ADMIN_TOKEN: "dev-token-2" } };
  const infos = (m: Record<string, string>) =>
    Object.keys(m)
      .sort()
      .map((name) => ({ name, updatedAt: at(5), updatedBy: "admin" }));
  const list = (): AppSecrets => ({
    app: infos(store[""]),
    instances: Object.keys(store)
      .filter((i) => i && Object.keys(store[i]).length > 0)
      .sort()
      .map((i) => ({ instance: i, secrets: infos(store[i]) })),
  });
  return (c, u) => {
    if (u.pathname === "/v1/apps/moimroom/secrets") {
      if (c.method === "GET") return json(200, list());
      const b = JSON.parse(c.body!) as AppSecretsUpdate;
      const scope = (store[b.instance ?? ""] ??= {});
      for (const n of b.delete ?? []) delete scope[n];
      Object.assign(scope, b.set ?? {});
      return json(200, list());
    }
    const m = /^\/v1\/apps\/moimroom\/secrets\/([^/]+)$/.exec(u.pathname);
    if (m && c.method === "GET") {
      const inst = u.searchParams.get("instance") ?? "";
      const value = store[inst]?.[m[1]];
      if (value === undefined) return json(404, { error: { code: "secret_not_found", message: "no such secret" } });
      return json(200, { name: m[1], ...(inst ? { instance: inst } : {}), value, updatedAt: at(5), updatedBy: "admin" });
    }
    return undefined;
  };
}

/** Live mode on the app page of moimroom; `extra` answers first. */
function live(extra: Extra = () => undefined, session: Session = fakeSession()): FakeCall[] {
  const secrets = secretsServer();
  const route: FakeHandler = (c) => {
    const u = new URL(c.url, "http://x");
    const r = extra(c, u) ?? secrets(c, u);
    if (r) return r;
    if (u.pathname === "/v1/apps" && c.method === "GET") return json(200, { apps: [app] });
    if (u.pathname === "/v1/apps/moimroom" && c.method === "GET") return json(200, app);
    if (u.pathname === "/v1/apps/moimroom/deployments" && c.method === "GET") return json(200, { deployments: [fakeDeployment({ status: "healthy", finishedAt: at(50) })] });
    if (u.pathname.endsWith("/events")) return hang(c);
    return json(404, { error: { code: "not_found", message: "no" } });
  };
  const calls = installFetch(route);
  act(() => startSession(session));
  return calls;
}

async function openSecrets(extra?: Extra, session?: Session) {
  const { user } = setup("#app-moimroom");
  const calls = live(extra, session);
  const appWide = await screen.findByRole("region", { name: "앱 공통 시크릿" });
  return { user, calls, appWide };
}
const instScope = () => screen.getByRole("region", { name: "인스턴스별 덮어쓰기" });
const valueCalls = (calls: FakeCall[]) => calls.filter((c) => /\/secrets\/[^/?]+/.test(c.url));
const puts = (calls: FakeCall[]) => calls.filter((c) => c.method === "PUT").map((c) => JSON.parse(c.body!) as unknown);
const rowOf = (scope: HTMLElement, name: string) => within(scope).getByText(name).closest("tr") as HTMLElement;

describe("app secrets (platform API)", () => {
  it("lists the names without values and asks for no value on load", async () => {
    const { calls, appWide } = await openSecrets();
    expect(within(appWide).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["ADMIN_TOKEN", "HOST_CODE"]);
    expect(rowOf(appWide, "HOST_CODE")).toHaveTextContent("admin");
    expect(within(appWide).getByRole("button", { name: "HOST_CODE 값 보기" })).toHaveAttribute("aria-pressed", "false");
    expect(appWide).not.toHaveTextContent("4821");
    // the default instance is picked first and inherits both
    expect(screen.getByLabelText("덮어쓰기를 볼 인스턴스")).toHaveValue("moimroom");
    expect(rowOf(instScope(), "HOST_CODE")).toHaveTextContent("앱 공통");
    expect(valueCalls(calls)).toHaveLength(0);
  });

  it("shows a value only on request, hides it on the second press, and by itself after 60 seconds", async () => {
    // only the interval and the clock: React and Testing Library keep their real timers
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k));
    const { user, calls, appWide } = await openSecrets();
    const eye = within(appWide).getByRole("button", { name: "HOST_CODE 값 보기" });
    await user.click(eye);
    expect(await within(appWide).findByText("4821")).toBeInTheDocument();
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(valueCalls(calls).map((c) => c.url)).toEqual(["/v1/apps/moimroom/secrets/HOST_CODE"]);

    await user.click(eye);
    expect(within(appWide).queryByText("4821")).not.toBeInTheDocument();
    expect(eye).toHaveAttribute("aria-pressed", "false");

    // nothing was kept: showing it again asks again
    await user.click(eye);
    expect(await within(appWide).findByText("4821")).toBeInTheDocument();
    expect(valueCalls(calls)).toHaveLength(2);
    act(() => vi.advanceTimersByTime(59_000));
    expect(within(appWide).getByText("4821")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(within(appWide).queryByText("4821")).not.toBeInTheDocument();
    expect(eye).toHaveAttribute("aria-pressed", "false");

    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain("4821");
    expect(calls.some((c) => c.url.includes("4821"))).toBe(false);
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain("4821");
  });

  it("drops a shown value when leaving the page", async () => {
    const { user, appWide } = await openSecrets();
    await user.click(within(appWide).getByRole("button", { name: "HOST_CODE 값 보기" }));
    expect(await within(appWide).findByText("4821")).toBeInTheDocument();
    act(() => {
      window.location.hash = "#apps";
    });
    await screen.findByRole("navigation", { name: "상태로 앱 거르기" });
    act(() => {
      window.location.hash = "#app-moimroom";
    });
    const again = await screen.findByRole("region", { name: "앱 공통 시크릿" });
    expect(within(again).getByRole("button", { name: "HOST_CODE 값 보기" })).toHaveAttribute("aria-pressed", "false");
    expect(again).not.toHaveTextContent("4821");
  });

  it("stages an add, an edit and a delete, sends them in one PUT, then offers a redeploy", async () => {
    const { user, calls, appWide } = await openSecrets();
    await user.type(within(appWide).getByLabelText("이름"), "NEW_KEY");
    await user.type(within(appWide).getByLabelText("값"), "v1");
    await user.click(within(appWide).getByRole("button", { name: "변경에 넣기" }));

    await user.click(within(appWide).getByRole("button", { name: "HOST_CODE 수정" }));
    await user.click(within(appWide).getByRole("button", { name: "현재 값 불러오기" }));
    const input = within(appWide).getByLabelText("HOST_CODE 새 값");
    await waitFor(() => expect(input).toHaveValue("4821"));
    await user.clear(input);
    await user.type(input, "9999");
    await user.click(within(appWide).getByRole("button", { name: "변경에 넣기" }));

    await user.click(within(appWide).getByRole("button", { name: "ADMIN_TOKEN 삭제" }));

    const pending = within(appWide).getByRole("status", { name: "앱 공통 시크릿 저장하지 않은 변경" });
    expect(pending).toHaveTextContent("저장하지 않은 변경 3개");
    expect(pending).toHaveTextContent("NEW_KEY 추가, HOST_CODE 수정, ADMIN_TOKEN 삭제");
    expect(rowOf(appWide, "NEW_KEY")).toHaveTextContent("추가 예정");
    expect(rowOf(appWide, "ADMIN_TOKEN")).toHaveTextContent("삭제 예정");
    expect(within(rowOf(appWide, "ADMIN_TOKEN")).queryByRole("button", { name: "ADMIN_TOKEN 값 보기" })).not.toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);

    await user.click(within(pending).getByRole("button", { name: "저장" }));
    const done = await within(appWide).findByRole("status", { name: "앱 공통 시크릿 저장됨" });
    expect(done).toHaveTextContent("실행 중인 인스턴스들은 재배포할 때까지 이전 값을 씁니다.");
    expect(puts(calls)).toEqual([{ set: { NEW_KEY: "v1", HOST_CODE: "9999" }, delete: ["ADMIN_TOKEN"] }]);
    expect(within(appWide).queryByRole("status", { name: "앱 공통 시크릿 저장하지 않은 변경" })).not.toBeInTheDocument();
    expect(within(appWide).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["HOST_CODE", "NEW_KEY"]);
    expect(within(done).getAllByRole("button").map((b) => b.textContent)).toEqual(["moimroom 재배포", "moimroom--dev 재배포", "모든 인스턴스 재배포"]);
  });

  it("forgets staged changes on cancel and reverts one row", async () => {
    const { user, calls, appWide } = await openSecrets();
    await user.click(within(appWide).getByRole("button", { name: "ADMIN_TOKEN 삭제" }));
    await user.click(within(appWide).getByRole("button", { name: "HOST_CODE 삭제" }));
    await user.click(within(appWide).getByRole("button", { name: "ADMIN_TOKEN 되돌리기" }));
    expect(within(appWide).getByRole("status", { name: "앱 공통 시크릿 저장하지 않은 변경" })).toHaveTextContent("저장하지 않은 변경 1개");
    await user.click(within(appWide).getByRole("button", { name: "취소" }));
    expect(within(appWide).queryByRole("status")).not.toBeInTheDocument();
    expect(within(appWide).queryByText(/예정/)).not.toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);
  });

  it("adds an override with `instance` in the body and reads override values with it", async () => {
    const { user, calls } = await openSecrets();
    await user.selectOptions(screen.getByLabelText("덮어쓰기를 볼 인스턴스"), "moimroom--dev");
    let inst = instScope();
    expect(rowOf(inst, "ADMIN_TOKEN")).toHaveTextContent("덮어씀");
    expect(rowOf(inst, "HOST_CODE")).toHaveTextContent("앱 공통");
    expect(within(rowOf(inst, "HOST_CODE")).queryByRole("button", { name: "HOST_CODE 값 보기" })).not.toBeInTheDocument();

    await user.click(within(inst).getByRole("button", { name: "ADMIN_TOKEN 값 보기" }));
    expect(await within(inst).findByText("dev-token-2")).toBeInTheDocument();
    expect(valueCalls(calls).map((c) => c.url)).toEqual(["/v1/apps/moimroom/secrets/ADMIN_TOKEN?instance=moimroom--dev"]);

    await user.click(within(inst).getByRole("button", { name: "HOST_CODE 덮어쓰기" }));
    await user.click(within(inst).getByRole("button", { name: "앱 공통 값 불러오기" }));
    await waitFor(() => expect(within(inst).getByLabelText("HOST_CODE 새 값")).toHaveValue("4821"));
    await user.type(within(inst).getByLabelText("HOST_CODE 새 값"), "-dev");
    await user.click(within(inst).getByRole("button", { name: "변경에 넣기" }));
    expect(rowOf(inst, "HOST_CODE")).toHaveTextContent("덮어쓰기 예정");
    expect(screen.getByLabelText("덮어쓰기를 볼 인스턴스")).toBeDisabled();

    await user.click(within(inst).getByRole("button", { name: "저장" }));
    const done = await within(inst).findByRole("status", { name: "moimroom--dev의 덮어쓰기 저장됨" });
    expect(puts(calls)).toEqual([{ instance: "moimroom--dev", set: { HOST_CODE: "4821-dev" } }]);
    expect(within(done).getAllByRole("button").map((b) => b.textContent)).toEqual(["moimroom--dev 재배포"]);
    inst = instScope();
    await waitFor(() => expect(rowOf(inst, "HOST_CODE")).toHaveTextContent("덮어씀"));
    expect(screen.getByLabelText("덮어쓰기를 볼 인스턴스")).toBeEnabled();
    // the app-wide value did not change
    expect(valueCalls(calls).filter((c) => !c.url.includes("instance="))).toHaveLength(1);
  });

  it("clears an override so the instance falls back to the app-wide value", async () => {
    const { user, calls } = await openSecrets();
    await user.selectOptions(screen.getByLabelText("덮어쓰기를 볼 인스턴스"), "moimroom--dev");
    const inst = instScope();
    await user.click(within(inst).getByRole("button", { name: "ADMIN_TOKEN 덮어쓰기 지우기" }));
    expect(rowOf(inst, "ADMIN_TOKEN")).toHaveTextContent("덮어쓰기 지우기 예정");
    await user.click(within(inst).getByRole("button", { name: "저장" }));
    await within(inst).findByRole("status", { name: "moimroom--dev의 덮어쓰기 저장됨" });
    expect(puts(calls)).toEqual([{ instance: "moimroom--dev", delete: ["ADMIN_TOKEN"] }]);
    await waitFor(() => expect(rowOf(inst, "ADMIN_TOKEN")).toHaveTextContent("앱 공통"));
    expect(within(inst).queryByRole("button", { name: "ADMIN_TOKEN 값 보기" })).not.toBeInTheDocument();
  });

  it("redeploys one instance without a build after a save and opens its deployment", async () => {
    const { user, calls, appWide } = await openSecrets((c, u) =>
      u.pathname === "/v1/apps/moimroom/deployments" && c.method === "POST" ? json(202, fakeDeployment({ id: "dep_r", branch: "dev", instance: "moimroom--dev", trigger: "redeploy" })) : undefined,
    );
    await user.click(within(appWide).getByRole("button", { name: "ADMIN_TOKEN 삭제" }));
    await user.click(within(appWide).getByRole("button", { name: "저장" }));
    const done = await within(appWide).findByRole("status", { name: "앱 공통 시크릿 저장됨" });
    await user.click(within(done).getByRole("button", { name: "moimroom--dev 재배포" }));
    await waitFor(() => expect(window.location.hash).toBe("#deploy-dep_r"));
    const posts = calls.filter((c) => c.method === "POST" && c.url === "/v1/apps/moimroom/deployments");
    expect(posts.map((c) => JSON.parse(c.body!) as unknown)).toEqual([{ branch: "dev", redeploy: true }]);
  });

  it("redeploys every instance, links each deployment and says which one has nothing to redeploy", async () => {
    const { user, calls, appWide } = await openSecrets((c, u) => {
      if (u.pathname !== "/v1/apps/moimroom/deployments" || c.method !== "POST") return undefined;
      if ((JSON.parse(c.body!) as { branch: string }).branch === "dev") return json(409, { error: { code: "nothing_to_redeploy", message: "moimroom--dev has no healthy deployment" } });
      return json(202, fakeDeployment({ id: "dep_m", trigger: "redeploy" }));
    });
    await user.click(within(appWide).getByRole("button", { name: "HOST_CODE 삭제" }));
    await user.click(within(appWide).getByRole("button", { name: "저장" }));
    const done = await within(appWide).findByRole("status", { name: "앱 공통 시크릿 저장됨" });
    await user.click(within(done).getByRole("button", { name: "모든 인스턴스 재배포" }));
    const link = await within(done).findByRole("link", { name: "moimroom 재배포 진행 보기" });
    expect(link).toHaveAttribute("href", "#deploy-dep_m");
    const items = within(done).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("moimroom재배포를 시작했습니다.");
    expect(items[1]).toHaveTextContent("moimroom--dev이 인스턴스에는 아직 정상(healthy) 배포가 없어 재배포할 수 없습니다");
    expect(items[1]).not.toHaveTextContent("no healthy deployment");
    const posts = calls.filter((c) => c.method === "POST" && c.url === "/v1/apps/moimroom/deployments");
    expect(posts.map((c) => JSON.parse(c.body!) as unknown)).toEqual([
      { branch: "main", redeploy: true },
      { branch: "dev", redeploy: true },
    ]);
    expect(window.location.hash).toBe("#app-moimroom");
  });

  it("redeploys from the instance row without a build, and says when there is no healthy deployment yet", async () => {
    const { user, calls } = await openSecrets((c, u) => {
      if (u.pathname !== "/v1/apps/moimroom/deployments" || c.method !== "POST") return undefined;
      if ((JSON.parse(c.body!) as { branch: string }).branch === "dev") return json(409, { error: { code: "nothing_to_redeploy", message: "no healthy deployment" } });
      return json(202, fakeDeployment({ id: "dep_m", trigger: "redeploy" }));
    });
    const section = screen.getByRole("heading", { name: "브랜치별 인스턴스" }).closest("section") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "moimroom--dev 재배포 (빌드 없이)" }));
    expect(await screen.findByText("moimroom--dev 재배포: 이 인스턴스에는 아직 정상(healthy) 배포가 없어 재배포할 수 없습니다. 먼저 배포를 한 번 끝내세요")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "moimroom 재배포 (빌드 없이)" }));
    await waitFor(() => expect(window.location.hash).toBe("#deploy-dep_m"));
    const posts = calls.filter((c) => c.method === "POST" && c.url === "/v1/apps/moimroom/deployments");
    expect(posts.map((c) => JSON.parse(c.body!) as unknown)).toEqual([
      { branch: "dev", redeploy: true },
      { branch: "main", redeploy: true },
    ]);
  });

  it("says the server has no secrets key", async () => {
    setup("#app-moimroom");
    live((_c, u) => (u.pathname === "/v1/apps/moimroom/secrets" ? json(503, { error: { code: "secrets_not_configured", message: "PLATFORM_SECRETS_KEY is not set" } }) : undefined));
    expect(await screen.findByText(/^서버에 시크릿 키가 설정되어 있지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "앱 공통 시크릿" })).not.toBeInTheDocument();
  });

  it("checks names and values like the server before staging, and still shows the server's 400", async () => {
    const { user, calls, appWide } = await openSecrets((c, u) =>
      u.pathname === "/v1/apps/moimroom/secrets" && c.method === "PUT" ? json(400, { error: { code: "invalid_request", message: "too many secrets: at most 50" } }) : undefined,
    );
    const name = within(appWide).getByLabelText("이름");
    const value = within(appWide).getByLabelText("값");
    const stage = within(appWide).getByRole("button", { name: "변경에 넣기" });
    async function attempt(n: string, v: string) {
      await user.clear(name);
      await user.clear(value);
      if (n) {
        await user.click(name);
        await user.paste(n);
      }
      if (v) {
        await user.click(value);
        await user.paste(v);
      }
      await user.click(stage);
      return within(appWide)
        .queryAllByRole("alert")
        .map((a) => a.textContent)
        .join(" / ");
    }
    expect(await attempt("", "x")).toBe("이름을 입력하세요");
    expect(await attempt("host_code", "x")).toBe("이름은 영문 대문자, 숫자, _만 쓰고 숫자로 시작할 수 없습니다");
    expect(await attempt("1KEY", "x")).toBe("이름은 영문 대문자, 숫자, _만 쓰고 숫자로 시작할 수 없습니다");
    for (const n of ["PORT", "DATABASE_URL", "S3_BUCKET"]) expect(await attempt(n, "x")).toBe("PORT, DATABASE_URL, S3_로 시작하는 이름은 플랫폼이 넣는 값이라 쓸 수 없습니다");
    expect(await attempt("A".repeat(65), "x")).toBe("이름은 64자까지입니다");
    expect(await attempt("HOST_CODE", "x")).toBe("이미 있는 이름입니다. 목록에서 수정을 누르세요");
    expect(await attempt("OK_NAME", "")).toBe("값을 입력하세요");
    // 1366 Hangul syllables are 4098 bytes of UTF-8
    expect(await attempt("OK_NAME", "가".repeat(1366))).toBe("값은 4096바이트까지입니다 (지금 4098바이트)");
    expect(within(appWide).queryByRole("status")).not.toBeInTheDocument();

    expect(await attempt("A".repeat(64), "가".repeat(1365))).toBe("");
    await user.click(within(appWide).getByRole("button", { name: "저장" }));
    expect(await within(appWide).findByRole("alert")).toHaveTextContent("저장하지 못했습니다: 요청이 올바르지 않습니다: too many secrets: at most 50");
    expect(within(appWide).getByRole("status", { name: "앱 공통 시크릿 저장하지 않은 변경" })).toBeInTheDocument();
    expect(puts(calls)).toHaveLength(1);
  });

  it("falls back to names only after a 403 and hides the show and edit controls", async () => {
    const { user, appWide } = await openSecrets((_c, u) =>
      u.pathname.startsWith("/v1/apps/moimroom/secrets/") ? json(403, { error: { code: "forbidden", message: "role viewer may not read secret values" } }) : undefined,
    );
    await user.click(within(appWide).getByRole("button", { name: "HOST_CODE 값 보기" }));
    expect(await within(appWide).findByRole("alert")).toHaveTextContent("값을 불러오지 못했습니다: 이 계정의 역할로는 할 수 없습니다 (operator 필요)");
    expect(screen.getByText(/이름만 볼 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /값 보기$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /수정$|덮어쓰기$|변경에 넣기/ })).not.toBeInTheDocument();
    expect(within(appWide).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["ADMIN_TOKEN", "HOST_CODE"]);
  });

  it("shows names only to a token that is not an operator", async () => {
    const { calls, appWide } = await openSecrets(undefined, fakeSession({ principal: { name: "rin", role: "viewer" } }));
    expect(within(appWide).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["이름", "바꾼 때"]);
    expect(screen.queryByRole("button", { name: /값 보기$/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).not.toBeInTheDocument();
    expect(valueCalls(calls)).toHaveLength(0);
  });
});

describe("app secrets (simulation)", () => {
  it("shows, adds and saves fake secrets without calling the API, then redeploys without a build", async () => {
    const calls = installFetch(() => json(500, { error: { code: "unexpected", message: "demo mode must not call the API" } }));
    const { sim, user } = setup("#app-todo-api");
    expect(screen.getByText(/데모 모드: 가짜 값/)).toBeInTheDocument();
    const appWide = screen.getByRole("region", { name: "앱 공통 시크릿" });
    await user.click(within(appWide).getByRole("button", { name: "JWT_SECRET 값 보기" }));
    expect(await within(appWide).findByText("demo-jwt-secret-not-real")).toBeInTheDocument();

    await user.type(within(appWide).getByLabelText("이름"), "HOST_CODE");
    await user.type(within(appWide).getByLabelText("값"), "demo-4821");
    await user.click(within(appWide).getByRole("button", { name: "변경에 넣기" }));
    await user.click(within(appWide).getByRole("button", { name: "ADMIN_TOKEN 삭제" }));
    await user.click(within(appWide).getByRole("button", { name: "저장" }));
    const done = await within(appWide).findByRole("status", { name: "앱 공통 시크릿 저장됨" });
    expect(Object.keys(sim.state.deploy.secrets["todo-api"][""]).sort()).toEqual(["HOST_CODE", "JWT_SECRET"]);
    expect(within(appWide).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["HOST_CODE", "JWT_SECRET"]);
    await user.click(within(appWide).getByRole("button", { name: "HOST_CODE 값 보기" }));
    expect(await within(appWide).findByText("demo-4821")).toBeInTheDocument();

    await user.click(within(done).getByRole("button", { name: "todo-api 재배포" }));
    expect(await screen.findByRole("heading", { level: 1, name: "todo-api 배포" })).toBeInTheDocument();
    const d = sim.state.deploy.deployments[0];
    expect(d).toMatchObject({ trigger: "redeploy", commit: sim.state.deploy.deployments[1].commit, status: "queued" });
    expect(screen.getByRole("heading", { level: 1 }).parentElement!.querySelector("p")).toHaveTextContent(/^main 브랜치, 빌드 없이 재배포, /);
    expect(screen.getByText("빌드하지 않고 마지막 정상 배포의 이미지를 다시 씁니다")).toBeInTheDocument();
    act(() => {
      for (let i = 0; i < 200; i++) sim.tick();
    });
    expect(sim.state.deploy.deployments[0].status).toBe("healthy");
    expect(sim.state.deploy.events[d.id].some((e) => e.phase === "building")).toBe(false);

    act(() => {
      window.location.hash = "#app-todo-api";
    });
    const history = (await screen.findByRole("heading", { name: "배포 이력" })).closest("section") as HTMLElement;
    expect(within(history).getAllByRole("row")[1]).toHaveTextContent("재배포");
    expect(calls).toHaveLength(0);
  });

  it("refuses a redeploy of an instance with no healthy deployment yet", async () => {
    installFetch(() => json(500, {}));
    const { sim, user } = setup("#apps");
    act(() => {
      sim.dispatch({ type: "app-create", req: { repo: "team-charlie/notice-board", branch: "main", environments: ["eks"], autoDeploy: true } });
    });
    act(() => {
      window.location.hash = "#app-notice-board";
    });
    const section = (await screen.findByRole("heading", { name: "브랜치별 인스턴스" })).closest("section") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "notice-board 재배포 (빌드 없이)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("notice-board 재배포: 이 인스턴스에는 아직 정상(healthy) 배포가 없어 재배포할 수 없습니다");
    expect(sim.state.deploy.deployments.filter((d) => d.trigger === "redeploy")).toHaveLength(0);
  });
});
