import { describe, expect, it } from "vitest";
import { fit, tokenFactor } from "../resize";
import { downscale } from "../downscale";
import sharp from "sharp";

describe("줄인 뒤 크기", () => {
  it("긴 변을 맞추고 비율을 지킨다", () => {
    expect(fit(2576, 1822, 1800)).toEqual({ width: 1800, height: 1273 });
  });

  it("세로로 긴 사진도 긴 변 기준", () => {
    expect(fit(1822, 2576, 1800)).toEqual({ width: 1273, height: 1800 });
  });

  it("이미 작으면 그대로 — 키우지 않는다", () => {
    /*
      늘리면 픽셀만 늘고 정보는 안 늡니다. **돈만 더 나갑니다.**
      조교가 작게 찍은 사진이 실험 때문에 비싸지면 안 됩니다.
    */
    expect(fit(1200, 900, 1800)).toEqual({ width: 1200, height: 900 });
    expect(fit(1800, 1273, 1800)).toEqual({ width: 1800, height: 1273 });
  });
});

describe("토큰이 몇 배가 되나", () => {
  it("넓이에 붙는다 — 긴 변 절반은 4분의 1", () => {
    // 절반으로 착각하면 절감액을 절반으로 잡습니다.
    expect(tokenFactor(2576, 1288)).toBeCloseTo(0.25, 3);
  });

  it("실측에 쓰는 값들", () => {
    expect(tokenFactor(2576, 1800)).toBeCloseTo(0.488, 3);
    expect(tokenFactor(2576, 2000)).toBeCloseTo(0.603, 3);
  });

  it("키우는 쪽은 1 — 안 늘립니다", () => {
    expect(tokenFactor(1288, 2576)).toBe(1);
    expect(tokenFactor(2576, 2576)).toBe(1);
  });
});

describe("실제로 줄이기", () => {
  const jpeg = async (w: number, h: number) =>
    (await sharp({ create: { width: w, height: h, channels: 3, background: "#fff" } }).jpeg().toBuffer()).toString(
      "base64",
    );

  it("긴 변이 목표에 맞는다", async () => {
    const out = await downscale(await jpeg(2576, 1822), 1800);
    const m = await sharp(Buffer.from(out, "base64")).metadata();
    expect(m.width).toBe(1800);
    expect(m.height).toBe(1273);
  });

  it("이미 작으면 **손도 안 댑니다** — 같은 문자열이 그대로", async () => {
    // 다시 인코딩하면 화질이 한 번 더 깎입니다. 잴 것은 해상도뿐입니다.
    const src = await jpeg(1200, 900);
    expect(await downscale(src, 1800)).toBe(src);
  });

  it("세로로 긴 사진도 긴 변 기준으로 줄인다", async () => {
    const out = await downscale(await jpeg(1822, 2576), 1288);
    const m = await sharp(Buffer.from(out, "base64")).metadata();
    expect(m.height).toBe(1288);
    expect(m.width).toBeLessThan(1288);
  });

  it("픽셀이 줄어든 만큼 토큰도 줄어든다", async () => {
    /*
      Anthropic은 보낸 그대로 청구합니다(2026-08-11 실측: 쪽당 6,376토큰
      ≈ 4.78M픽셀 ≈ 2576×1822). 그래서 픽셀 비율이 곧 비용 비율입니다.
    */
    const out = await downscale(await jpeg(2576, 1822), 1288);
    const m = await sharp(Buffer.from(out, "base64")).metadata();
    const ratio = (m.width! * m.height!) / (2576 * 1822);
    expect(ratio).toBeCloseTo(tokenFactor(2576, 1288), 2);
  });
});
