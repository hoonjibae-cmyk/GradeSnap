import { describe, expect, it } from "vitest";
import { markHidden, oddChars } from "../invisible";
import { norm } from "../grading/text";

const ZWSP = "\u200b";
const CYRILLIC_E = "\u0435";

describe("안 보이는 문자 드러내기", () => {
  it("멀쩡한 글자는 안 건드린다", () => {
    expect(markHidden("frequent")).toBe("frequent");
    expect(markHidden("무대 장치의")).toBe("무대 장치의");
  });

  it("폭 없는 공백을 자리째 보여준다", () => {
    expect(markHidden(`freq${ZWSP}uent`)).toBe("freq⟨U+200B⟩uent");
  });

  it("BOM·soft hyphen처럼 안 보이는 것들도", () => {
    expect(markHidden("\ufeff답")).toBe("⟨U+FEFF⟩답");
    expect(markHidden("re\u00adquest")).toBe("re⟨U+00AD⟩quest");
  });

  it("드러내고 나면 화면에서 두 쪽이 달라 보인다", () => {
    /*
      이게 목적입니다. `frequent → frequent`처럼 같아 보이는 짝이 뜨면
      원장님은 화면을 못 믿게 되고, 그러면 진짜 고쳐 읽기가 있는 줄까지
      같이 흘려보냅니다.
    */
    const a = `frequent${ZWSP}`;
    const b = "frequent";
    expect(norm(a)).not.toBe(norm(b)); // '다른 칸'으로 잡히는 이유
    expect(markHidden(a)).not.toBe(markHidden(b)); // 이제 눈에 보입니다
  });
});

describe("예상 밖 문자 짚어내기", () => {
  it("영어와 한글만 있으면 아무 말도 안 한다", () => {
    // 흔한 차이에 매번 주석이 붙으면 화면이 시끄러워집니다.
    expect(oddChars("requirement")).toBeNull();
    expect(oddChars("무대 장치의")).toBeNull();
    expect(oddChars("~하는 데 시간을 쓰다 (spend)")).toBeNull();
  });

  it("모양만 같은 다른 글자를 짚는다", () => {
    // 키릴 е(U+0435)와 라틴 e(U+0065). NFKC도 안 합칩니다 — 합치면 안 되고요.
    const cyrillic = `fr${CYRILLIC_E}quent`;
    expect(norm(cyrillic)).not.toBe(norm("frequent"));
    expect(oddChars(cyrillic)).toBe(`${CYRILLIC_E} U+0435`);
  });

  it("같은 글자가 여러 번이어도 한 번만 적는다", () => {
    expect(oddChars(`${CYRILLIC_E}${CYRILLIC_E}`)).toBe(`${CYRILLIC_E} U+0435`);
  });

  it("안 보이는 문자는 여기서 다시 말하지 않는다", () => {
    // markHidden이 이미 드러냅니다. 두 번 말하면 잔소리입니다.
    expect(oddChars(`frequent${ZWSP}`)).toBeNull();
  });
});
