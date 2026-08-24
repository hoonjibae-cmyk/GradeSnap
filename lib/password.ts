/**
 * 비밀번호 규칙. **한 곳에서만 정합니다.**
 *
 * 예전에는 관리자 화면이 10자를 요구하고 가입 화면은 6자라고 적어 놨습니다.
 * 같은 시스템이 두 가지를 말하면 조교는 둘 다 안 믿습니다.
 */

/**
 * 최소 길이.
 *
 * Supabase 기본은 6자입니다. 더 받는 이유는 **조교들이 학생 앞 공용 공간에서
 * 쓰는 계정**이기 때문입니다. 어깨너머로 보이고, 화면은 학생 이름과 성적으로
 * 이어집니다.
 */
export const MIN_PASSWORD = 10;

/**
 * 새 비밀번호가 쓸 만한가. **문제가 있으면 그 문장을 돌려줍니다.**
 *
 * `null`이 통과입니다. 화면이 규칙을 따로 적어두면 규칙이 두 벌이 되므로,
 * 판단도 문장도 여기서 만듭니다.
 */
export function checkNewPassword(current: string, next: string, confirm: string): string | null {
  if (!current) return "지금 쓰는 비밀번호를 넣어 주십시오.";
  if (next.length < MIN_PASSWORD) return `새 비밀번호는 ${MIN_PASSWORD}자 이상이라야 합니다.`;
  if (next !== confirm) return "새 비밀번호 두 칸이 서로 다릅니다.";
  if (next === current) return "지금 쓰는 것과 같습니다. 다른 것으로 정해 주십시오.";
  return null;
}
