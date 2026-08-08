import { describe, expect, it } from "vitest";
import { bias, diffRuns, pct, summarize, type Run } from "../bench";

/** `cells`는 [번호, 학생이 쓴 것], `wrong`은 오답 번호. */
const run = (o: {
  cells: [string, string][];
  wrong: string[];
  cut?: number;
  verdict?: Run["verdict"];
  nearBoundary?: boolean;
  costUsd?: number;
  latencyMs?: number;
}): Run => ({
  model: "m",
  effort: "high",
  items: o.cells.map(([no, written]) => ({ no, written })),
  results: o.cells.map(([no]) => ({ no, correct: !o.wrong.includes(no), expected: "", note: "" })),
  cut: o.cut ?? 5,
  nWrong: o.wrong.length,
  verdict: o.verdict ?? (o.wrong.length <= (o.cut ?? 5) ? "pass" : "fail"),
  nearBoundary: o.nearBoundary ?? false,
  margin: o.wrong.length - (o.cut ?? 5),
  costUsd: o.costUsd ?? 0.1,
  latencyMs: o.latencyMs ?? 1000,
});

describe("두 모델을 나란히 놓기", () => {
  it("판정이 같으면 같다고 한다", () => {
    const base = run({ cells: [["1", "가"]], wrong: [] });
    const trial = run({ cells: [["1", "가"]], wrong: [] });
    expect(diffRuns(base, trial).verdictMatch).toBe(true);
  });

  it("판정이 갈리면 뒤집힘으로 잡는다 — 이게 유일하게 중요한 지표다", () => {
    const base = run({ cells: [["1", "가"]], wrong: [], cut: 0 });
    const trial = run({ cells: [["1", "가"]], wrong: ["1"], cut: 0 });
    const d = diffRuns(base, trial);
    expect(d.baseVerdict).toBe("pass");
    expect(d.trialVerdict).toBe("fail");
    expect(d.verdictMatch).toBe(false);
  });

  it("한쪽이 판정을 못 냈으면 '같다/다르다'를 말하지 않는다", () => {
    // 값싼 모델이 커트라인을 못 읽으면 여기 걸립니다. 억지로 세면 일치율이 부풀려집니다.
    const base = run({ cells: [["1", "가"]], wrong: [] });
    const trial = { ...run({ cells: [["1", "가"]], wrong: [] }), verdict: null };
    expect(diffRuns(base, trial).verdictMatch).toBeNull();
  });

  it("같은 칸을 다르게 읽은 것을 짚는다 — 철자를 맞춰주지 않는다", () => {
    const base = run({ cells: [["1", "expectation"]], wrong: [] });
    const trial = run({ cells: [["1", "expectution"]], wrong: [] });
    expect(diffRuns(base, trial).written).toEqual([{ no: "1", base: "expectation", trial: "expectution" }]);
  });

  it("공백과 대소문자 차이는 다른 것으로 세지 않는다", () => {
    const base = run({ cells: [["1", "Expectation "]], wrong: [] });
    const trial = run({ cells: [["1", "expectation"]], wrong: [] });
    expect(diffRuns(base, trial).written).toHaveLength(0);
  });

  it("한쪽만 읽은 칸을 센다", () => {
    const base = run({ cells: [["1", "가"], ["2", "나"]], wrong: [] });
    const trial = run({ cells: [["1", "가"]], wrong: [] });
    const d = diffRuns(base, trial);
    expect(d.onlyBase).toEqual(["2"]);
    expect(d.onlyTrial).toEqual([]);
    expect(d.n).toBe(1); // 둘 다 읽은 칸만 정오를 비교합니다
  });

  it("정오가 갈린 문항을 양쪽으로 나눠 보여준다", () => {
    const base = run({ cells: [["1", "가"], ["2", "나"]], wrong: ["1"] });
    const trial = run({ cells: [["1", "가"], ["2", "나"]], wrong: ["2"] });
    const d = diffRuns(base, trial);
    expect(d.wrongOnlyBase).toEqual(["1"]);
    expect(d.wrongOnlyTrial).toEqual(["2"]);
    expect(d.agree).toBe(0);
  });
});

