import { describe, expect, it } from "vitest";
import { compare } from "../compare";
import { isOpen, isUnjudged, splitUnjudged, unjudgedWarning, UNJUDGED } from "../unjudged";
import type { JudgeResult } from "../types";

/*
  2026-08-11. 순서배열·문장삽입 문항에서 정답이 통째로 틀리게 나왔습니다.

  판정 단계는 이미지를 안 봅니다 — 전사된 {번호, 제시어, 학생 답}만 받습니다.
  순서배열의 정답은 그 문항의 **지문**에 달려 있고 지문은 전사에 안 담깁니다.
  모델은 알 수 없는 자리에서 추측했고, 추측한 정답으로 학생을 재시험에
  남겼습니다.

  여기서 재는 것은 **모르는 것이 오답으로 세어지지 않는가**입니다.
*/

const r = (no: string, correct: boolean, note = ""): JudgeResult => ({ no, correct, expected: "x", note });

describe("정답을 알 수 없는 문항", () => {
  it("표시를 알아봅니다", () => {
    expect(isUnjudged({ note: UNJUDGED })).toBe(true);
    expect(isUnjudged({ note: "정답모름 — 지문 필요" })).toBe(true);
    expect(isUnjudged({ note: "" })).toBe(false);
    expect(isUnjudged({ note: "판독불가" })).toBe(false);
  });

  it("오답 쪽에서 빼냅니다", () => {
    const results = [r("1", true), r("2", false), r("3", false, UNJUDGED)];
    const { judged, unjudged } = splitUnjudged(results);
    expect(unjudged).toBe(1);
    expect(judged.map((x) => x.no)).toEqual(["1", "2"]);
  });

  it("몇 번 문항인지까지 말합니다 — 찾아가야 하니까", () => {
    const text = unjudgedWarning([r("1", true), r("7", false, UNJUDGED), r("8", false, UNJUDGED)]);
    expect(text).toContain("2문항");
    expect(text).toContain("7, 8");
    expect(unjudgedWarning([r("1", true)])).toBeNull();
  });

  it("사람이 채점했으면 더 이상 모름이 아닙니다", () => {
    // 안 그러면 검수를 다 마쳐도 판정이 영영 안 나옵니다.
    expect(isOpen({ note: UNJUDGED, final_correct: null })).toBe(true);
    expect(isOpen({ note: UNJUDGED, final_correct: false })).toBe(false);
    expect(isOpen({ note: UNJUDGED, final_correct: true })).toBe(false);
  });
});

describe("판정에 미치는 영향", () => {
  const marks = { wrong: [] as string[], passFail: "unmarked" as const };

  it("모르는 문항이 결과를 뒤집을 수 있으면 PASS/FAIL을 안 냅니다", () => {
    // 오답 2, 허용 2 → 그대로면 PASS. 그런데 모르는 문항이 하나 있습니다.
    const results = [r("1", false), r("2", false), r("3", true), r("4", false, UNJUDGED)];
    const { judged, unjudged } = splitUnjudged(results);
    const cmp = compare(judged, marks, "-2 까지 pass", 2, unjudged);
    // 그 하나가 오답이면 3개가 되어 FAIL입니다 — 갈리므로 판정하지 않습니다.
    expect(cmp.robustToMissing).toBe(false);
    expect(cmp.ourVerdict).toBeNull();
  });

  it("모르는 문항이 있어도 결과가 안 갈리면 판정합니다", () => {
    // 오답 0, 허용 5. 모르는 하나가 오답이어도 여전히 PASS입니다.
    const results = [r("1", true), r("2", true), r("3", true), r("4", false, UNJUDGED)];
    const { judged, unjudged } = splitUnjudged(results);
    const cmp = compare(judged, marks, "-5 까지 pass", 2, unjudged);
    expect(cmp.robustToMissing).toBe(true);
    expect(cmp.ourVerdict).toBe("pass");
  });

  it("🔴 모르는 문항을 오답으로 세면 학생이 뒤집어씁니다", () => {
    // 고치기 전 동작. 이 테스트는 **옛 방식이 왜 나쁜지**를 고정합니다.
    const results = [r("1", false), r("2", false), r("3", true), r("4", false, UNJUDGED)];
    const 옛방식 = compare(results, marks, "-2 까지 pass", 2, 0);
    expect(옛방식.ourVerdict).toBe("fail"); // 우리가 못 푼 문항 때문에 FAIL

    const { judged, unjudged } = splitUnjudged(results);
    const 새방식 = compare(judged, marks, "-2 까지 pass", 2, unjudged);
    expect(새방식.ourVerdict).toBeNull(); // 단정하지 않고 사람에게 넘깁니다
  });
});
