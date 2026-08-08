/**
 * 찍은 순서대로 쭉 올린 사진을 **학생별로 자릅니다.**
 *
 * 조교에게 "이 사진은 누구 것"을 일일이 시키지 않으려는 것입니다. 한 반은
 * 같은 시험지를 쓰므로 장수가 같고, 그러면 N장씩 끊으면 맞습니다.
 *
 * **다만 어긋날 때가 있습니다** — 한 장을 다시 찍었거나, 뒷면이 없는 학생이
 * 섞였거나. 그래서 경계를 사람이 하나씩 옮길 수 있게 두고, 여기서는
 * 그 경계 집합만 받습니다. 자동은 기본값을 깔아줄 뿐입니다.
 */

/** `n`장씩 끊는 기본 경계. `n`번째마다 새 학생이 시작합니다. */
export function defaultBreaks(count: number, n: number): Set<number> {
  const s = new Set<number>();
  if (n < 1) return s;
  for (let i = n; i < count; i += n) s.add(i);
  return s;
}

/** 경계 인덱스를 기준으로 자릅니다. 0번은 언제나 첫 학생의 시작입니다. */
export function groupsOf<T>(items: T[], breaks: Set<number>): T[][] {
  const out: T[][] = [];
  items.forEach((it, i) => {
    if (i === 0 || breaks.has(i)) out.push([]);
    out[out.length - 1].push(it);
  });
  return out;
}
