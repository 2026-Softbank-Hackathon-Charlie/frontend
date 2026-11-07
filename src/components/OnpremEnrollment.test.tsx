import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setToken } from "../api/client";
import { StrictMode } from "react";
import type { OnpremEnrollment } from "../api/onprem";
import { OnpremEnrollmentPanel } from "./OnpremEnrollment";

const checks = ["k3s", "network", "permissions", "image_pull", "hello_world"] as const;
function enrollment(status: OnpremEnrollment["status"] = "pending"): OnpremEnrollment {
  const now = new Date().toISOString();
  return { id: "enr_test", environment: "edge-01", status, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 900_000).toISOString(), checks: checks.map((id) => ({ id, status: status === "ready" ? "passed" : "pending" })) };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function setup() {
  setToken("test-operator-only");
  return render(<OnpremEnrollmentPanel operator pollMs={0} onClose={vi.fn()} />);
}
async function issue() {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("환경 이름"));
  await user.type(screen.getByLabelText("환경 이름"), "edge-01");
  await user.click(screen.getByRole("button", { name: "등록 코드 발급" }));
  return user;
}
afterEach(() => { setToken(null); vi.unstubAllGlobals(); });

it("creates through the authenticated API and copies only the server installation command", async () => {
  const command = "server-issued-install-command --code=ONETIME";
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-operator-only");
    expect(JSON.parse(init?.body as string)).toEqual({ environment: "edge-01", installK3s: false });
    return json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: command }, 201);
  });
  vi.stubGlobal("fetch", fetcher);
  const copy = vi.fn().mockResolvedValue(undefined);
  setup();
  const user = await issue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  expect(await screen.findByLabelText("일회용 등록 코드")).toHaveTextContent("ABCD-EFGH");
  expect(screen.getByLabelText("장비에서 실행할 명령")).toHaveValue(command);
  await user.click(screen.getByRole("button", { name: "설치 명령 복사" }));
  expect(copy).toHaveBeenCalledWith(command);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("onprem.enrollment")).toBeNull();
  expect(screen.getByText(/PowerShell에서는 직접 실행할 수 없습니다/)).toBeInTheDocument();
});

it("reuses the issuance key after network failure and changes it when the install choice changes", async () => {
  const keys: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
    throw new TypeError("network failure");
  }));
  setup(); const user = await issue();
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "등록 코드 발급" }));
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  expect(keys[1]).toBe(keys[0]);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "등록 코드 발급" }));
  await waitFor(() => expect(keys).toHaveLength(3));
  expect(keys[2]).not.toBe(keys[0]);
});

it("does not fabricate codes or installation commands for an unsupported server", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "not_found", message: "unsupported" } }, 404)));
  setup(); await issue();
  expect(await screen.findByRole("alert")).toHaveTextContent("이 서버는 온프렘 자동 연결을 지원하지 않습니다");
  expect(screen.queryByLabelText("일회용 등록 코드")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("장비에서 실행할 명령")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "등록 코드 발급" })).toBeDisabled();
});

it("hides consumed credentials and requires every check even when the server reports ready", async () => {
  const ready = enrollment("ready"); ready.checks = ready.checks.filter((c) => c.id !== "image_pull");
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201) : json(ready)));
  setup(); const user = await issue();
  await screen.findByLabelText("일회용 등록 코드");
  await user.click(screen.getByRole("button", { name: "연결 상태 새로고침" }));
  await waitFor(() => expect(screen.queryByLabelText("일회용 등록 코드")).not.toBeInTheDocument());
  expect(screen.queryByText("배포할 준비가 됐습니다.")).not.toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /이미지 다운로드/ })).getByText("미확인")).toBeInTheDocument();
});

it("shows completion only from ready plus all successful server checks", async () => {
  const onReady = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201) : json(enrollment("ready"))));
  render(<OnpremEnrollmentPanel operator pollMs={0} onClose={vi.fn()} onReady={onReady} />);
  const user = await issue();
  await screen.findByLabelText("일회용 등록 코드");
  await user.click(screen.getByRole("button", { name: "연결 상태 새로고침" }));
  expect(await screen.findByText("배포할 준비가 됐습니다.")).toBeInTheDocument();
  expect(onReady).toHaveBeenCalledTimes(1);
});

