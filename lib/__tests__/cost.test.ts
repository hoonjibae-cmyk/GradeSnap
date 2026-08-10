import { describe, expect, it } from "vitest";
import { OPUS_LOW, estimate, krw, saving, type Lever } from "../cost";

/** 2026-08-10 실측 7장. `기준 = claude-opus-5 · low` */
const MEASURED = [
  { name: "김예진", pages: 2, items: 60, usd: 0.247 },
  { name: "김예지", pages: 1, items: 37, usd: 0.137 },
  { name: "허민하", pages: 1, items: 10, usd: 0.089 },
  { name: "김민석", pages: 1, items: 10, usd: 0.087 },
  { name: "최요인", pages: 1, items: 10, usd: 0.085 },
  { name: "강이안", pages: 1, items: 10, usd: 0.083 },
  { name: "한태희", pages: 1, items: 10, usd: 0.088 },
];

describe("실측에 맞는가", () => {
  it("7장 전부 오차 8% 안", () => {
    /*
      이 모형으로 월 200만 원을 말하게 됩니다. 실측에서 벗어나면
      그 위에 쌓는 판단이 전부 헛것이 됩니다.
    */
    for (const m of MEASURED) {
      const got = estimate({ pages: m.pages, itemsPerPage: m.items / m.pages }).totalUsd;
      expect(Math.abs(got - m.usd) / m.usd).toBeLessThan(0.08);
    }
  });

  it("작은 답안지는 쪽값이, 큰 답안지는 문항값이 지배한다", () => {
    // 어디를 손댈지가 답안지 크기에 따라 **뒤바뀝니다.**
    const small = estimate({ pages: 1, itemsPerPage: 10 });
    const big = estimate({ pages: 1, itemsPerPage: 50 });
    expect(small.itemShare).toBeLessThan(0.25);
    expect(big.itemShare).toBeGreaterThan(0.5);
  });
});

describe("학원 실제 규모 — 월 12,600쪽", () => {
  const load = (itemsPerPage: number) => ({ pages: 12_600, itemsPerPage });

  it("쪽당 20문항이면 월 1,200달러대", () => {
    const e = estimate(load(20));
    expect(e.totalUsd).toBeGreaterThan(1_200);
    expect(e.totalUsd).toBeLessThan(1_400);
  });

  it("쪽당 문항이 늘수록 출력 몫이 커진다 — 스키마를 손댈 값어치도 같이 큰다", () => {
    expect(estimate(load(10)).itemShare).toBeLessThan(0.25);
    expect(estimate(load(30)).itemShare).toBeGreaterThan(0.4);
  });

  it("사진 한 장을 덜 찍으면 그것만으로 한 달에 백만 원 단위가 움직인다", () => {
    // 학생당 4~5쪽에서 한 쪽을 줄이면 월 2,730쪽입니다.
    const cut = estimate(load(20)).totalUsd - estimate({ pages: 12_600 - 2_730, itemsPerPage: 20 }).totalUsd;
    expect(krw(cut)).toBeGreaterThan(400_000);
  });
});

describe("길마다 얼마인가", () => {
  const load = { pages: 12_600, itemsPerPage: 20 };

  const levers: Record<string, Lever> = {
    // 사진을 반으로 줄이면 입력 토큰이 반. 출력은 안 변합니다.
    해상도: { name: "이미지 해상도 절반", page: 0.5, item: 1 },
    // 출력 스키마 압축은 문항 쪽에만 붙습니다.
    압축: { name: "출력 스키마 압축", page: 1, item: 0.64 },
    // Batch는 입력·출력 둘 다 반값입니다.
    배치: { name: "Batch API", page: 0.5, item: 0.5 },
  };

  it("Batch가 가장 크다 — 두 항에 다 붙기 때문", () => {
    const b = saving(load, levers.배치);
    expect(b).toBeGreaterThan(saving(load, levers.해상도));
    expect(b).toBeGreaterThan(saving(load, levers.압축));
  });

  it("스키마 압축은 작은 답안지에서 재면 값어치가 작아 보인다", () => {
    /*
      🔴 2026-08-10에 실제로 이렇게 헛짚었습니다. 10문항짜리 다섯 장으로
      재서 7.7%가 나왔는데, 그건 그 표본이 작아서였습니다.
    */
    const tiny = saving({ pages: 12_600, itemsPerPage: 10 }, levers.압축);
    const real = saving({ pages: 12_600, itemsPerPage: 30 }, levers.압축);
    expect(real / tiny).toBeGreaterThan(2);
  });

  it("원화로 옮겨도 자릿수가 유지된다", () => {
    expect(krw(saving(load, levers.배치))).toBeGreaterThan(900_000);
  });
});
