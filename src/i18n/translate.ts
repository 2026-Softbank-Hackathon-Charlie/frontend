// Korean to Japanese lookup for rendered UI text. The dictionary is keyed by the Korean source strings
// (whitespace collapsed); a key with {0}, {1}... is a pattern whose holes match any text.

export type Dict = Record<string, string>;
export type Translator = (text: string) => string | null;

const HANGUL = /[가-힣]/;
const HOLE = /\{(\d+)\}/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds a lookup from the dictionary. It returns null for text it does not know, so the caller keeps the Korean. */
export function makeTranslator(dict: Dict): Translator {
  const exact = new Map<string, string>();
  const patterns: { re: RegExp; holes: number[]; ja: string; weight: number }[] = [];
  for (const [ko, ja] of Object.entries(dict)) {
    if (!ja) continue;
    if (!/\{\d+\}/.test(ko)) {
      exact.set(ko, ja);
      continue;
    }
    const holes: number[] = [];
    const src = ko
      .split(HOLE)
      .map((part, i) => {
        if (i % 2 === 0) return escapeRe(part);
        holes.push(Number(part));
        return "([\\s\\S]+?)";
      })
      .join("");
    // more fixed text first, so "서비스 {0}개 모두 있음" wins over "서비스 {0}개"
    patterns.push({ re: new RegExp("^" + src + "$"), holes, ja, weight: ko.replace(HOLE, "").length });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  // last resort for text built at runtime ("AWS EKS 정상"): known phrases, longest first, not inside a longer word
  const keys = [...exact.keys()].filter((k) => HANGUL.test(k)).sort((a, b) => b.length - a.length);
  const words = keys.length ? new RegExp("(?<![가-힣])(?:" + keys.map(escapeRe).join("|") + ")(?![가-힣])", "g") : null;

  const lookup = (core: string, depth: number): string | null => {
    const hit = exact.get(core);
    if (hit !== undefined) return hit;
    // a joined list: each item on its own, so a pattern hole does not swallow the commas
    if (depth === 0 && core.includes(", ")) {
      const parts = core.split(", ");
      const out = parts.map((p) => lookup(p, 1) ?? p);
      if (out.some((o, i) => o !== parts[i])) return out.join(", ");
    }
    const viaPattern = matchPattern(core, depth);
    if (viaPattern !== null) return viaPattern;
    if (!words) return null;
    const replaced = core.replace(words, (w) => exact.get(w)!);
    return replaced === core ? null : replaced;
  };

  const matchPattern = (core: string, depth: number): string | null => {
    for (const p of patterns) {
      const m = p.re.exec(core);
      if (!m) continue;
      const values: Record<number, string> = {};
      p.holes.forEach((h, i) => {
        const v = m[i + 1];
        values[h] = depth < 2 && HANGUL.test(v) ? (lookup(v.trim(), depth + 1) ?? v) : v;
      });
      return p.ja.replace(HOLE, (_, n: string) => values[Number(n)] ?? "");
    }
    return null;
  };

  return (text) => {
    if (!HANGUL.test(text)) return null;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    const out = lookup(m[2].replace(/\s+/g, " "), 0);
    return out === null ? null : m[1] + out + m[3];
  };
}
