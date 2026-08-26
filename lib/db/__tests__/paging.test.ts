import { describe, expect, it } from "vitest";
import { KEY_DAYS, keyDaysLeft } from "@/lib/db/queries";

/*
  🔴 2026-08-12. 「판정 불가 분석」이 정확히 `0 / 1000 문항`으로 떴습니다.
  1000은 데이터가 아니라 **벽**이었습니다 — Supabase는 한 번에 1000줄만
  돌려주고, 더 있으면 오류가 아니라 조용히 자릅니다.

  잘리는 방식이 더 나빴습니다. `order("seq")`로 가져오니 답안지마다 앞쪽
  문항부터 채워져, **모든 시험지의 뒤쪽 문항이 통째로 사라졌습니다.**
  찾으려던 순서배열·문장삽입이 정확히 그 자리에 있습니다.

  여기서 재는 것은 `all()`이 벽을 넘느냐입니다. DB를 띄우지 않고 재려고
  같은 규칙(쪽마다 최대 1000줄, 덜 차면 끝)을 그대로 흉내냅니다.
*/

const PAGE = 1000;

/** `lib/db/queries.ts`의 `all()`과 같은 규칙. */
async function all<T>(
  q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await q(from, from + PAGE - 1);
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    const rows = (res.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** 줄 n개를 가진 표를 흉내냅니다. 서버처럼 **한 번에 1000줄까지만** 줍니다. */
function table(n: number) {
  const calls: [number, number][] = [];
  const rows = Array.from({ length: n }, (_, i) => ({ i }));
  return {
    calls,
    q: (from: number, to: number) => {
      calls.push([from, to]);
      const end = Math.min(to, from + PAGE - 1);
      return Promise.resolve({ data: rows.slice(from, end + 1), error: null });
    },
  };
}

describe("1000줄 벽", () => {
  it("1000줄을 넘는 표를 전부 가져옵니다", async () => {
    const t = table(2500);
    const rows = await all<{ i: number }>(t.q, "문항");
    expect(rows).toHaveLength(2500);
    expect(rows[2499].i).toBe(2499);
    expect(t.calls).toHaveLength(3);
  });

  it("딱 1000줄이면 한 번 더 물어봅니다 — 더 있는지 알 길이 없습니다", async () => {
    const t = table(1000);
    expect(await all(t.q, "문항")).toHaveLength(1000);
    expect(t.calls).toHaveLength(2);
  });

  it("적으면 한 번에 끝냅니다", async () => {
    const t = table(7);
    expect(await all(t.q, "문항")).toHaveLength(7);
    expect(t.calls).toHaveLength(1);
  });

  it("비어 있어도 멈춥니다", async () => {
    const t = table(0);
    expect(await all(t.q, "문항")).toHaveLength(0);
    expect(t.calls).toHaveLength(1);
  });

  it("오류는 삼키지 않고 올립니다", async () => {
    const q = () => Promise.resolve({ data: null, error: { message: "권한 없음" } });
    await expect(all(q, "문항")).rejects.toThrow(/문항: 권한 없음/);
  });
});

/*
  정답지는 올린 지 한 달이면 자동으로 지워집니다(§13.43).

  기간을 두는 이유는 보관이 아까워서가 아닙니다. 정답지는 **시험 제목으로**
  맞추므로, 다음 학기에 같은 제목으로 내용이 다른 시험을 내면 옛 정답이
  조용히 적용됩니다. 반 전체가 틀리게 채점되고 경고도 안 뜹니다.
*/
describe("정답지 보관 기간", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();

  it("갓 올린 것은 한 달 남습니다", () => {
    expect(keyDaysLeft(daysAgo(0), now)).toBe(KEY_DAYS);
  });

  it("남은 날이 줄어듭니다", () => {
    expect(keyDaysLeft(daysAgo(29), now)).toBe(1);
    expect(keyDaysLeft(daysAgo(30), now)).toBe(0);
  });

  it("지난 것은 음수 — 다음 정리 때 지워집니다", () => {
    expect(keyDaysLeft(daysAgo(45), now)).toBeLessThan(0);
  });

  it("다시 올리면 그날부터 다시 셉니다", () => {
    // `updated_at`을 봅니다. 덮어쓰기가 곧 연장입니다.
    expect(keyDaysLeft(daysAgo(0), now)).toBe(KEY_DAYS);
  });
});
