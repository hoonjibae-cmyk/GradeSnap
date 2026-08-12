/**
 * 정답 처리된 답 중 **눈에 띄게 짧은 것**을 짚어냅니다.
 *
 * 2026-08-11, 영작 시험에서 이런 판정이 나왔습니다.
 *
 * ```
 * 학생이 쓴 것   current carry left
 * 정답           The current will carry us to the left
 * 판정           ○
 * ```
 *
 * 누가 봐도 쓰다 만 답인데 정답입니다. 프롬프트가 **단어 시험만 가정**하고
 * 있어서(§13.38), 모델이 "뜻이 통하면 정답"을 문장에까지 적용한 것입니다.
 * 프롬프트는 고쳤습니다. 여기는 **두 번째 그물**입니다.
 *
 * 왜 그물이 하나 더 필요한가 — 이 오류는 **학생에게 유리한 쪽**으로 틀립니다.
 * 화면에 `○`가 떠 있고 오답 수도 적으니 검수하는 사람이 그냥 넘깁니다.
 * 틀린 쪽이 눈에 띄는 오류와 달리, 이건 **아무도 안 보게 생긴 오류**입니다.
 *
 * 🔴 **판정을 바꾸지 않습니다.** 여기서 오답으로 뒤집으면 코드가 채점을
 * 하게 되고, 그 규칙(낱말 수)은 채점 기준이 될 만큼 정확하지 않습니다.
 * 하는 일은 **사람 눈을 그 줄로 데려가는 것**뿐입니다.
 */

/** 낱말 수. 문장부호는 세지 않습니다 — `left.`와 `left`는 같은 한 낱말입니다. */
function words(s: string): number {
  return (s ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, ""))
    .filter(Boolean).length;
}

/** 문장으로 볼 최소 낱말 수. 이보다 짧으면 단어·구 답이라 길이를 안 봅니다. */
const SENTENCE_WORDS = 3;
/** 정답 대비 이 비율보다 짧으면 짚습니다. */
const SHORT_RATIO = 0.6;

/**
 * 정답이 문장인데 학생 답이 **눈에 띄게 짧은가.**
 *
 * 우리말 답(en2ko)은 정답이 한두 낱말이라 자연히 걸리지 않습니다. 단어
 * 시험도 마찬가지입니다. 걸리는 것은 **문장을 쓰라고 한 자리에 몇 낱말만
 * 쓴 경우**입니다.
 */
export function tooShort(written: string, expected: string): boolean {
  const e = words(expected);
  if (e < SENTENCE_WORDS) return false;
  return words(written) < e * SHORT_RATIO;
}
