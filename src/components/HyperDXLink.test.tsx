import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ja from "../i18n/ja.json";
import { HyperDXLink, hyperdxBase, hyperdxSearchUrl, luceneTerm, parseHyperdxBase } from "./HyperDXLink";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("parseHyperdxBase", () => {
  it.each([
    ["https://hyperdx.example", "https://hyperdx.example"],
    ["https://hyperdx.example/", "https://hyperdx.example"],
    ["  http://localhost:3000  ", "http://localhost:3000"],
    ["https://h.example/hdx/", "https://h.example/hdx"],
  ])("takes %j as %j", (raw, want) => expect(parseHyperdxBase(raw)).toBe(want));

  it.each([undefined, "", "hyperdx.example", "javascript:alert(1)", "ftp://h.example", "https://h/?a=b", "https://h/#x", "https://u:p@h.example"])(
    "takes %j as no address",
    (raw) => expect(parseHyperdxBase(raw)).toBe(""),
  );

  it("is read from VITE_HYPERDX_URL when asked", () => {
    vi.stubEnv("VITE_HYPERDX_URL", "https://hyperdx.example/");
    expect(hyperdxBase()).toBe("https://hyperdx.example");
    vi.stubEnv("VITE_HYPERDX_URL", "javascript:alert(1)");
    expect(hyperdxBase()).toBe("");
  });
});

describe("luceneTerm", () => {
  it("leaves a plain name alone and quotes the rest", () => {
    expect(luceneTerm("moimroom-mig")).toBe("moimroom-mig");
    expect(luceneTerm("run_20261107.1")).toBe("run_20261107.1");
    expect(luceneTerm("service:hopai")).toBe('"service:hopai"');
    expect(luceneTerm("two words")).toBe('"two words"');
    expect(luceneTerm('say "hi"\\')).toBe('"say \\"hi\\"\\\\"');
  });
});

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
    const url = new URL(hyperdxSearchUrl("https://hyperdx.example", "a&b=c d", 0, 1));
    expect(url.searchParams.get("where")).toBe('"a&b=c d"');
    expect([...url.searchParams.keys()].sort()).toEqual(["from", "isLive", "to", "where", "whereLanguage"]);
  });
});

describe("HyperDXLink", () => {
  it("draws nothing without an address", () => {
    const { container } = render(<HyperDXLink text="moimroom" base="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing without a term to search", () => {
    for (const text of ["", "   "]) {
      const { container, unmount } = render(<HyperDXLink text={text} base="https://hyperdx.example" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("links to the search page in a new tab", () => {
    render(<HyperDXLink text="moimroom" base="https://hyperdx.example" />);
    const a = screen.getByRole("link", { name: /HyperDX에서 보기/ });
    expect(a.getAttribute("href")).toMatch(/^https:\/\/hyperdx\.example\/search\?/);
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noreferrer");
  });

  it("searches the hour before the click, however long the page was open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T09:00:00Z"));
    render(<HyperDXLink text="moimroom" base="https://hyperdx.example" />);
    const a = screen.getByRole("link", { name: /HyperDX에서 보기/ });
    const first = Number(new URL(a.getAttribute("href")!).searchParams.get("to"));
    expect(first).toBe(Date.parse("2026-11-07T09:00:00Z"));

    vi.setSystemTime(new Date("2026-11-07T14:00:00Z"));
    fireEvent.mouseDown(a, { button: 1 }); // a middle click or a context menu starts with a mouse down
    const to = Number(new URL(a.getAttribute("href")!).searchParams.get("to"));
    const from = Number(new URL(a.getAttribute("href")!).searchParams.get("from"));
    expect(to).toBe(Date.parse("2026-11-07T14:00:00Z"));
    expect(to - from).toBe(60 * 60 * 1000);

    vi.setSystemTime(new Date("2026-11-07T15:30:00Z"));
    fireEvent.click(a);
    expect(Number(new URL(a.getAttribute("href")!).searchParams.get("to"))).toBe(Date.parse("2026-11-07T15:30:00Z"));
  });
});

describe("Japanese", () => {
  it("has a translation for every Korean string the link shows", () => {
    const dict = ja as Record<string, string>;
    expect(dict["HyperDX에서 보기"]).toBeTruthy();
    expect(dict["이 앱의 로그와 트레이스를 HyperDX에서 봅니다"]).toBeTruthy();
  });
});
