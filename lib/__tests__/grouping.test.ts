import { describe, expect, it } from "vitest";
import { defaultBreaks, groupsOf } from "../grouping";

const of = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("찍은 순서를 학생별로 자르기", () => {
  it("양면 시험지 6장은 세 명이 된다", () => {
    const g = groupsOf(of(6), defaultBreaks(6, 2));
    expect(g).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("단면이면 한 장이 한 명이다", () => {
    expect(groupsOf(of(3), defaultBreaks(3, 1))).toEqual([[0], [1], [2]]);
  });

  it("장수가 안 맞으면 마지막이 짧게 남는다 — 조용히 버리지 않는다", () => {
    // 뒷면을 안 찍은 학생이 섞이면 이렇게 됩니다. 화면에서 눈에 띄어야 합니다.
    expect(groupsOf(of(5), defaultBreaks(5, 2))).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("사람이 경계를 옮기면 그대로 따른다", () => {
    // 3번째 학생이 뒷면을 다시 찍어 3장이 된 경우.
    expect(groupsOf(of(5), new Set([2]))).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
  });

  it("사진이 없으면 학생도 없다", () => {
    expect(groupsOf([], defaultBreaks(0, 2))).toEqual([]);
  });

  it("경계가 없으면 전부 한 명이다", () => {
    expect(groupsOf(of(4), new Set())).toEqual([[0, 1, 2, 3]]);
  });
});
