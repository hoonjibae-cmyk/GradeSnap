/**
 * "이 규모면 한 달에 얼마인가" — **실측 토큰에서만 나옵니다.**
 *
 * 이 파일은 두 번 틀렸습니다.
 *
 * 1. 하루 일곱 장을 보고 월 규모를 짐작해 **세 자릿수 배** 틀렸습니다.
 * 2. 고친 뒤에도 답안지 두 장에 맞춘 `쪽당 + 문항당` 모형을 썼는데,
 *    그게 **출력 몫을 35%로 말했습니다. 실측은 62%였습니다.**
 *
 * 두 번째가 더 나쁩니다. 화면 한 상자 안에서 실측(62%)과 모형(35%)이
 * 서로 다른 말을 하고 있었고, 그 모형 위에서 "다음에 뭘 줄일까"를
 * 정하고 있었습니다.
 *
 * 그래서 맞추는 모형을 버렸습니다. **이제 실제로 쓴 토큰을 그대로 늘립니다.**
 */

/** `sheets.token_usage`에서 그대로 나오는 값. 추정이 하나도 안 들어갑니다. */
export interface Measured {
  pages: number;
  items: number;
  /** 전사 입력 중 사진 몫 (`lib/tokens.ts`의 `imageTokens` × 쪽수) */
  imageTokens: number;
  /** 시스템 프롬프트 + 판정 입력 */
  otherInputTokens: number;
  outputTokens: number;
}

/** 1M 토큰당 [입력, 출력] 달러. */
export type Price = [number, number];
export const OPUS_5: Price = [5, 25];

export interface Part {
  tokens: number;
  usd: number;
  /** 전체 비용에서 차지하는 몫 */
  share: number;
}

export interface Breakdown {
  /** **해상도**로 줄이는 몫 */
  image: Part;
  /** 프롬프트·판정 입력. 줄일 손잡이가 마땅치 않습니다 */
  otherInput: Part;
  /** **출력 스키마**로 줄이는 몫. 문항 수에 비례합니다 */
  output: Part;
  totalUsd: number;
}

export function breakdown(m: Measured, price: Price = OPUS_5): Breakdown {
  const [pin, pout] = price;
  const image = (m.imageTokens * pin) / 1e6;
  const otherInput = (m.otherInputTokens * pin) / 1e6;
  const output = (m.outputTokens * pout) / 1e6;
  const totalUsd = image + otherInput + output;
  const part = (tokens: number, usd: number): Part => ({ tokens, usd, share: totalUsd ? usd / totalUsd : 0 });
  return {
    image: part(m.imageTokens, image),
    otherInput: part(m.otherInputTokens, otherInput),
    output: part(m.outputTokens, output),
    totalUsd,
  };
}

/**
 * 잰 것을 목표 쪽수로 늘립니다.
 *
 * **쪽당 문항 수가 지금과 같다고 봅니다.** 시험지 유형마다 다르므로
 * 표본이 실제 수업과 안 닮으면 이 값도 안 맞습니다 — 화면이 표본 수를
 * 같이 보여주는 이유입니다.
 */
export function project(m: Measured, targetPages: number, price: Price = OPUS_5): Breakdown {
  if (m.pages <= 0) return breakdown({ ...m, pages: 0, items: 0, imageTokens: 0, otherInputTokens: 0, outputTokens: 0 }, price);
  const k = targetPages / m.pages;
  return breakdown(
    {
      pages: targetPages,
      items: m.items * k,
      imageTokens: m.imageTokens * k,
      otherInputTokens: m.otherInputTokens * k,
      outputTokens: m.outputTokens * k,
    },
    price,
  );
}

/**
 * 아끼는 길 하나가 **이 규모에서** 얼마인가.
 *
 * 붙는 자리가 다르면 같은 비율도 금액이 다릅니다. 비율만 말하면
 * 큰 것과 작은 것이 같아 보입니다 — 실제로 그렇게 헛짚었습니다.
 */
export interface Lever {
  name: string;
  /** 사진 토큰이 몇 배가 되나. 긴 변을 `r`배로 줄이면 `r²`입니다. */
  image?: number;
  /** 출력 토큰이 몇 배가 되나. */
  output?: number;
}

export function saving(m: Measured, targetPages: number, lever: Lever, price: Price = OPUS_5): number {
  const base = project(m, targetPages, price);
  const after = project(
    {
      ...m,
      imageTokens: m.imageTokens * (lever.image ?? 1),
      outputTokens: m.outputTokens * (lever.output ?? 1),
    },
    targetPages,
    price,
  );
  return base.totalUsd - after.totalUsd;
}

/** 긴 변을 이 픽셀로 줄이면 사진 토큰이 몇 배인가. 토큰은 **넓이**에 붙습니다. */
export const edgeFactor = (from: number, to: number): number => (to / from) ** 2;

/** 감을 잡기 위한 환산. 정확한 청구액이 아닙니다. */
export const KRW_PER_USD = 1415;
export const krw = (usd: number): number => Math.round(usd * KRW_PER_USD);
