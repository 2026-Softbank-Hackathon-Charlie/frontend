import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { App } from "../api/types";
import { AppsList } from "./deploy";
import { Table, td } from "./ui";

const app: App = { name: "docker-doom", namespace: "docker-doom", database: { name: "", user: "", schemas: [] }, environments: [],
  deploy: { repo: "org/docker-doom", branch: "main", environments: ["gke", "onprem"], autoDeploy: false, spec: { name: "docker-doom", services: [], resources: [] },
    url: "https://docker-doom.hopcharlie.dev", specCommit: "a", createdAt: "2026-11-08T00:00:00Z", createdBy: "test", status: [{ env: "gke", status: "healthy" }, { env: "onprem", status: "healthy" }], instances: [] } };

it("makes the full app table keyboard reachable without hiding URLs, status text or actions", async () => {
  const observe = vi.fn(), user = userEvent.setup();
  render(<AppsList apps={[app]} now={Date.now()} full onObserve={observe} />);
  const scroller = screen.getByRole("region", { name: "앱 목록" });
  await user.tab(); expect(scroller).toHaveFocus();
  await user.tab(); expect(screen.getByRole("link", { name: "docker-doom" })).toHaveFocus();
  expect(within(scroller).getAllByRole("columnheader")).toHaveLength(6);
  const url = within(scroller).getByRole("link", { name: app.deploy!.url! });
  expect(url).toHaveAttribute("href", app.deploy!.url);
  expect(url).toHaveAttribute("rel", "noreferrer");
  const status = scroller.querySelectorAll(".sr-only");
  expect(status).toHaveLength(3);
  expect([...status].some(element => element.textContent?.includes("정상"))).toBe(true);
  for (const element of status) expect(element).not.toHaveAttribute("aria-hidden", "true");
  await user.click(within(scroller).getByRole("button", { name: "docker-doom 관측" }));
  expect(observe).toHaveBeenCalledExactlyOnceWith("docker-doom");
  expect(within(scroller).getByRole("link", { name: "이전" })).toHaveAttribute("href", "#migrate-app?app=docker-doom");
});

it("preserves the compact overview list and does not add focus stops to unrelated tables", () => {
  render(<><AppsList apps={[app]} now={Date.now()} full={false} /><Table head={["다른 표"]} rows={[[td("값")]]} /></>);
  const scroller = screen.getByRole("region", { name: "앱 목록" });
  expect(within(scroller).getAllByRole("columnheader")).toHaveLength(4);
  expect(within(scroller).getByRole("link", { name: app.deploy!.url! })).toHaveAttribute("href", app.deploy!.url);
  const other = screen.getByRole("columnheader", { name: "다른 표" }).closest(".scroll")!;
  expect(other).not.toHaveAttribute("tabindex");
  expect(other).not.toHaveAttribute("role");
});
