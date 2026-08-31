import { describe, expect, it } from "vitest";
import { mapLimit } from "../parallel";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("동시에 하되 한꺼번에 다는 아니게", () => {
  it("🔴 결과는 **입력 순서대로**입니다 — 늦게 끝난 것이 뒤로 가면 안 됩니다", async () => {
    const out = await mapLimit([30, 1, 20, 2], 4, async (ms, i) => {
      await tick(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("🔴 동시에 도는 수가 뚜껑을 안 넘습니다 — 넘으면 429를 맞습니다", async () => {
    let now = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
      peak = Math.max(peak, ++now);
      await tick(5);
      now--;
    });
    expect(peak).toBe(3);
  });

  it("차례로 도는 것보다 빠릅니다 — 이게 이 함수를 넣은 이유입니다", async () => {
    const t0 = Date.now();
    await mapLimit([40, 40, 40, 40], 4, (ms) => tick(ms));
    // 차례로 돌면 160ms입니다. 넉넉히 잡아도 그 절반을 못 넘습니다.
    expect(Date.now() - t0).toBeLessThan(120);
  });

  it("쪽이 뚜껑보다 적으면 전부 동시에 — 흔한 경우(1~2쪽)가 이쪽입니다", async () => {
    let peak = 0;
    let now = 0;
    await mapLimit([1, 2], 4, async () => {
      peak = Math.max(peak, ++now);
      await tick(5);
      now--;
    });
    expect(peak).toBe(2);
  });

  it("빈 목록은 빈 결과", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it("뚜껑이 0이나 음수여도 멈추지 않습니다 — 최소 1명은 돕니다", async () => {
    expect(await mapLimit([1, 2, 3], 0, async (x) => x * 2)).toEqual([2, 4, 6]);
  });

  it("하나가 실패하면 그대로 던집니다", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("2쪽 읽기 실패");
        return x;
      }),
    ).rejects.toThrow("2쪽 읽기 실패");
  });

  it("실패해도 이미 나간 것은 끝까지 갑니다 — 취소할 수 없습니다", async () => {
    const finished: number[] = [];
    await mapLimit([1, 2], 2, async (x) => {
      await tick(x === 1 ? 20 : 1);
      finished.push(x);
      if (x === 2) throw new Error("실패");
      return x;
    }).catch(() => {});
    await tick(40);
    // 1쪽은 2쪽이 터진 뒤에도 제 할 일을 마칩니다. 돈은 이미 나갔습니다.
    expect(finished).toContain(1);
  });
});
