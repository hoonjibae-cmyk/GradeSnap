/**
 * "이 규모면 한 달에 얼마인가."
 *
 * 원장님이 비용에 매달리는 이유가 2026-08-10에 드러났습니다.
 *
 * ```
 * 주  650명 × 4~5쪽 = 약 3,000쪽
 * 월                  약 12,600쪽
 * ```
 *
 * 저는 그때까지 하루 일곱 장을 보고 "월 몇 천 원"이라고 말하고 있었습니다.
 * **두 자릿수 배가 아니라 세 자릿수 배 틀렸습니다.** 그 잘못된 규모 위에서
 * "비용 최적화는 여기서 멈추자"고 권했고, 그건 뒤집었습니다(docs/13 §13.22).
 *
 * 그래서 규모를 **머릿속이 아니라 코드에** 둡니다. 실측이 바뀌면 여기만
 * 고치고, 화면과 문서가 같은 숫자를 말합니다.
 */

/**
 * 비용이 붙는 자리는 둘입니다.
 *
 * | | 무엇 | 왜 여기 붙나 |
 * |---|---|---|
 * | 쪽당 | 사진 + 시스템 프롬프트 **입력** | 문항이 몇 개든 사진 한 장 값은 같습니다 |
 * | 문항당 | 전사·판정 **출력** | 문항마다 JSON 한 덩이씩 뱉습니다 |
 *
 * `쪽수 × 쪽당 + 문항수 × 문항당`. 2026-08-10 실측 7장에 **오차 7% 안**으로
 * 맞습니다(아래 테스트). 답안지 크기가 10문항에서 60문항까지 흩어져 있어
 * 두 항을 가를 수 있었습니다.
 */
export interface Rate {
  /** 쪽 하나를 모델에 보내는 값(달러). 사진 크기가 정합니다. */
  perPage: number;
  /** 문항 하나가 뱉는 값(달러). 출력 스키마가 정합니다. */
  perItem: number;
}

/**
 * `claude-opus-5 · low`, 지금 쓰는 출력 형식.
 *
 * 2026-08-10 7장에 맞춘 값입니다. **모델이나 스키마를 바꾸면 다시 재야
 * 합니다** — 이 두 숫자는 그 조합에만 붙어 있습니다.
 */
export const OPUS_LOW: Rate = { perPage: 0.0717, perItem: 0.00173 };

export interface Load {
  /** 한 달에 찍는 쪽 수 */
  pages: number;
  /** 쪽당 평균 문항 수 */
  itemsPerPage: number;
}

export interface Estimate {
  /** 사진을 보내는 값 — **줄이려면 해상도** */
  pageUsd: number;
  /** 문항을 받는 값 — **줄이려면 출력 스키마** */
  itemUsd: number;
  totalUsd: number;
  /** 출력이 차지하는 몫. 어디를 손대야 하는지 알려줍니다. */
  itemShare: number;
}

export function estimate(load: Load, rate: Rate = OPUS_LOW): Estimate {
  const pageUsd = load.pages * rate.perPage;
  const itemUsd = load.pages * load.itemsPerPage * rate.perItem;
  const totalUsd = pageUsd + itemUsd;
  return { pageUsd, itemUsd, totalUsd, itemShare: totalUsd ? itemUsd / totalUsd : 0 };
}

/**
 * 아끼는 길마다 **이 규모에서** 한 달에 얼마인가.
 *
 * 같은 비율이라도 붙는 자리가 다르면 금액이 다릅니다. 이걸 안 보고
 * "7% 절감"만 말하면 큰 것과 작은 것이 같아 보입니다.
 */
export interface Lever {
  name: string;
  /** 쪽당 값이 몇 배가 되나. 1이면 안 건드림. */
  page: number;
  /** 문항당 값이 몇 배가 되나. */
  item: number;
}

export function saving(load: Load, lever: Lever, rate: Rate = OPUS_LOW): number {
  const base = estimate(load, rate).totalUsd;
  const after = estimate(load, { perPage: rate.perPage * lever.page, perItem: rate.perItem * lever.item }).totalUsd;
  return base - after;
}

/** 감을 잡기 위한 환산. 정확한 청구액이 아닙니다. */
export const KRW_PER_USD = 1415;
export const krw = (usd: number): number => Math.round(usd * KRW_PER_USD);
