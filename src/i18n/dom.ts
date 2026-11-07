// Swaps rendered Korean text for Japanese in place, without touching the components. A MutationObserver
// translates whatever React renders next; switching back restores the Korean each node had. Same-origin
// iframes (the migration map) get their own pass, and so do the values of read-only inputs.
import type { Translator } from "./translate";

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
// user-typed values and raw data (the OCSF JSON) stay as they are
const SKIP = "textarea, script, style, code, pre.code, [data-no-i18n]";

type Saved = { ko: string; ja: string };

export function translateDom(root: HTMLElement, tr: Translator): () => void {
  const doc = root.ownerDocument;
  const texts = new Map<Text, Saved>();
  const attrs = new Map<Element, Map<string, Saved>>();
  const values = new Map<HTMLInputElement, Saved>();
  const frames = new Map<HTMLIFrameElement, { onLoad: () => void; stop: (() => void) | null }>();
  const title = { ko: doc.title, ja: "" };
  const lang = doc.documentElement.lang;
  doc.documentElement.lang = "ja";

  const skipped = (el: Element | null) => !!el?.closest(SKIP);

  const doText = (t: Text) => {
    const v = t.nodeValue ?? "";
    const saved = texts.get(t);
    if (saved && v === saved.ja) return; // our own write
    if (skipped(t.parentElement)) return;
    const ja = tr(v);
    if (ja === null || ja === v) {
      texts.delete(t);
      return;
    }
    texts.set(t, { ko: v, ja });
    t.nodeValue = ja;
  };

  const doAttr = (el: Element, name: string) => {
    const v = el.getAttribute(name);
    if (v === null) return;
    const saved = attrs.get(el)?.get(name);
    if (saved && v === saved.ja) return;
    const ja = tr(v);
    if (ja === null || ja === v) return;
    if (!attrs.has(el)) attrs.set(el, new Map());
    attrs.get(el)!.set(name, { ko: v, ja });
    el.setAttribute(name, ja);
  };

  // A read-only input shows text the console wrote ("AWS EKS (지금 쓰기를 받는 곳)"). React compares and
  // sets its value on every render, so the element answers React with the Korean and shows the Japanese.
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  const doValues = () =>
    root.querySelectorAll<HTMLInputElement>("input[readonly]").forEach((el) => {
      if (values.has(el)) return;
      const saved = { ko: el.value, ja: "" };
      const show = () => {
        saved.ja = tr(saved.ko) ?? saved.ko;
        native.set!.call(el, saved.ja);
      };
      if (tr(saved.ko) === null) return;
      values.set(el, saved);
      Object.defineProperty(el, "value", {
        configurable: true,
        get: () => saved.ko,
        set: (v: string) => {
          saved.ko = String(v);
          show();
        },
      });
      show();
    });

  const doFrame = (f: HTMLIFrameElement) => {
    if (frames.has(f)) return;
    const entry = { stop: null as (() => void) | null, onLoad: () => {} };
    const start = () => {
      entry.stop?.();
      entry.stop = null;
      let body: HTMLElement | null = null;
      try {
        body = f.contentDocument?.body ?? null; // null for another origin
      } catch {
        body = null;
      }
      if (body && f.contentDocument!.readyState !== "loading") entry.stop = translateDom(body, tr);
    };
    entry.onLoad = start;
    f.addEventListener("load", start);
    frames.set(f, entry);
    if (f.contentDocument?.URL !== "about:blank") start();
  };

  const doTree = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) return doText(n as Text);
    if (n.nodeType !== Node.ELEMENT_NODE || skipped(n as Element)) return;
    const el = n as Element;
    ATTRS.forEach((a) => doAttr(el, a));
    el.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(",")).forEach((c) => ATTRS.forEach((a) => doAttr(c, a)));
    if (el.tagName === "IFRAME") doFrame(el as HTMLIFrameElement);
    el.querySelectorAll("iframe").forEach(doFrame);
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) doText(t as Text);
  };

  const doTitle = () => {
    if (doc.title === title.ja) return;
    title.ko = doc.title;
    title.ja = tr(title.ko) ?? title.ko;
    doc.title = title.ja;
  };

  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") doText(r.target as Text);
      else if (r.type === "attributes") doAttr(r.target as Element, r.attributeName!);
      else r.addedNodes.forEach(doTree);
    }
    doValues();
    doTitle();
  });

  doTree(root);
  doValues();
  doTitle();
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const titleObs = new MutationObserver(doTitle);
  const head = doc.querySelector("title");
  if (head) titleObs.observe(head, { childList: true, characterData: true, subtree: true });

  return () => {
    obs.disconnect();
    titleObs.disconnect();
    frames.forEach((e, f) => {
      f.removeEventListener("load", e.onLoad);
      e.stop?.();
    });
    texts.forEach((s, t) => {
      if (t.nodeValue === s.ja) t.nodeValue = s.ko;
    });
    attrs.forEach((m, el) =>
      m.forEach((s, name) => {
        if (el.getAttribute(name) === s.ja) el.setAttribute(name, s.ko);
      }),
    );
    values.forEach((s, el) => {
      delete (el as { value?: string }).value;
      native.set!.call(el, s.ko);
    });
    if (doc.title === title.ja) doc.title = title.ko;
    doc.documentElement.lang = lang;
  };
}
