import { describe, expect, it } from "vitest";
import { FIXED_INPUT_PER_PAGE, imageTokens, split } from "../tokens";
import type { Usage } from "@/lib/grading/types";

const u = (input: number, output: number): Usage => ({
  latencyMs: 1000,
  inputTokens: input,
  outputTokens: output,
  model: "claude-opus-5",
  effort: "low",
});

describe("단계 가르기", () => {
  it("마지막 호출이 판정, 나머지가 전사", () => {
    const s = split([{ token_usage: [u(5000, 3000), u(5000, 2800), u(1500, 900)] }]);
    expect(s.transcribe).toEqual({ calls: 2, inputTokens: 10000, outputTokens: 5800 });
    expect(s.judge).toEqual({ calls: 1, inputTokens: 1500, outputTokens: 900 });
    expect(s.pages).toBe(2);
    expect(s.sheets).toBe(1);
  });

  it("호출이 하나뿐이면 판정이 없는 것 — 전사로 센다", () => {
    // 판정 전에 터진 채점입니다. 그걸 판정으로 세면 판정이 사진값을 뒤집어씁니다.
    const s = split([{ token_usage: [u(5000, 3000)] }]);
    expect(s.transcribe.calls).toBe(1);
    expect(s.judge.calls).toBe(0);
    expect(s.pages).toBe(1);
  });

  it("기록이 없는 답안지는 안 센다", () => {
    // 0으로 세면 장당 평균이 조용히 낮아집니다.
    const s = split([{ token_usage: null }, { token_usage: [] }]);
    expect(s.sheets).toBe(0);
    expect(s.pages).toBe(0);
  });

  it("여러 답안지를 더한다", () => {
    const s = split([
      { token_usage: [u(5000, 3000), u(1500, 900)] },
      { token_usage: [u(4000, 1000), u(1200, 400)] },
    ]);
    expect(s.sheets).toBe(2);
    expect(s.pages).toBe(2);
    expect(s.transcribe.inputTokens).toBe(9000);
    expect(s.judge.inputTokens).toBe(2700);
  });
});

describe("사진이 몇 토큰인가", () => {
  it("고정분을 빼고 남는 것이 사진", () => {
    /*
      이 값이 **해상도를 줄일 값어치**를 정합니다. 사진이 입력의 9할이면
      크고, 절반이면 생각보다 작습니다. §13.22에서 이걸 안 재고 "월 64만"
      이라고 적었는데 그건 산수였지 실측이 아니었습니다.
    */
    const s = split([{ token_usage: [u(5000, 3000), u(1500, 900)] }]);
    expect(imageTokens(s, FIXED_INPUT_PER_PAGE)).toBe(5000 - 750);
  });

  it("고정분이 입력보다 크면 0 — 음수를 내지 않는다", () => {
    const s = split([{ token_usage: [u(300, 100), u(200, 50)] }]);
    expect(imageTokens(s, FIXED_INPUT_PER_PAGE)).toBe(0);
  });

  it("전사가 없으면 0", () => {
    expect(imageTokens(split([]), FIXED_INPUT_PER_PAGE)).toBe(0);
  });
});
