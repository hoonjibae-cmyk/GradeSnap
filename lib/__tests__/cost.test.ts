import { describe, expect, it } from "vitest";
import { breakdown, edgeFactor, krw, project, saving, type Measured } from "../cost";

/**
 * 2026-08-11 관리 화면 실측 (2026-07-13 ~ 08-11, `claude-opus-5 · low`).
 *
 * ```
 * 13장 · 16쪽 · 364문항 · $2.04
 * 입력 156,158 · 출력 50,185 · 사진이 입력의 65% (쪽당 6,376토큰)
 * ```
 */
const REAL: Measured = {
  pages: 16,
  items: 364,
  imageTokens: 6_376 * 16,
  otherInputTokens: 156_158 - 6_376 * 16,
  outputTokens: 50_185,
};

describe("실측과 맞는가", () => {
  it("총액이 화면의 $2.04와 같다", () => {
    expect(breakdown(REAL).totalUsd).toBeCloseTo(2.04, 2);
  });

  it("🔴 출력이 비용의 6할이 넘는다 — 예전 모형은 35%라고 했다", () => {
    /*
      답안지 두 장에 맞춘 `쪽당 + 문항당` 모형이 출력을 35%로 봤습니다.
      실측은 62%입니다. 그 모형 위에서 "다음에 뭘 줄일까"를 정하고 있었고,
      순위가 뒤바뀌어 있었습니다.
    */
    const b = breakdown(REAL);
    expect(b.output.share).toBeGreaterThan(0.6);
    expect(b.image.share).toBeLessThan(0.3);
  });

  it("사진은 비용의 4분의 1 — 입력의 65%지만 입력 자체가 4할이 안 된다", () => {
    // 여기서 두 숫자를 헷갈리면 해상도의 값어치를 두 배로 잡습니다.
    const b = breakdown(REAL);
    expect(b.image.share).toBeCloseTo(0.25, 2);
    expect(b.image.usd / (b.image.usd + b.otherInput.usd)).toBeCloseTo(0.65, 2);
  });
});

describe("월 12,600쪽으로 늘리면", () => {
  const M = 12_600;

  it("약 227만원", () => {
    const p = project(REAL, M);
    expect(p.totalUsd).toBeGreaterThan(1_550);
    expect(p.totalUsd).toBeLessThan(1_650);
    expect(krw(p.totalUsd)).toBeGreaterThan(2_200_000);
  });

  it("몫은 쪽수를 늘려도 안 변한다", () => {
    expect(project(REAL, M).output.share).toBeCloseTo(breakdown(REAL).output.share, 6);
  });

  it("쪽이 없으면 0 — 나누기 오류를 안 낸다", () => {
    expect(project({ ...REAL, pages: 0 }, M).totalUsd).toBe(0);
  });
});

describe("길마다 이 규모에서 얼마인가", () => {
  const M = 12_600;
  const man = (usd: number) => Math.round((krw(usd) / 10_000) * 10) / 10;

  it("긴 변 2576→1800이면 월 29만원", () => {
    // 토큰은 넓이에 붙습니다. 긴 변 0.7배면 사진 토큰은 0.49배입니다.
    const s = saving(REAL, M, { name: "1800px", image: edgeFactor(2576, 1800) });
    expect(man(s)).toBeGreaterThan(25);
    expect(man(s)).toBeLessThan(33);
  });

  it("긴 변 절반이면 월 43만원 — 사진을 아예 없애도 57만원이 한계", () => {
    expect(man(saving(REAL, M, { name: "1288px", image: edgeFactor(2576, 1288) }))).toBeGreaterThan(40);
    // 해상도로 살 수 있는 것의 천장. 이보다 큰 절감은 출력에서만 나옵니다.
    expect(man(saving(REAL, M, { name: "사진 없음", image: 0 }))).toBeLessThan(60);
  });

  it("출력 스키마 압축은 실측 7.6% — 월 17만원", () => {
    /*
      docs/13 §13.21에서 잰 값입니다. 출력이 비용의 62%인데 절감이 7.6%인
      것은, 압축이 **전사 문항 출력에만** 붙고 머리말·판정 출력은 그대로이기
      때문입니다. 예측(36%)이 아니라 실측을 씁니다.
    */
    const s = project(REAL, M).totalUsd * 0.076;
    expect(man(s)).toBeGreaterThan(15);
    expect(man(s)).toBeLessThan(20);
  });

  it("해상도가 스키마 압축보다 크다 — 순위가 뒤집혔다", () => {
    const res = saving(REAL, M, { name: "1800px", image: edgeFactor(2576, 1800) });
    const schema = project(REAL, M).totalUsd * 0.076;
    expect(res).toBeGreaterThan(schema);
  });
});

describe("긴 변과 토큰", () => {
  it("넓이에 붙는다 — 긴 변 절반은 토큰 4분의 1", () => {
    expect(edgeFactor(2576, 1288)).toBeCloseTo(0.25, 3);
    expect(edgeFactor(2576, 2576)).toBe(1);
  });
});
