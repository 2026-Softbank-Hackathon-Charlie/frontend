import { render, screen } from "@testing-library/react";
import { RoutesView } from "./shared";

describe("route result measurements", () => {
  it("shows measured zero counts even without an optional finish timestamp", () => {
    render(<RoutesView routes={[{ source: "eks", target: "gke", status: "succeeded", runId: "run_zero", result: { missingRows: 0, missingWrites: 0, missingFiles: 0, failedRequests: 0, requests: 0 } }]} />);
    expect(screen.getByRole("cell", { name: "0 / 0 / 0" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0건" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0" })).toBeInTheDocument();
  });

  it("does not replace an unmeasured count with zero", () => {
    render(<RoutesView routes={[{ source: "eks", target: "gke", status: "succeeded", finishedAt: "2026-11-07T00:00:00Z", result: { missingRows: 0, missingFiles: 2 } }]} />);
    expect(screen.getByRole("cell", { name: "0 / 미측정 / 2" })).toBeInTheDocument();
  });

  it("does not invent measurements for a route without a run", () => {
    render(<RoutesView routes={[{ source: "eks", target: "gke" }]} />);
    expect(screen.getByText("미실행")).toBeInTheDocument();
    expect(screen.queryByText("0 / 0 / 0")).not.toBeInTheDocument();
  });
});
