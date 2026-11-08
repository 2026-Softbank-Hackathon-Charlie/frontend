import { cleanup, render, screen } from "@testing-library/react";
import { fakeRun } from "../api/fakes";
import type { Run } from "../api/types";
import type { MigrationView } from "../data/migration";
import { MigrateView } from "./Migrate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};
const view = (run: Run): MigrationView => ({
  live: false, app: "shop", stage: "run", src: "gke", tgt: "eks", srcLabel: "GCP GKE", tgtLabel: "AWS EKS", targets: [], setTarget: noop, ready: true,
  sessions: [], sessionEvents: () => [], selectSession: noop, events: [], busy: false, notice: "", run,
  makePlan: noop, approve: noop, reject: noop, doSwitch: noop, abort: noop, resume: noop, rollback: noop, reset: noop,
});

// the migration page itself, not only the popup: the page has to mount it
it("offers the completion video on the page of a migration that finished", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  render(<MigrateView v={view(fakeRun({ status: "succeeded" }))} />);
  expect(screen.getByRole("button", { name: /완료 영상 보기/ })).toBeInTheDocument();
});

it("has no video button while the migration is still running", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  render(<MigrateView v={view(fakeRun({ status: "running" }))} />);
  expect(screen.queryByRole("button", { name: /완료 영상 보기/ })).toBeNull();
});
