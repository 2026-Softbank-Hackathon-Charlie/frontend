import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HyperDXLink, hyperdxSearchUrl } from "./HyperDXLink";

afterEach(() => vi.unstubAllEnvs());

describe("hyperdxSearchUrl", () => {
  it("searches the text over the window before now", () => {
    const url = new URL(hyperdxSearchUrl("https://hyperdx.example", "moimroom", 1_700_000_000_000, 3_600_000));
    expect(url.origin + url.pathname).toBe("https://hyperdx.example/search");
    expect(url.searchParams.get("where")).toBe("moimroom");
    expect(url.searchParams.get("whereLanguage")).toBe("lucene");
    expect(url.searchParams.get("from")).toBe(String(1_700_000_000_000 - 3_600_000));
    expect(url.searchParams.get("to")).toBe("1700000000000");
  });

  it("keeps characters of the text from changing the address", () => {
    const url = new URL(hyperdxSearchUrl("https://hyperdx.example", 'a&b=c "d"', 0, 1));
    expect(url.searchParams.get("where")).toBe('a&b=c "d"');
    expect([...url.searchParams.keys()].sort()).toEqual(["from", "isLive", "to", "where", "whereLanguage"]);
  });
});

describe("HyperDXLink", () => {
  it("draws nothing without an address", () => {
    const { container } = render(<HyperDXLink text="moimroom" base="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the search page in a new tab", () => {
    render(<HyperDXLink text="moimroom" base="https://hyperdx.example" />);
    const a = screen.getByRole("link", { name: /HyperDX에서 보기/ });
    expect(a.getAttribute("href")).toMatch(/^https:\/\/hyperdx\.example\/search\?/);
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noreferrer");
  });

  it("takes the address from VITE_HYPERDX_URL only when it is an http(s) address", async () => {
    for (const [value, want] of [
      ["https://hyperdx.example/", "https://hyperdx.example"],
      ["javascript:alert(1)", ""],
      ["hyperdx.example", ""],
      ["", ""],
    ] as const) {
      vi.resetModules();
      vi.stubEnv("VITE_HYPERDX_URL", value);
      const m = await import("./HyperDXLink");
      expect(m.hyperdxBase).toBe(want);
    }
  });
});
