import { describe, expect, it } from "vitest";
import { bigrams, dice, itemScore, matchAnswerKey, numbers, titleScore } from "../match";
import type { KeyCandidate, SheetShape } from "../match";

const key = (title: string, items: { no: string; expected: string; prompt?: string }[] = []): KeyCandidate => ({
  slug: title.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "),
  title,
  items,
});

const sheet = (title: string, prompts: string[] = []): SheetShape => ({
  title,
  items: prompts.map((p, i) => ({ no: String(i + 1), prompt: p })),
});

/** 워드마스터 60문항 — 실제 정답지에서 뽑은 모양입니다. */
const WORDS = [
  "abandon", "abolish", "abrupt", "absorb", "abstract", "absurd", "abundant", "accelerate",
  "accommodate", "accompany", "accomplish", "accord", "accumulate", "accurate", "accuse", "acknowledge",
];
const wmItems = WORDS.map((w, i) => ({ no: String(i + 1), expected: `뜻${i}`, prompt: w }));

describe("재료", () => {
  it("글자 2연쇄는 공백을 무시합니다 — 'unit 33'과 'unit33'은 같은 시험입니다", () => {
    expect(dice(bigrams("unit 33"), bigrams("unit33"))).toBe(1);
  });

  it("숫자는 앞의 0을 뗍니다 — 0804와 804는 같은 날입니다", () => {
    expect(numbers("0804 unit 33-34")).toEqual(new Set([804, 33, 34]));
  });

  it("붙여 쓴 긴 숫자 덩어리는 버립니다 — 시험을 가르지 못하면서 비율만 깎습니다", () => {
    expect(numbers("08040805워드마스터unit33-34")).toEqual(new Set([33, 34]));
  });

  it("전각 숫자도 같은 숫자입니다 (PDF 머리글이 전각으로 인쇄됩니다)", () => {
    expect(numbers("Unit ３３－３４")).toEqual(new Set([33, 34]));
  });
});

describe("제목 점수", () => {
  it("똑같으면 1", () => {
    expect(titleScore("Ch.13 문법", "Ch.13 문법")).toBe(1);
  });

  it("따옴표 하나 차이는 넘어갑니다 — 이것 때문에 이 파일이 있습니다", () => {
    const s = titleScore('M4 워드마스터 중등실력 "Unit 33-34', "M4 워드마스터 중등실력 Unit 33-34");
    expect(s).toBeGreaterThan(0.9);
  });

  it("파일 이름에서 온 제목과 머리글이 달라도 붙습니다", () => {
    const s = titleScore("M4 워드마스터 중등실력 Unit 33-34", "08040805워드마스터unit33-34 단어");
    expect(s).toBeGreaterThan(0.6);
  });

  it("🔴 숫자가 하나도 안 겹치면 0 — 글자가 아무리 닮아도", () => {
    expect(titleScore("워드마스터 Unit 33-34", "워드마스터 Unit 35-36")).toBe(0);
  });

  it("🔴 날짜만 같고 단원이 다르면 문턱을 못 넘습니다", () => {
    // 숫자 {804,33,34} vs {804,35,36} — 804가 겹쳐 즉시 탈락은 아니지만,
    // 숫자 몫이 1/5로 깎여 0.6에 못 미칩니다.
    expect(titleScore("0804 워드마스터 Unit 33-34", "0804 워드마스터 Unit 35-36")).toBeLessThan(0.6);
  });

  it("숫자가 한쪽에만 없으면 글자만 봅니다", () => {
    expect(titleScore("문법 추가시험", "문법 추가시험 3회")).toBeGreaterThan(0.6);
  });

  it("빈 제목은 0 — 못 읽은 제목으로 아무거나 붙이지 않습니다", () => {
    expect(titleScore("", "Ch.13 문법")).toBe(0);
  });
});

describe("문항 점수", () => {
  it("제시어가 없는 정답지(사진 등록)는 0 — 문항으로 못 맞춥니다", () => {
    const k = key("아무거나", [{ no: "1", expected: "x" }]);
    expect(itemScore(sheet("t", ["abandon"]), k).count).toBe(0);
  });

  it("겹친 개수를 셉니다", () => {
    const r = itemScore(sheet("t", ["abandon", "abolish", "없는말"]), key("k", wmItems));
    expect(r.count).toBe(2);
  });
});

