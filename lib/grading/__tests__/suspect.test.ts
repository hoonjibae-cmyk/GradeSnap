import { describe, expect, it } from "vitest";
import { tooShort } from "../suspect";

/*
  2026-08-11 실제 답안지에서 가져온 줄들입니다. 지어낸 예가 아닙니다 —
  이 그물이 잡아야 할 것과 건드리면 안 되는 것이 한 장에 같이 있었습니다.
*/
describe("정답 처리됐지만 눈에 띄게 짧은 답", () => {
  it("문장을 쓰라고 했는데 몇 낱말만 쓴 것을 짚습니다", () => {
    // 실제로 ○로 판정됐던 두 줄.
    expect(tooShort("current carry left", "The current will carry us to the left")).toBe(true);
    expect(tooShort("current carried Karen", "But the current carried Karen to the left")).toBe(true);
  });

  it("제대로 쓴 문장은 안 건드립니다", () => {
    // 같은 답안지에서 정말로 맞은 줄들. 여기에 표시가 뜨면 그물이 쓸모없어집니다.
    expect(tooShort("the 'dangerous' tribespeople smiled.", "The 'dangerous' tribespeople smiled")).toBe(false);
    expect(tooShort("You are a student, aren't you?", "You are a student, aren't you?")).toBe(false);
    expect(tooShort("He doesn't like soccer, does he?", "He doesn't like soccer, does he?")).toBe(false);
  });

  it("문장부호와 대소문자는 낱말 수를 안 바꿉니다", () => {
    expect(tooShort("Stop! Leave her alone!", "Stop, leave her alone")).toBe(false);
  });

  it("단어 시험은 아예 안 봅니다 — 정답이 짧으면 길이로 말할 것이 없습니다", () => {
    expect(tooShort("apple", "apple")).toBe(false);
    expect(tooShort("분류", "분류하다")).toBe(false);
    expect(tooShort("", "의도")).toBe(false);
  });

  it("빈 답은 여기서 다루지 않습니다 — 무응답은 이미 오답입니다", () => {
    // 판정이 ○일 때만 부르는 함수라, 빈 답이 들어올 일 자체가 없습니다.
    // 그래도 문장 정답이면 짧다고 말하는 것이 맞습니다.
    expect(tooShort("", "The current will carry us to the left")).toBe(true);
  });
});
