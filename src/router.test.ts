import { appRoute, navCurrent, parseRoute } from "./router";

describe("routes", () => {
  it("opens the migration page at #migrate-app and at the old #migrate-shop", () => {
    expect(parseRoute("#migrate-app")).toBe("migrate-app");
    // links written while the sample app was shop keep working
    expect(parseRoute("#migrate-shop")).toBe("migrate-app");
    expect(navCurrent(parseRoute("#migrate-shop"))).toBe("migrate");
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

  it("falls back to the overview for unknown routes", () => {
    expect(parseRoute("")).toBe("overview");
    expect(parseRoute("#nope")).toBe("overview");
  });
});
