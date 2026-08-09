/**
 * 최근에 쓴 값 몇 개를 기억합니다. 지금은 반 이름에만 씁니다.
 *
 * **왜 '그대로 남기기'가 아니라 '최근 목록'인가.**
 *
 * 반을 접수 후에도 남겨두면 타이핑은 0번이지만, 반이 바뀌었는데 조교가
 * 못 보고 넘기면 **앞 반 이름을 달고 접수됩니다.** 화면에는 아무 표시도 안 뜹니다.
 * 커트라인을 미리 안 받기로 한 것과 같은 이유입니다 — 조용히 틀리는 쪽이
 * 가장 나쁩니다.
 *
 * 최근 목록은 한 번 누르는 값을 받고 그 위험을 없앱니다. 같은 반이 이어지면
 * 한 번 누르면 되고, 반이 바뀌면 **누르지 않는 한 아무 반도 안 붙습니다.**
 */

export const MAX_RECENT = 6;

/**
 * 값을 목록 맨 앞에 올립니다. 이미 있으면 자리를 옮깁니다.
 *
 * 대소문자·앞뒤 공백만 다른 것은 같은 반으로 봅니다 — '중3 A'와 '중3 a'가
 * 따로 쌓이면 목록이 금세 쓸모없어집니다.
 */
export function pushRecent(list: string[], value: string, max = MAX_RECENT): string[] {
  const v = value.trim();
  if (!v) return list;
  const key = v.toLowerCase();
  return [v, ...list.filter((x) => x.trim().toLowerCase() !== key)].slice(0, max);
}
