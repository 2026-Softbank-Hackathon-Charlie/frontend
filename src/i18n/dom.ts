// Swaps rendered Korean text for Japanese in place, without touching the components. A MutationObserver
// translates whatever React renders next; switching back restores the Korean each node had.
import type { Translator } from "./translate";

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
// user-typed values and code stay as they are
const SKIP = "textarea, script, style, [data-no-i18n]";

type Saved = { ko: string; ja: string };

export function translateDom(root: HTMLElement, tr: Translator): () => void {
  const texts = new Map<Text, Saved>();
  const attrs = new Map<Element, Map<string, Saved>>();
  const title = { ko: document.title, ja: "" };

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

  const doTree = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) return doText(n as Text);
    if (n.nodeType !== Node.ELEMENT_NODE || skipped(n as Element)) return;
    const el = n as Element;
    ATTRS.forEach((a) => doAttr(el, a));
    el.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(",")).forEach((c) => ATTRS.forEach((a) => doAttr(c, a)));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) doText(t as Text);
  };

  const doTitle = () => {
    if (document.title === title.ja) return;
    title.ko = document.title;
    title.ja = tr(title.ko) ?? title.ko;
    document.title = title.ja;
  };

  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") doText(r.target as Text);
      else if (r.type === "attributes") doAttr(r.target as Element, r.attributeName!);
      else r.addedNodes.forEach(doTree);
    }
    doTitle();
  });

  doTree(root);
  doTitle();
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const titleObs = new MutationObserver(doTitle);
  const head = document.querySelector("title");
  if (head) titleObs.observe(head, { childList: true, characterData: true, subtree: true });

  return () => {
    obs.disconnect();
    titleObs.disconnect();
    texts.forEach((s, t) => {
      if (t.nodeValue === s.ja) t.nodeValue = s.ko;
    });
    attrs.forEach((m, el) =>
      m.forEach((s, name) => {
        if (el.getAttribute(name) === s.ja) el.setAttribute(name, s.ko);
      }),
    );
    if (document.title === title.ja) document.title = title.ko;
  };
}
