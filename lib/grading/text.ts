/** 표기 비교용 정규화와 글자 판별. `tools/grade_page.py`의 `_norm`/`_has_hangul`. */

/**
 * 공백·대소문자·유니코드 형태만 통일합니다.
 *
 * **철자는 절대 건드리지 않습니다.** 여기서 관대해지면 채점이 거짓말을 합니다.
 */
export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s​]+/g, " ");
}

export function hasHangul(s: string): boolean {
  return /[가-힣]/.test(s);
}

/** 번호 정렬용 키. "12" → 12, "3)" → 3, 숫자가 없으면 맨 뒤. */
export function numKey(s: string): number {
  const m = /^\s*(\d+)/.exec(s ?? "");
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function byNumber(a: string, b: string): number {
  return numKey(a) - numKey(b) || a.localeCompare(b);
}
