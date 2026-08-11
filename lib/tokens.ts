/**
 * **돈이 정확히 어디로 나가는가.**
 *
 * `usage_events`에는 달러만 있고 토큰이 없습니다. 그런데 "무엇을 줄여야
 * 하는가"는 달러로는 답이 안 나옵니다 — 사진을 줄일지 출력을 줄일지가
 * 갈리지 않기 때문입니다.
 *
 * 토큰은 `sheets.token_usage`에 이미 다 있습니다. 호출 순서가 정해져 있어
 * 단계를 가를 수 있습니다.
 *
 * ```
 * token_usage = [전사(1쪽), 전사(2쪽), …, 판정]
 *                └─ 사진이 들어가는 호출 ─┘  └ 글만 ┘
 * ```
 *
 * 이걸 안 보고 §13.22에서 "해상도를 반으로 줄이면 월 64만 원"이라고
 * 적었는데, **그건 실측이 아니라 산수였습니다.** 사진이 입력의 몇 할인지
 * 모르는 채로 낸 숫자입니다.
 */

import type { Usage } from "@/lib/grading/types";

export interface Stage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Split {
  /** 사진이 들어가는 호출. 쪽마다 하나입니다. */
  transcribe: Stage;
  /** 글만 들어가는 호출. 답안지마다 하나입니다. */
  judge: Stage;
  sheets: number;
  pages: number;
}

const empty = (): Stage => ({ calls: 0, inputTokens: 0, outputTokens: 0 });

const add = (s: Stage, u: Usage) => {
  s.calls++;
  // 캐시된 프리픽스도 실재 입력입니다. 단가만 다를 뿐, "어디로 가나"에서는 입력입니다.
  s.inputTokens += u.inputTokens + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  s.outputTokens += u.outputTokens;
};

/**
 * 답안지들의 토큰을 단계별로 가릅니다.
 *
 * **마지막 호출이 판정입니다.** `grade-sheet`가 쪽마다 전사한 뒤 판정을
 * 한 번 밀어 넣기 때문입니다. 순서에 기대는 것이 불안하면 `usage`에
 * 단계 이름을 넣어야 하는데, 옛 기록에는 없으므로 지금은 순서로 봅니다.
 *
 * 호출이 하나뿐이면 판정이 없는 것(실패한 채점)이라 전사로 셉니다.
 */
export function split(rows: { token_usage: Usage[] | null }[]): Split {
  const out: Split = { transcribe: empty(), judge: empty(), sheets: 0, pages: 0 };
  for (const r of rows) {
    const u = r.token_usage ?? [];
    if (!u.length) continue;
    out.sheets++;
    const pages = Math.max(1, u.length - 1);
    out.pages += pages;
    u.forEach((x, i) => add(i === u.length - 1 && u.length > 1 ? out.judge : out.transcribe, x));
  }
  return out;
}

/**
 * 사진 한 장이 몇 토큰인가.
 *
 * 전사 호출의 입력에서 **시스템 프롬프트와 지시문을 뺀 나머지**가 사진입니다.
 * 그 둘은 매 호출 같으므로 상수로 빼면 남는 것이 사진 몫입니다.
 *
 * 이 값이 해상도를 줄일 값어치를 정합니다 — 사진이 입력의 9할이면 크고,
 * 절반이면 생각보다 작습니다.
 */
export function imageTokens(s: Split, fixedInputPerCall: number): number {
  if (!s.transcribe.calls) return 0;
  return Math.max(0, s.transcribe.inputTokens / s.transcribe.calls - fixedInputPerCall);
}

/**
 * 전사 시스템 프롬프트 + 지시문의 대략적인 토큰 수.
 *
 * `TRANSCRIBE_SYSTEM`이 912자, 지시문이 40자쯤입니다. 한글은 글자당
 * 1토큰에 가까우므로 **어림값**입니다. 사진 몫을 정확히 알려면 언젠가
 * `count_tokens`로 재야 하지만, 자릿수를 보는 데는 충분합니다.
 */
export const FIXED_INPUT_PER_PAGE = 750;
