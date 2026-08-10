/**
 * 눈에 안 보이는 차이를 보이게 만듭니다.
 *
 * `/bench`의 "전사가 다른 칸"은 이 시스템에서 **고쳐 읽기가 숨는 자리**입니다.
 * 그런데 화면에 `frequent → frequent`처럼 **같아 보이는 짝**이 뜨는 일이
 * 생겼습니다(2026-08-10, 두 학생 모두 31번).
 *
 * 그러면 원장님은 둘 중 하나를 하게 됩니다.
 *
 *   - 화면이 틀렸다고 보고 **다른 칸까지 안 믿거나**
 *   - 그 줄을 그냥 넘기거나
 *
 * 둘 다 나쁩니다. 비교하려고 만든 화면이 **"다르다"고만 하고 어디가 다른지
 * 못 보여주면 그 줄은 없는 것만 못합니다.**
 *
 * 같아 보이는 짝이 나오는 길은 둘뿐입니다.
 *
 *   1. 자리를 안 차지하는 문자(폭 없는 공백, BOM 등) → `markHidden`이 드러냄
 *   2. 모양이 같은 다른 문자(키릴 `е` vs 라틴 `e`) → `oddChars`가 짚어냄
 */

/**
 * 자리를 차지하지 않거나 글자 모양이 없는 문자.
 *
 * 모델이 이런 걸 뱉을 이유는 없지만, 뱉으면 `norm()`을 통과해 "다른 칸"으로
 * 잡히면서 화면에서는 안 보입니다. 정확히 이 조합이 사람을 헷갈리게 합니다.
 */
const HIDDEN =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufeff\uffa0]/g;

/**
 * 이 시험지에 **나올 법한** 문자.
 *
 * 영어 낱말과 한글 뜻, 그리고 흔한 문장 부호입니다. 여기 없는 문자가 섞여
 * 있으면 대개 모양만 같은 다른 글자입니다 — 키릴 `а·е·о`, 전각 라틴 문자 등.
 *
 * **합쳐서 같은 것으로 치지 않습니다.** 서로 다른 문자가 맞고, `norm()`이
 * 다르다고 본 것도 맞습니다. 다만 화면이 왜 다른지 말해줄 뿐입니다.
 */
const EXPECTED =
  /[\u0020-\u007e\u00b7\u2013\u2014\u2018\u2019\u201c\u201d\u2026\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/;

const code = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/** 안 보이는 문자를 `⟨U+200B⟩`로 바꿔 자리를 드러냅니다. 나머지는 그대로. */
export function markHidden(s: string): string {
  return s.replace(HIDDEN, (ch) => `⟨${code(ch)}⟩`);
}

/**
 * 예상 밖 문자가 섞였으면 어떤 것인지 한 줄로. 없으면 `null`.
 *
 * 안 보이는 문자는 `markHidden`이 이미 드러내므로 여기서 다시 말하지
 * 않습니다 — 같은 얘기를 두 번 하면 화면이 시끄러워집니다.
 */
export function oddChars(s: string): string | null {
  const odd = [...s.replace(HIDDEN, "")].filter((ch) => !EXPECTED.test(ch));
  if (!odd.length) return null;
  const uniq = [...new Set(odd)];
  return uniq.map((ch) => `${ch} ${code(ch)}`).join(", ");
}