describe("정답지 고르기", () => {
  it("등록된 정답지가 없으면 null", () => {
    expect(matchAnswerKey(sheet("t"), []).match).toBeNull();
  });

  it("① 제목이 같으면 그대로 — 지금까지의 경로", () => {
    const k = key("Ch.13 문법 추가시험");
    const r = matchAnswerKey(sheet("Ch.13 문법 추가시험"), [k]);
    expect(r.match?.how).toBe("제목");
    expect(r.match?.key.slug).toBe(k.slug);
  });

  it("① 대소문자·전각만 다른 것도 '제목'입니다", () => {
    const k = key("Unit 33-34 Word Test");
    expect(matchAnswerKey(sheet("unit 33-34 word test"), [k]).match?.how).toBe("제목");
  });

  it("② 제목이 조금 다르면 '제목 근사'로 붙고, 그렇게 적힙니다", () => {
    const k = key("M4 워드마스터 중등실력 Unit 33-34", wmItems);
    const r = matchAnswerKey(sheet('M4 워드마스터 중등실력 "Unit 33-34'), [k]);
    expect(r.match?.how).toBe("제목 근사");
    expect(r.match?.why).toContain("비슷합니다");
  });

  it("🔴 ② 옆 단원 정답지는 안 붙습니다 — 이게 이 파일의 존재 이유입니다", () => {
    const k = key("워드마스터 Unit 35-36", wmItems);
    const r = matchAnswerKey(sheet("워드마스터 Unit 33-34"), [k]);
    expect(r.match).toBeNull();
  });

  it("🔴 ② 비슷한 후보가 둘이면 아무것도 안 고르고 이름을 돌려줍니다", () => {
    // 숫자를 똑같이 두어 글자만으로 겨루게 합니다 — 둘 다 문턱은 넘습니다.
    const a = key("3과 본문 암기 테스트 A");
    const b = key("3과 본문 암기 테스트 B");
    const r = matchAnswerKey(sheet("3과 본문 암기 테스트"), [a, b]);
    expect(r.match).toBeNull();
    expect(r.ambiguous.map((x) => x.title).sort()).toEqual([a.title, b.title]);
  });

  it("③ 제목을 아예 못 읽어도 제시어가 겹치면 붙습니다", () => {
    const k = key("08040805워드마스터unit33-34 단어", wmItems);
    const r = matchAnswerKey(sheet("", WORDS), [k]);
    expect(r.match?.how).toBe("문항");
    expect(r.match?.why).toContain("제시어");
  });

  it("③ 제시어가 다섯 개 미만이면 안 붙습니다 — 우연일 수 있습니다", () => {
    const k = key("쪽지시험", wmItems.slice(0, 4));
    const r = matchAnswerKey(sheet("전혀 다른 제목"), [k]);
    expect(r.match).toBeNull();
  });

  it("③ 제시어가 겹치는 정답지가 둘이면 안 고릅니다", () => {
    const a = key("A 시험", wmItems);
    const b = key("B 시험", wmItems);
    expect(matchAnswerKey(sheet("모르는 제목", WORDS), [a, b]).match).toBeNull();
  });

  it("🔴 제목과 제시어가 서로 다른 정답지를 가리키면 아무것도 안 고릅니다", () => {
    const byTitle = key("Ch.13 문법 추가시험");
    const byItems = key("전혀 다른 시험", wmItems);
    const r = matchAnswerKey(sheet("Ch.13 문법 추가시험 2", WORDS), [byTitle, byItems]);
    expect(r.match).toBeNull();
    expect(r.ambiguous).toHaveLength(2);
  });

  it("제목이 같으면 제시어가 어긋나도 이깁니다 — 사람이 정한 것이 셉니다", () => {
    const exact = key("Ch.13 문법", []);
    const other = key("전혀 다른 시험", wmItems);
    const r = matchAnswerKey(sheet("Ch.13 문법", WORDS), [exact, other]);
    expect(r.match?.how).toBe("제목");
    expect(r.match?.key.slug).toBe(exact.slug);
  });

  it("아무것도 안 걸리면 후보도 비어 있습니다", () => {
    const r = matchAnswerKey(sheet("무관한 시험"), [key("워드마스터 Unit 1-2", wmItems)]);
    expect(r.match).toBeNull();
    expect(r.ambiguous).toEqual([]);
  });
});
