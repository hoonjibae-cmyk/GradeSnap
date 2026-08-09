/**
 * 목동유쌤영어 로고.
 *
 * 원장님이 주신 `assets/logo.svg`가 원본입니다. **손대지 않고 그대로 씁니다** —
 * 학원 자산이라 제가 다시 그릴 것이 아닙니다.
 *
 * 두 벌로 나눠 `public/`에 둡니다.
 *
 * | 파일 | 무엇 | 어디에 |
 * |---|---|---|
 * | `/logo.svg` | 왕관 + 글자 (원본 그대로) | 로그인 화면 |
 * | `/crown.svg` | 왕관만 (원본에서 잘라냄) | 상단 줄 · 인쇄물 머리말 |
 *
 * 상단 줄에는 20px로 들어가는데 그 크기에서는 글자가 안 읽힙니다. 그래서
 * 마크만 씁니다. 잘라낸 것은 `viewBox`만 좁힌 것이고 패스는 원본 그대로입니다.
 */

import { ACADEMY } from "@/lib/brand";

export { ACADEMY };

/** 왕관 마크만. */
export function Crown({ className = "h-8 w-auto" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/crown.svg" alt={ACADEMY} className={className} />;
}

/** 왕관 + 글자. 로고 원본 그대로라 글자가 학원 서체입니다. */
export function Wordmark({ className = "h-24 w-auto" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt={ACADEMY} className={className} />;
}
