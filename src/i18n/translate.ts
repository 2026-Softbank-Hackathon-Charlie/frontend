// Korean to Japanese lookup for rendered UI text. The dictionary is keyed by the Korean source strings
// (whitespace collapsed); a key with {0}, {1}... is a pattern whose holes match any text.

export type Dict = Record<string, string>;
export type Translator = (text: string) => string | null;

const HANGUL = /[가-힣]/;
const HOLE = /\{(\d+)\}/g;

// a particle after a hole ("{0}이 전환…", "{0}을") ends a word, so a Korean value before it is whole
const PARTICLE = /^(?:이|가|을|를|은|는|의|에|에서|로|으로|와|과|도|만|까지|부터)(?![가-힣])/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds a lookup from the dictionary. It returns null for text it does not know, so the caller keeps the Korean. */
export function makeTranslator(dict: Dict): Translator {
  const exact = new Map<string, string>();
  // cut[i]: hole i touches Korean in the fixed text (before, after), where a Korean value would mean a word was split
  const patterns: { re: RegExp; holes: number[]; cut: [boolean, boolean][]; ja: string; weight: number }[] = [];
  for (const [ko, ja] of Object.entries(dict)) {
    if (!ja) continue;
    if (!/\{\d+\}/.test(ko)) {
      exact.set(ko, ja);
      continue;
    }
    const holes: number[] = [];
    const cut: [boolean, boolean][] = [];
    const parts = ko.split(HOLE);
    const src = parts
      .map((part, i) => {
        if (i % 2 === 0) return escapeRe(part);
        holes.push(Number(part));
        cut.push([HANGUL.test(parts[i - 1].slice(-1)), HANGUL.test(parts[i + 1].charAt(0)) && !PARTICLE.test(parts[i + 1])]);
        return "([\\s\\S]+?)";
      })
      .join("");
    // more fixed text first, so "서비스 {0}개 모두 있음" wins over "서비스 {0}개"
    patterns.push({ re: new RegExp("^" + src + "$"), holes, cut, ja, weight: ko.replace(HOLE, "").length });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  // last resort for text built at runtime ("AWS EKS 정상"): known phrases, longest first, not inside a longer word
  // only phrases that start and end on a word or bracket: "· 생성" would eat the 생성 of "생성 전"
  const keys = [...exact.keys()]
    .filter((k) => HANGUL.test(k) && /^[가-힣\w(]/.test(k) && /[가-힣\w)]$/.test(k))
    .sort((a, b) => b.length - a.length);
  const words = keys.length ? new RegExp("(?<![가-힣])(?:" + keys.map(escapeRe).join("|") + ")(?![가-힣])", "g") : null;

  const lookup = (core: string, depth: number): string | null => {
    const hit = exact.get(core);
    if (hit !== undefined) return hit;
    // sentences joined at runtime ("…만들었습니다." + " 도구 호출 4회…"): each sentence on its own
    if (depth === 0) {
      const sentences = core.split(/(?<=[.!?]) (?=\S)/);
      if (sentences.length > 1) {
        const joined = sentences.map((x) => lookup(x, 0) ?? x).join(" "); // one sentence each: no further split
        if (!HANGUL.test(joined)) return joined;
      }
    }
    // a joined list: each item on its own, so a pattern hole does not swallow the commas
    if (depth === 0 && core.includes(", ")) {
      const parts = core.split(", ");
      const out = parts.map((p) => lookup(p, 1) ?? p);
      const joined = out.join(", ");
      if (!HANGUL.test(joined)) return joined;
    }
    const viaPattern = matchPattern(core, depth);
    if (viaPattern !== null) return viaPattern;
    // items joined at runtime with " · " (the reasons of a recommendation): each item on its own
    if (depth === 0 && core.includes(" · ")) {
      const joined = core.split(" · ").map((x) => lookup(x, 0) ?? x).join(" · ");
      if (!HANGUL.test(joined)) return joined;
    }
    // half-translated text reads worse than the Korean, so a phrase swap counts only when nothing Korean is left
    if (!words) return null;
    const replaced = core.replace(words, (w) => exact.get(w)!);
    return replaced === core || HANGUL.test(replaced) ? null : replaced;
  };

  const matchPattern = (core: string, depth: number): string | null => {
    next: for (const p of patterns) {
      const m = p.re.exec(core);
      if (!m) continue;
      const values: Record<number, string> = {};
      for (let i = 0; i < p.holes.length; i++) {
        const v = m[i + 1];
        // "{0}회" must not take the 조 of "조회", nor "{0}분" the 부 of "부분"
        if ((p.cut[i][0] && HANGUL.test(v.charAt(0))) || (p.cut[i][1] && HANGUL.test(v.slice(-1)))) continue next;
        if (HANGUL.test(v)) {
          const t = depth < 2 ? lookup(v.trim(), depth + 1) : null;
          if (t === null) continue next; // a Korean hole left in a Japanese sentence
          values[p.holes[i]] = v.replace(v.trim(), t);
        } else values[p.holes[i]] = v;
      }
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
