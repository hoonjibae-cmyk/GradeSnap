import { describe, expect, it } from "vitest";
import { isAnswerKeyName, titleFromName } from "../names";

/*
  전부 **실제로 폴더에 올라와 있는 이름**입니다. 지어낸 이름으로 재면
  이 파일은 아무것도 안 지켜 줍니다 — 여기서 막고 싶은 것은 "어느 선생님의
  정답지가 통째로 안 보이는" 사고입니다.
*/
const REAL_KEYS = [
  "08040805워드마스터unit33-34 단어 답지.pdf",
  "0827_M9(A,B)_Day1-3_재시_답지.pdf",
  "0831,0901,0903,0904_5과 본문암기 Test (1차)_답지.pdf",
  "8월27일(28일) 목(금)_미사고2_교과서 3과 어휘 test 답지_커트 -10(오답필수)_김은진T.pdf",
  "0827,0831_하남고1_2과 본문3,4_내용_답지.pdf",
];

describe("어느 파일이 정답지인가", () => {
  it.each(REAL_KEYS)("실제 정답지를 찾습니다: %s", (n) => {
    expect(isAnswerKeyName(n)).toBe(true);
  });

  it("시험지는 안 걸립니다", () => {
    expect(isAnswerKeyName("08040805워드마스터unit33-34 단어 시험지.pdf")).toBe(false);
  });

  it("🔴 학생 '답안지'는 안 걸립니다 — 사이에 '안'이 껴 있습니다", () => {
    expect(isAnswerKeyName("3반 답안지 스캔.pdf")).toBe(false);
  });

  it("'정답지'도 걸립니다", () => {
    expect(isAnswerKeyName("2과 정답지.pdf")).toBe(true);
  });

  it("오답노트는 뺍니다", () => {
    expect(isAnswerKeyName("0827_오답노트 답지.pdf")).toBe(false);
  });

  it("전각으로 적힌 이름도 같습니다", () => {
    expect(isAnswerKeyName("Ｕｎｉｔ３ 답지.pdf")).toBe(true);
  });
});

describe("파일 이름에서 제목 뽑기", () => {
  it("확장자와 '답지'를 뗍니다", () => {
    expect(titleFromName("08040805워드마스터unit33-34 단어 답지.pdf")).toBe("08040805워드마스터unit33-34 단어");
  });

  it("밑줄과 쉼표는 공백으로", () => {
    expect(titleFromName("0827_M9(A,B)_Day1-3_재시_답지.pdf")).toBe("0827 M9(A B) Day1-3 재시");
  });

  it("끝에 붙은 선생님 이름은 뗍니다", () => {
    expect(titleFromName("2과 어휘 test 답지_김은진T.pdf")).toBe("2과 어휘 test");
  });

  it("이름이 '답지'뿐이면 빈 제목 — 사람이 적어야 합니다", () => {
    expect(titleFromName("답지.pdf")).toBe("");
  });
});
