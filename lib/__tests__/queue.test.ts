import { describe, expect, it } from "vitest";
import { describeWait, medianSeconds, waitSeconds } from "../queue";

describe("얼마나 기다려야 하나", () => {
  const q = (queued: number, running: number, lanes = 4, secPerSheet = 150) => ({
    queued,
    running,
    lanes,
    secPerSheet,
  });

  it("빈 큐는 0", () => {
    expect(waitSeconds(q(0, 0))).toBe(0);
  });

  it("갈래보다 적으면 한 판 — 쌓인 양이 한 장의 시간을 늘리지 않는다", () => {
    /*
      이게 이 파일의 핵심입니다. 모델 호출은 각각 독립이라 옆에서 세 장이
      더 돌아도 내 장은 내 장대로 끝납니다. 늘어나는 건 줄 서는 시간뿐입니다.
    */
    expect(waitSeconds(q(1, 0))).toBe(150);
    expect(waitSeconds(q(3, 1))).toBe(150);
  });

  it("갈래를 넘으면 판이 늘어난다", () => {
    expect(waitSeconds(q(5, 0))).toBe(300); // 두 판
    expect(waitSeconds(q(20, 0))).toBe(750); // 다섯 판 = 12분 반
  });

  it("갈래를 늘리면 그만큼 줄어든다 — 여기가 유일한 손잡이다", () => {
    expect(waitSeconds(q(20, 0, 8))).toBe(450);
    expect(waitSeconds(q(20, 0, 12))).toBe(300);
  });

  it("돌고 있는 장을 방금 시작한 것으로 친다 — 넉넉하게", () => {
    // 모자라게 말하면 학생을 이미 보낸 뒤에 결과가 나옵니다.
    expect(waitSeconds(q(0, 4))).toBe(150);
  });

  it("갈래가 0이어도 나누기 오류를 안 낸다", () => {
    expect(waitSeconds(q(4, 0, 0))).toBe(600);
  });
});

describe("사람이 읽는 문구", () => {
  it("초는 안 보여준다", () => {
    expect(describeWait(45)).toBe("1분 안");
    expect(describeWait(150)).toBe("약 3분");
    expect(describeWait(750)).toBe("약 13분");
  });

  it("기다릴 게 없으면 빈 문자열 — 화면에 아무것도 안 붙습니다", () => {
    expect(describeWait(0)).toBe("");
  });
});

describe("한 장에 몇 초인가", () => {
  it("중앙값을 쓴다 — 60문항 한 장에 끌려가지 않게", () => {
    // 평균이면 100초가 넘습니다.
    expect(medianSeconds([30_000, 35_000, 40_000, 300_000])).toBe(37.5);
  });

  it("홀수 개면 가운데", () => {
    expect(medianSeconds([30_000, 40_000, 50_000])).toBe(40);
  });

  it("잰 게 없으면 null — 추측한 대기 시간을 안 띄운다", () => {
    /*
      틀린 대기 시간은 없는 것보다 나쁩니다. "5분"을 믿고 학생을 잡아뒀는데
      12분이 걸리면 그 뒤로 화면을 안 믿게 됩니다.
    */
    expect(medianSeconds([])).toBeNull();
    expect(medianSeconds([0, 0])).toBeNull();
  });
});