describe("모아서 세기", () => {
  it("판정을 못 낸 장은 일치율 분모에서 뺀다", () => {
    const base = run({ cells: [["1", "가"]], wrong: [] });
    const same = diffRuns(base, run({ cells: [["1", "가"]], wrong: [] }));
    const none = diffRuns(base, { ...run({ cells: [["1", "가"]], wrong: [] }), verdict: null });
    const s = summarize([
      { base, diff: same },
      { base, diff: none },
    ]);
    expect(s.sheets).toBe(2);
    expect(s.compared).toBe(1);
    expect(s.verdictAgree).toBe(1);
    expect(s.trialUndecided).toBe(1);
  });

  it("기준도 판정이 없던 장은 대상 모델 탓으로 세지 않는다", () => {
    // 첫 실측에서 이걸 뭉뚱그려 '한쪽만 2장'으로 보여줬습니다.
    // 그중 하나는 Opus도 판정을 못 낸 장이라 Sonnet의 흠이 아니었습니다.
    const base = { ...run({ cells: [["1", "가"]], wrong: [] }), verdict: null };
    const d = diffRuns(base, { ...run({ cells: [["1", "가"]], wrong: [] }), verdict: null });
    const s = summarize([{ base, diff: d }]);
    expect(s.incomparable).toBe(1);
    expect(s.trialUndecided).toBe(0);
    expect(s.compared).toBe(0);
  });

  it("경계선에서 갈린 것과 여유가 있는데 갈린 것을 나눈다", () => {
    // 같은 모델을 두 번 돌려도 여유 0인 답안지는 갈립니다(2026-08-08 실측).
    // 그걸 대상 모델의 흠으로 세면 멀쩡한 모델도 탈락합니다.
    const edge = run({ cells: [["1", "가"]], wrong: [], cut: 0, nearBoundary: true });
    const roomy = run({ cells: [["1", "가"]], wrong: [], cut: 9, nearBoundary: false });
    const s = summarize([
      { base: edge, diff: diffRuns(edge, run({ cells: [["1", "가"]], wrong: ["1"], cut: 0 })) },
      { base: roomy, diff: diffRuns(roomy, { ...run({ cells: [["1", "가"]], wrong: [], cut: 9 }), verdict: "fail" }) },
    ]);
    expect(s.flipped).toBe(2);
    expect(s.flippedAtBoundary).toBe(1);
    expect(s.flippedWithMargin).toBe(1);
  });

  it("비용을 양쪽 다 더한다", () => {
    const base = run({ cells: [["1", "가"]], wrong: [], costUsd: 0.14 });
    const d = diffRuns(base, run({ cells: [["1", "가"]], wrong: [], costUsd: 0.03 }));
    const s = summarize([{ base, diff: d }]);
    expect(s.baseCost).toBeCloseTo(0.14);
    expect(s.trialCost).toBeCloseTo(0.03);
  });

  it("오답을 놓치는 쪽으로 쏠린 것을 잡아낸다", () => {
    /*
      Sonnet 5 + low 실측(2026-08-08). 판정은 100% 일치했는데 정오 불일치
      7건 중 6건이 '대상이 놓친 오답'이었습니다. 통과할 학생을 더 통과시키는
      것은 판정을 안 바꾸므로 일치율에 안 잡힙니다.
    */
    const base = run({ cells: [["1", "가"], ["2", "나"], ["3", "다"], ["4", "라"]], wrong: ["1", "2", "3"] });
    const trial = run({ cells: [["1", "가"], ["2", "나"], ["3", "다"], ["4", "라"]], wrong: [] });
    const s = summarize([{ base, diff: diffRuns(base, trial) }]);
    expect(s.verdictAgree).toBe(1); // 판정은 같습니다
    expect(s.itemsWrongOnlyBase).toBe(3);
    expect(s.itemsWrongOnlyTrial).toBe(0);
    expect(bias(s)).toBe("lenient");
    expect(s.allComparedPass).toBe(true); // 표본에 판별력이 없다는 신호
  });

  it("몇 건 안 되면 방향을 말하지 않는다", () => {
    const base = run({ cells: [["1", "가"], ["2", "나"]], wrong: ["1"] });
    const trial = run({ cells: [["1", "가"], ["2", "나"]], wrong: [] });
    expect(bias(summarize([{ base, diff: diffRuns(base, trial) }]))).toBe("balanced");
  });

  it("FAIL이 섞이면 표본에 판별력이 생긴다", () => {
    const base = run({ cells: [["1", "가"]], wrong: ["1"], cut: 0 });
    const s = summarize([{ base, diff: diffRuns(base, run({ cells: [["1", "가"]], wrong: ["1"], cut: 0 })) }]);
    expect(s.allComparedPass).toBe(false);
  });

  it("분모가 0이면 100%가 아니라 '없음'이다", () => {
    expect(pct(0, 0)).toBe("—");
    expect(pct(1, 2)).toBe("50.0%");
  });
});
