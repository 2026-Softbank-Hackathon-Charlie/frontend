import { useEffect, useState } from "react";
import { translateDom } from "./dom";
import { makeTranslator } from "./translate";
import "./lang.css";

type Lang = "ko" | "ja";
const KEY = "hopcharlie.lang";

function stored(): Lang {
  try {
    return localStorage.getItem(KEY) === "ja" ? "ja" : "ko";
  } catch {
    return "ko";
  }
}

/** Floating button at the bottom right that switches the console between Korean and Japanese. */
export function LangToggle() {
  const [lang, setLang] = useState<Lang>(stored);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // private window: the choice lasts for this page only
    }
    document.documentElement.lang = lang;
    if (lang !== "ja") return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import("./ja.json").then((m) => {
      if (!cancelled) stop = translateDom(document.body, makeTranslator(m.default));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [lang]);

  const next = lang === "ko" ? "ja" : "ko";
  return (
    <button
      type="button"
      className="lang-fab"
      data-no-i18n
      onClick={() => setLang(next)}
      aria-label={next === "ja" ? "日本語に切り替え" : "한국어로 전환"}
      title={next === "ja" ? "日本語に切り替え" : "한국어로 전환"}
    >
      <span aria-hidden="true" className={lang === "ko" ? "on" : undefined}>
        가
      </span>
      <span aria-hidden="true" className="sep">
        /
      </span>
      <span aria-hidden="true" className={lang === "ja" ? "on" : undefined}>
        あ
      </span>
    </button>
  );
}
