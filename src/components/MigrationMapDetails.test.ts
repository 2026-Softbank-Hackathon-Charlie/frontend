import html from "../../public/migration-map-live.html?raw";

describe("migration map detail disclosure", () => {
  it("opens validation explanations with detail and hides them with simple", () => {
    const page = new DOMParser().parseFromString(html, "text/html");
    document.body.innerHTML = page.body.innerHTML;
    localStorage.removeItem("hc.stepView");
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {} }));
    vi.stubGlobal("requestAnimationFrame", () => 0);
    try {
      window.eval(page.querySelector("script")!.textContent!);
      const panel = document.getElementById("validations")!;
      const detail = document.querySelector<HTMLButtonElement>('[data-view="detail"]')!;
      const simple = document.querySelector<HTMLButtonElement>('[data-view="simple"]')!;
      expect(panel.hidden).toBe(true);
      detail.click();
      expect(panel.hidden).toBe(false);
      expect(detail).toHaveAttribute("aria-pressed", "true");
      expect(detail).toHaveAttribute("aria-controls", panel.id);
      simple.click();
      expect(panel.hidden).toBe(true);
      expect(detail).toHaveAttribute("aria-pressed", "false");
    } finally {
      vi.unstubAllGlobals();
      document.body.replaceChildren();
      localStorage.removeItem("hc.stepView");
    }
  });
});