it("revokes a pending code before reissuing and does not duplicate a pending request", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    paths.push(String(url));
    return String(url).endsWith("/revoke") ? json(enrollment("revoked")) : json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201);
  }));
  setup(); const user = await issue();
  await screen.findByLabelText("일회용 등록 코드");
  await user.click(screen.getByRole("button", { name: "코드 폐기 후 재발급" }));
  await waitFor(() => expect(paths).toHaveLength(3));
  expect(paths[1]).toContain("/v1/onprem/enrollments/enr_test/revoke");
  expect(paths[2]).toContain("/v1/onprem/enrollments");
});

it("prevents viewers from issuing credentials", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  render(<OnpremEnrollmentPanel operator={false} pollMs={0} onClose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "등록 코드 발급" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "등록 코드 발급" }));
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not show expired credentials returned by the server", async () => {
  const expired = enrollment(); expired.expiresAt = new Date(Date.now() - 1000).toISOString();
  vi.stubGlobal("fetch", vi.fn(async () => json({ enrollment: expired, code: "EXPIRED", installCommand: "expired-command" }, 201)));
  setup(); await issue();
  expect(await screen.findByText("코드 만료")).toBeInTheDocument();
  expect(screen.queryByLabelText("일회용 등록 코드")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("장비에서 실행할 명령")).not.toBeInTheDocument();
});

it("marks a failed refresh stale and removes the no-longer-confirmed command", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201) : json({ error: { code: "upstream_unavailable", message: "network unavailable" } }, 502)));
  setup(); const user = await issue(); await screen.findByLabelText("일회용 등록 코드");
  await user.click(screen.getByRole("button", { name: "연결 상태 새로고침" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("마지막으로 받은 결과입니다");
  expect(screen.queryByLabelText("장비에서 실행할 명령")).not.toBeInTheDocument();
  expect(screen.queryByText("배포할 준비가 됐습니다.")).not.toBeInTheDocument();
});

it("works in StrictMode and disables duplicate issuance while the request is pending", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  render(<StrictMode><OnpremEnrollmentPanel operator pollMs={0} onClose={vi.fn()} /></StrictMode>);
  const user = await issue();
  expect(screen.getByRole("button", { name: "발급하는 중" })).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201));
  expect(await screen.findByLabelText("일회용 등록 코드")).toHaveTextContent("ABCD-EFGH");
  await user.click(screen.getByRole("button", { name: "설치 명령 복사" }));
});

it("does not replace the old request when revocation fails", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith("/revoke") ? json({ error: { code: "state_conflict", message: "could not revoke" } }, 409) : json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201));
  vi.stubGlobal("fetch", fetcher);
  setup(); const user = await issue(); await screen.findByLabelText("일회용 등록 코드");
  await user.click(screen.getByRole("button", { name: "코드 폐기 후 재발급" }));
  await screen.findByRole("alert");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("handles replayed creation without redisplaying a code the server did not return", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ enrollment: enrollment() }, 200)));
  setup(); await issue();
  expect(await screen.findByRole("alert")).toHaveTextContent("코드를 다시 읽을 수 없습니다");
  expect(screen.queryByLabelText("일회용 등록 코드")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "코드 폐기 후 재발급" })).toBeEnabled();
});

it("requires explicit k3s installation consent and sends that choice to the server", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(init?.body as string).installK3s).toBe(true);
    return json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201);
  });
  vi.stubGlobal("fetch", fetcher); setup();
  const user = userEvent.setup();
  const consent = screen.getByRole("checkbox", { name: /k3s가 없으면 설치/ });
  expect(consent).not.toBeChecked();
  await user.click(consent);
  await issue();
  await screen.findByLabelText("일회용 등록 코드");
});

it("clears the one-time command when operator access is removed", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ enrollment: enrollment(), code: "ABCD-EFGH", installCommand: "server-command" }, 201)));
  const view = render(<OnpremEnrollmentPanel operator pollMs={0} onClose={vi.fn()} />);
  await issue(); await screen.findByLabelText("일회용 등록 코드");
  view.rerender(<OnpremEnrollmentPanel operator={false} pollMs={0} onClose={vi.fn()} />);
  expect(screen.queryByLabelText("일회용 등록 코드")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("장비에서 실행할 명령")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "등록 코드 발급" })).toBeDisabled();
});
