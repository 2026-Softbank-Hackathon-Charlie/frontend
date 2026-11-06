import { act, renderHook } from "@testing-library/react";
import { appRoute, navCurrent, parseRoute, useRoute } from "./router";

describe("routes", () => {
  it("opens the migration page at #migrate-app and at the old #migrate-shop", () => {
    expect(parseRoute("#migrate-app")).toBe("migrate-app");
    // links written while the sample app was shop keep working
    expect(parseRoute("#migrate-shop")).toBe("migrate-app");
    expect(navCurrent(parseRoute("#migrate-shop"))).toBe("migrate");
    // the app to migrate rides along as a query
    expect(parseRoute("#migrate-app?app=moim")).toBe("migrate-app");
  });

  it("opens an app's tabs, all under 앱", () => {
    expect(parseRoute("#app-todo-api")).toBe("app-todo-api");
    expect(appRoute("app-todo-api")).toEqual({ name: "todo-api", tab: "overview" });
    for (const tab of ["instances", "secrets", "deploys"] as const) {
      expect(parseRoute("#app-todo-api/" + tab)).toBe("app-todo-api/" + tab);
      expect(appRoute("app-todo-api/" + tab)).toEqual({ name: "todo-api", tab });
      expect(navCurrent(parseRoute("#app-todo-api/" + tab))).toBe("apps");
    }
    expect(parseRoute("#app-todo-api/nope")).toBe("overview");
    expect(parseRoute("#app-todo-api/")).toBe("overview");
  });

  it("starts a new page at the top but keeps the scroll between one app's tabs", () => {
    renderHook(() => useRoute());
    const scroll = vi.spyOn(window, "scrollTo");
    const go = (from: string, to: string) => act(() => void window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: "http://x/" + from, newURL: "http://x/" + to })));
    go("#app-todo-api", "#app-todo-api/secrets");
    go("#app-todo-api/secrets", "#app-todo-api/instances");
    go("#app-todo-api/instances", "#app-todo-api");
    expect(scroll).not.toHaveBeenCalled();
    go("#app-todo-api/secrets", "#app-notice-board/secrets");
    go("#apps", "#app-todo-api");
    go("#app-todo-api", "#deploy-dep_1");
    expect(scroll).toHaveBeenCalledTimes(3);
    scroll.mockRestore();
  });

  it("falls back to the overview for unknown routes", () => {
    expect(parseRoute("")).toBe("overview");
    expect(parseRoute("#nope")).toBe("overview");
  });

  it("opens security tabs and details under the same sidebar entry", () => {
    for (const tab of ["controls", "vulnerabilities", "findings", "sources", "ocsf"]) {
      const route = "security/" + tab;
      expect(parseRoute("#" + route)).toBe(route);
      expect(navCurrent(route)).toBe("security");
    }
    expect(parseRoute("#security/vulnerabilities/log4shell")).toBe("security/vulnerabilities/log4shell");
    expect(parseRoute("#security/findings/blocked-request")).toBe("security/findings/blocked-request");
    expect(parseRoute("#security/controls/eks-rbac")).toBe("security/controls/eks-rbac");
    expect(parseRoute("#security/nope")).toBe("overview");
    expect(parseRoute("#security/sources/unknown")).toBe("overview");
    expect(parseRoute("#security/ocsf/x")).toBe("overview");
  });

  it("keeps the page position while moving between security tabs and details", () => {
    renderHook(() => useRoute());
    const scroll = vi.spyOn(window, "scrollTo");
    act(() => window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: "http://x/#security", newURL: "http://x/#security/controls" })));
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });
});
