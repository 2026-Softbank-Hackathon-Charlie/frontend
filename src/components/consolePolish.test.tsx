import { render, screen } from "@testing-library/react";
import { fakeAgentSession } from "../api/fakes";
import { SessionTable } from "./agent";
import { specHint } from "./deploy";
import { resultParts } from "../pages/Overview";

it("tells to add platform.yaml when the server says it is not at the root", () => {
  expect(specHint({ path: "", message: "platform.yaml is not at the root of org/gitops at b341cf1" })).toBe(
    "레포 루트에 platform.yaml을 두세요. 서비스마다 Dockerfile도 있어야 합니다.",
  );
});

it("shows no token count for a session without model calls", () => {
  const totals = { events: 3, toolCalls: 11, inputTokens: 0, outputTokens: 0, durationMillis: 0 };
  render(<SessionTable sessions={[fakeAgentSession({ kind: "rehearsal", title: "rehearsal", totals }), fakeAgentSession({ id: "ags_2", title: "plan", totals: { ...totals, inputTokens: 12798, outputTokens: 2395 } })]} />);
  expect(screen.queryByText("0 / 0")).not.toBeInTheDocument();
  expect(screen.getByText("-")).toBeInTheDocument();
  expect(screen.getByText("12,798 / 2,395")).toBeInTheDocument();
});

it("names each measured kind of missing data and leaves out the unmeasured one", () => {
  // the platform measured rows and files, not writes (no written records were connected)
  expect(resultParts({ durationMillis: 137697, downtimeMillis: 21697, failedRequests: 0, missingRows: 0, missingFiles: 0 })).toEqual([
    "2분 18초",
    "쓰기 보류 21.7초",
    "실패 요청 0건",
    "행 누락 0건",
    "파일 누락 0건",
  ]);
  expect(resultParts({ missingRows: 0, missingWrites: 2 })).toEqual(["행 누락 0건", "쓰기 누락 2건"]);
});
