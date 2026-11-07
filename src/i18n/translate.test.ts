import { translateDom } from "./dom";
import { makeTranslator } from "./translate";

const tr = makeTranslator({
  저장: "保存",
  "높음 {0}": "高 {0}",
  "서비스 {0}개": "サービス {0}件",
  "서비스 {0}개 모두 있음": "サービス {0}件すべてあり",
  "{0}분 전": "{0}分前",
  앱: "アプリ",
  "{0} 되돌리기": "{0}を元に戻す",
});

test("exact keys keep the surrounding whitespace", () => {
  expect(tr(" 저장 ")).toBe(" 保存 ");
  expect(tr("모르는 문장")).toBeNull();
  expect(tr("HopCharlie")).toBeNull();
});

test("patterns fill holes, the more specific one first, and translate Korean hole values", () => {
  expect(tr("높음 3")).toBe("高 3");
  expect(tr("서비스 2개 모두 있음")).toBe("サービス 2件すべてあり");
  expect(tr("5분 전")).toBe("5分前");
  expect(tr("앱 되돌리기")).toBe("アプリを元に戻す");
});

test("joined lists go item by item, and runtime-built text falls back to known words", () => {
  expect(tr("서비스 1개, 앱")).toBe("サービス 1件, アプリ");
  expect(tr("AWS EKS 저장")).toBe("AWS EKS 保存");
  expect(tr("저장소")).toBeNull(); // 저장 inside a longer word stays
});

test("a pattern with little Korean of its own does not cut into a word", () => {
  const t = makeTranslator({ "{0}분": "{0}分", "{0}회{1}": "{0}回{1}" });
  expect(t("5분")).toBe("5分");
  expect(t("부분")).toBeNull();
  expect(t("조회하기")).toBeNull();
});

test("the DOM layer translates new and changed text and restores the Korean on stop", async () => {
  document.body.innerHTML = `<div id="r"><button title="저장">저장</button><span>높음 1</span><textarea>저장</textarea></div>`;
  const root = document.getElementById("r")!;
  const stop = translateDom(root, tr);
  expect(root.querySelector("button")!.textContent).toBe("保存");
  expect(root.querySelector("button")!.title).toBe("保存");
  expect(root.querySelector("textarea")!.textContent).toBe("저장");

  root.querySelector("span")!.firstChild!.nodeValue = "높음 2";
  const p = document.createElement("p");
  p.textContent = "3분 전";
  root.append(p);
  await new Promise((r) => setTimeout(r, 0));
  expect(root.querySelector("span")!.textContent).toBe("高 2");
  expect(p.textContent).toBe("3分前");

  stop();
  expect(root.querySelector("button")!.textContent).toBe("저장");
  expect(root.querySelector("span")!.textContent).toBe("높음 2");
  expect(p.textContent).toBe("3분 전");
});
