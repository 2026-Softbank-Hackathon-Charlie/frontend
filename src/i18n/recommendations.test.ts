import dictionary from "./ja.json";
import { makeTranslator } from "./translate";

const translate = makeTranslator(dictionary);
it.each([
  "AI 이전 판단",
  "판단 보류",
  "총비용 견적 · 대상 자원 여유 · 데이터 반출 정책 미확인으로 판단을 보류합니다.",
  "환경 준비 상태 · 총비용 견적 · 대상 자원 여유 등 미확인으로 판단을 보류합니다.",
  "같은 앱·운영시간의 입력 총비용은 현재 월 $100.00 → 대상 월 $40.00로, 월 $60.00 낮습니다.",
  "같은 앱·운영시간의 입력 총비용은 현재 월 $40.00 ≤ 대상 월 $100.00로, 비용상 이전 이점이 없습니다.",
  "참고용 AWS Asia Pacific (Seoul) m7i.large Linux $0.1239/시간 · 컴퓨트만, 앱 인스턴스 미확인",
])("translates the complete decision and its evidence: %s", source => {
  const value = translate(source);
  expect(value).not.toBeNull();
  expect(value).not.toMatch(/[가-힣]/);
  for (const number of source.match(/\$[\d.]+/g) ?? []) expect(value).toContain(number);
});
