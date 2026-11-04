import { navCurrent, parseRoute } from "./router";

describe("routes", () => {
  it("opens the migration page at #migrate-app and at the old #migrate-shop", () => {
    expect(parseRoute("#migrate-app")).toBe("migrate-app");
    // links written while the sample app was shop keep working
    expect(parseRoute("#migrate-shop")).toBe("migrate-app");
    expect(navCurrent(parseRoute("#migrate-shop"))).toBe("migrate");
  });

  it("falls back to the overview for unknown routes", () => {
    expect(parseRoute("")).toBe("overview");
    expect(parseRoute("#nope")).toBe("overview");
  });
});
