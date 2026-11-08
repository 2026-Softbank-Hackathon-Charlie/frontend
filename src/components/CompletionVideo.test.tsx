import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeRun } from "../api/fakes";
import type { Run } from "../api/types";
import { COMPLETION_VIDEO_SRC, CompletionVideo, justSucceeded } from "./CompletionVideo";

afterEach(cleanup);

const run = (p: Partial<Run> = {}) => fakeRun({ runId: "run_1", status: "running", ...p });

describe("when the popup opens", () => {
  it("opens when the run on screen turns to succeeded", () => {
    expect(justSucceeded({ id: "run_1", status: "running" }, run({ status: "succeeded" }))).toBe(true);
    expect(justSucceeded({ id: "run_1", status: "awaiting_switch" }, run({ status: "succeeded" }))).toBe(true);
  });

  it("does not open for a run seen already finished, another run, a rollback or a run that did not succeed", () => {
    expect(justSucceeded({}, run({ status: "succeeded" }))).toBe(false); // the page was opened on a finished run
    expect(justSucceeded({ id: "run_1", status: "succeeded" }, run({ status: "succeeded" }))).toBe(false);
    expect(justSucceeded({ id: "run_0", status: "running" }, run({ status: "succeeded" }))).toBe(false);
    expect(justSucceeded({ id: "run_1", status: "running" }, run({ status: "succeeded", rollbackOf: "run_0" }))).toBe(false);
    expect(justSucceeded({ id: "run_1", status: "running" }, run({ status: "halted" }))).toBe(false);
    expect(justSucceeded({ id: "run_1", status: "running" }, undefined)).toBe(false);
  });
});

describe("the popup", () => {
  it("shows the video when the run finishes while the page is open, and closes with the button, Escape and a click outside", async () => {
    const { rerender, container } = render(<CompletionVideo run={run()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /완료 영상 보기/ })).toBeNull();

    rerender(<CompletionVideo run={run({ status: "succeeded" })} />);
    const dlg = screen.getByRole("dialog", { name: "이전이 끝났습니다" });
    const video = dlg.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(COMPLETION_VIDEO_SRC);
    expect(video).toHaveAttribute("controls");

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /완료 영상 보기/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /완료 영상 보기/ }));
    await userEvent.click(container.ownerDocument.querySelector(".mg-pop-overlay")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not pop up on a page opened on a finished run, but offers the button to play it", () => {
    render(<CompletionVideo run={run({ status: "succeeded" })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /완료 영상 보기/ })).toBeInTheDocument();
  });

  it("is silent for a rollback", () => {
    const { rerender } = render(<CompletionVideo run={run({ rollbackOf: "run_0" })} />);
    rerender(<CompletionVideo run={run({ status: "succeeded", rollbackOf: "run_0" })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /완료 영상 보기/ })).toBeNull();
  });
});

describe("motion", () => {
  const withMotion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), addEventListener: () => {}, removeEventListener: () => {} }));
  afterEach(() => vi.unstubAllGlobals());

  const open = () => {
    const { rerender } = render(<CompletionVideo run={run()} />);
    rerender(<CompletionVideo run={run({ status: "succeeded" })} />);
    return screen.getByRole("dialog").querySelector("video")!;
  };

  it("plays by itself, muted", () => {
    withMotion(false);
    const v = open();
    expect(v.autoplay).toBe(true);
    expect(v.muted).toBe(true);
  });

  it("waits for the person to press play when the system is set to reduce motion", () => {
    withMotion(true);
    const v = open();
    expect(v.autoplay).toBe(false);
    expect(v).toHaveAttribute("controls");
  });
});

describe("when the video cannot be loaded", () => {
  const open = () => {
    const r = render(<CompletionVideo run={run()} />);
    r.rerender(<CompletionVideo run={run({ status: "succeeded" })} />);
    return r;
  };

  it("says so instead of leaving a blank box, and keeps the close button", async () => {
    open();
    fireEvent.error(screen.getByRole("dialog").querySelector("video")!);
    expect(screen.getByRole("alert")).toHaveTextContent("영상을 불러오지 못했습니다.");
    expect(screen.getByRole("dialog").querySelector("video")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tries the video again the next time it is opened", async () => {
    open();
    fireEvent.error(screen.getByRole("dialog").querySelector("video")!);
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: /완료 영상 보기/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("dialog").querySelector("video")).not.toBeNull();
  });
});
