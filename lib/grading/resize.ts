/**
 * 사진을 줄여 보내면 얼마나 아끼고, 무엇을 잃는가 — **재기 위한 도구.**
 *
 * 2026-08-11 실측에서 사진이 비용의 **25%**였고, 보낸 그대로 청구된다는 것도
 * 확인됐습니다(쪽당 6,376토큰 ≈ 2576×1822 픽셀). 토큰은 **넓이**에 붙으므로
 * 긴 변을 0.7배로 줄이면 사진값이 절반이 됩니다.
 *
 * ```
 * 긴 변 2576 → 1800   사진 토큰 0.49배   월 29만원
 * 긴 변 2576 → 1288   사진 토큰 0.25배   월 43만원
 * ```
 *
 * 🔴 **공짜가 아닙니다.** `MAX_EDGE`를 2576으로 잡은 이유가 답안 한 칸이
 * 40~80px 높이가 되게 하려는 것이었습니다. 줄이면 연필이 안 읽힐 수
 * 있습니다. 그래서 바꾸는 게 아니라 **`/bench`에서 재는 것**부터 합니다 —
 * 모델과 출력 형식을 재던 방식 그대로입니다.
 *
 * 여기 있는 것은 **실험용**입니다. 재서 통과하면 실제로 고칠 곳은
 * `lib/image.ts`의 `MAX_EDGE`(접수할 때 브라우저가 줄이는 값)이고,
 * 그러면 서버에서 줄일 일이 아예 없어집니다.
 *
 * 이 파일에는 **`sharp`가 없습니다.** 화면(`/bench`)도 여기서 상수와
 * 계산을 가져가는데, `sharp`는 서버 전용 네이티브 모듈이라 같이 두면
 * 브라우저 묶음이 통째로 깨집니다. 실제로 줄이는 일은 `downscale.ts`가 합니다.
 */

/** 실험에 꺼내 쓸 수 있는 긴 변. 아무 값이나 받으면 비교가 흩어집니다. */
export const EDGES = [2576, 2000, 1800, 1568, 1288] as const;
export type Edge = (typeof EDGES)[number];

/** 접수할 때 브라우저가 줄이는 값. 저장된 사진의 긴 변입니다. */
export const STORED_EDGE = 2576;

/**
 * 줄인 뒤의 크기. **키우지 않습니다.**
 *
 * 저장된 사진이 이미 목표보다 작으면 그대로 둡니다 — 늘리면 픽셀만 늘고
 * 정보는 안 늘어서 **돈만 더 나갑니다.**
 */
export function fit(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const k = maxEdge / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * 긴 변을 이 값으로 줄이면 사진 토큰이 몇 배인가.
 *
 * 토큰은 넓이에 붙습니다. 긴 변 절반이면 **4분의 1**입니다 — 절반이 아닙니다.
 * 이걸 헷갈리면 절감액을 절반으로 잡습니다.
 */
export const tokenFactor = (from: number, to: number): number => (to >= from ? 1 : (to / from) ** 2);
