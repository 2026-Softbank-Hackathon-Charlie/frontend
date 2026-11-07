import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installFetch, json } from "../api/fakes";
import { appWriteStream, LiveWriteCollection } from "./WriteCollection";

afterEach(() => vi.unstubAllGlobals());

it("queries actual app stream statistics without claiming zero data loss or a live collector", async () => {
  installFetch(c => c.url.endsWith("/v1/written-records/app-shop") ? json(200, { stream: "app-shop", count: 0 }) : json(404, {}));
  render(<LiveWriteCollection app="shop" />);
  expect(await screen.findByText("수집 기록 없음")).toBeInTheDocument();
  expect(screen.getByText("0건")).toBeInTheDocument();
  expect(screen.getByText(/아직 쓰기 누락을 검사할 수 없습니다/)).toBeInTheDocument();
  expect(screen.queryByText("쓰기 검증 완료")).not.toBeInTheDocument();
});

it("shows collected scope after a real reload and hides the previous app's record count", async () => {
  let count = 0;
  installFetch(c => c.url.endsWith("/v1/written-records/app-shop") ? json(200, { stream: "app-shop", count, scope: "application_commits", coverage: "reservation_inserts", ...(count ? { latestAt: "2026-11-07T06:00:00Z" } : {}) }) : json(200, { stream: "app-other", count: 0 }));
  const { rerender } = render(<LiveWriteCollection app="shop" />);
  await screen.findByText("수집 기록 없음");
  count = 3;
  // A keyed app switch mounts a fresh resource, as the setup screen does.
  rerender(<LiveWriteCollection key="shop-reload" app="shop" />);
  expect(await screen.findByText("3건")).toBeInTheDocument();
  expect(screen.getByText("마지막 쓰기 기록 시각")).toBeInTheDocument();
  expect(screen.getByText(/플랫폼 도착 시각은 제공되지 않습니다/)).toBeInTheDocument();
  expect(screen.getByText(/예약 생성 기록만 수집합니다/)).toBeInTheDocument();
  rerender(<LiveWriteCollection key="other" app="other" />);
  await screen.findByText("0건");
  expect(screen.queryByText("3건")).not.toBeInTheDocument();
});

it("keeps a lookup failure distinct from empty records and permits retry", async () => {
  let failed = true;
  installFetch(() => failed ? json(503, { error: { code: "unavailable", message: "unavailable" } }) : json(200, { stream: "app-shop", count: 2 }));
  render(<LiveWriteCollection app="shop" />);
  const retry = await screen.findByRole("button", { name: "쓰기 기록 다시 조회" });
  expect(screen.queryByText("0건")).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByText("2건")).toBeInTheDocument());
});

it("does not invent an invalid long app stream", () => {
  expect(appWriteStream("shop")).toBe("app-shop");
  expect(appWriteStream("a".repeat(60))).toBeNull();
  expect(appWriteStream("")).toBeNull();
});
