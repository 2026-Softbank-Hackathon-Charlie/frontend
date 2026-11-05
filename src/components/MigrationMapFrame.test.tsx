import { act, render, screen } from "@testing-library/react";
import { fakeRun } from "../api/fakes";
import type { MigrationView } from "../data/migration";
import { MapFrame } from "./MigrationMapFrame";

const noop = () => {};
function view(p: Partial<MigrationView> = {}): MigrationView {
  return {
    live: false, app: "shop", stage: "run", src: "gke", tgt: "eks", srcLabel: "", tgtLabel: "", targets: [], setTarget: noop, ready: true,
    sessions: [], sessionEvents: () => [], selectSession: noop, events: [], busy: false, notice: "",
    makePlan: noop, approve: vi.fn(), reject: noop, doSwitch: vi.fn(), abort: vi.fn(), resume: noop, rollback: noop, reset: noop,
    run: fakeRun({ status: "awaiting_switch", phase: "awaiting_switch" }),
    ...p,
  };
}

/** A message from the map's frame (or, with `source`, from somewhere else). */
function fromFrame(data: unknown, o: { origin?: string; source?: MessageEventSource | null } = {}) {
  const frame = screen.getByTitle("이주 지도") as HTMLIFrameElement;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: o.origin ?? window.location.origin, source: o.source === undefined ? frame.contentWindow : o.source }));
  });
}

describe("migration map frame bridge", () => {
  it("runs a command the state offers once, even when the frame sends it twice before the next render", () => {
    const v = view();
    render(<MapFrame v={v} />);
    fromFrame({ type: "hc-cmd", key: "switch" });
    fromFrame({ type: "hc-cmd", key: "switch" });
    expect(v.doSwitch).toHaveBeenCalledTimes(1);
  });

  it("ignores a command the state does not offer, and any command while busy", () => {
    const v = view();
    const { rerender } = render(<MapFrame v={v} />);
    fromFrame({ type: "hc-cmd", key: "approve" });
    expect(v.approve).not.toHaveBeenCalled();
    const busy = view({ busy: true });
    rerender(<MapFrame v={busy} />);
    fromFrame({ type: "hc-cmd", key: "switch" });
    expect(busy.doSwitch).not.toHaveBeenCalled();
  });

  it("ignores messages from another origin or another window", () => {
    const v = view();
    render(<MapFrame v={v} />);
    fromFrame({ type: "hc-cmd", key: "switch" }, { origin: "https://evil.example" });
    fromFrame({ type: "hc-cmd", key: "switch" }, { source: window });
    expect(v.doSwitch).not.toHaveBeenCalled();
  });

  it("takes the frame's height only when it is a sane number", () => {
    render(<MapFrame v={view()} />);
    const frame = screen.getByTitle("이주 지도");
    fromFrame({ type: "hc-height", h: 900 });
    expect(frame.style.height).toBe("900px");
    for (const h of [Infinity, -1, 1e9, "800"]) fromFrame({ type: "hc-height", h });
    expect(frame.style.height).toBe("900px");
  });

  it("sends the snapshot once the frame is ready, to the same origin only", () => {
    render(<MapFrame v={view()} />);
    const win = (screen.getByTitle("이주 지도") as HTMLIFrameElement).contentWindow!;
    const post = vi.spyOn(win, "postMessage");
    fromFrame({ type: "hc-ready" });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "hc-snapshot", snap: expect.objectContaining({ v: 1, src: "gcp", tgt: "aws" }) }), window.location.origin);
  });
});
