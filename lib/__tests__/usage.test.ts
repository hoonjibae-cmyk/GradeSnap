import { describe, expect, it } from "vitest";
import type { UsageEventRow } from "@/lib/db/schema";
import { byHour, byStaff, DEFAULT_HOURS, describeHours, isOffHours, kst, totals, type WorkHours } from "../usage";

/** 2026-08-10은 월요일입니다. */
const mon = (hhmmKst: string) => {
  const [h, m] = hhmmKst.split(":").map(Number);
  // KST를 UTC로: 9시간 빼기
  return new Date(Date.UTC(2026, 7, 10, h - 9, m)).toISOString();
};

const ev = (o: Partial<UsageEventRow> & { created_at: string }): UsageEventRow => ({
  id: Math.random().toString(36),
  staff_id: "a",
  kind: "grade",
  sheet_id: null,
  pages: 2,
  cost_usd: 0.1,
  latency_ms: 1000,
  model: "claude-opus-5",
  effort: "low",
  ok: true,
  ...o,
});

describe("한국 시간으로 읽기", () => {
  it("UTC로 저장된 시각을 한국 기준 요일·시각으로 바꾼다", () => {
    // 2026-08-09T20:00Z = 2026-08-10 05:00 KST (월요일 새벽)
    expect(kst("2026-08-09T20:00:00Z")).toEqual({ day: 1, hour: 5 });
  });

  it("자정을 넘겨도 날짜가 같이 넘어간다", () => {
    // 2026-08-09T16:00Z = 2026-08-10 01:00 KST — 일요일이 아니라 월요일입니다
    expect(kst("2026-08-09T16:00:00Z").day).toBe(1);
  });
});

describe("근무 시간 밖인가", () => {
  it("근무일 근무 시간 안이면 아니다", () => {
    expect(isOffHours(mon("15:00"), DEFAULT_HOURS)).toBe(false);
  });

  it("근무일이라도 시작 전이면 밖이다", () => {
    expect(isOffHours(mon("09:00"), DEFAULT_HOURS)).toBe(true);
  });

  it("끝 시각은 포함하지 않는다 — 23시면 23:00부터 밖이다", () => {
    expect(isOffHours(mon("22:59"), DEFAULT_HOURS)).toBe(false);
    expect(isOffHours(mon("23:00"), DEFAULT_HOURS)).toBe(true);
  });

  it("새벽 두 시는 밖이다 — 이걸 잡으려고 만들었다", () => {
    expect(isOffHours(mon("02:00"), DEFAULT_HOURS)).toBe(true);
  });

  it("요일마다 근무 시간이 다르면 각자 자기 시간으로 본다", () => {
    // 토요일만 오전 근무. 토 15시는 밖이고 월 15시는 안입니다.
    const w: WorkHours = [null, { start: 13, end: 23 }, null, null, null, null, { start: 9, end: 13 }];
    const sat15 = new Date(Date.UTC(2026, 7, 8, 6, 0)).toISOString(); // 토 15:00 KST
    expect(kst(sat15).day).toBe(6);
    expect(isOffHours(sat15, w)).toBe(true);
    expect(isOffHours(mon("15:00"), w)).toBe(false);
  });

  it("근무일이 아니면 시각과 무관하게 밖이다", () => {
    // 일요일 오후 3시. 근무 시간대이지만 근무일이 아닙니다.
    const sun = new Date(Date.UTC(2026, 7, 9, 6, 0)).toISOString(); // 15:00 KST 일요일
    expect(kst(sun).day).toBe(0);
    expect(isOffHours(sun, DEFAULT_HOURS)).toBe(true);
  });
});

describe("사람별로 모으기", () => {
  it("근무 시간 외 건수와 비용을 따로 센다", () => {
    const [u] = byStaff(
      [ev({ created_at: mon("15:00") }), ev({ created_at: mon("03:00"), cost_usd: 0.25 })],
      DEFAULT_HOURS,
    );
    expect(u.events).toBe(2);
    expect(u.offHours).toBe(1);
    expect(u.offHoursCost).toBeCloseTo(0.25);
    expect(u.costUsd).toBeCloseTo(0.35);
  });

  it("빠른 시험을 따로 센다 — 답안지를 안 남기는 호출이라 사적 사용이 여기로 샌다", () => {
    const [u] = byStaff([ev({ created_at: mon("15:00"), kind: "quick" })], DEFAULT_HOURS);
    expect(u.byKind.quick).toBe(1);
    expect(u.byKind.grade).toBe(0);
  });

  it("실패한 호출도 센다 — 돈은 나갔을 수 있다", () => {
    const [u] = byStaff([ev({ created_at: mon("15:00"), ok: false })], DEFAULT_HOURS);
    expect(u.failed).toBe(1);
  });

  it("직원이 지워진 옛 기록도 버리지 않는다", () => {
    const rows = byStaff([ev({ created_at: mon("15:00"), staff_id: null })], DEFAULT_HOURS);
    expect(rows).toHaveLength(1);
    expect(rows[0].staffId).toBeNull();
  });

  it("많이 쓴 사람이 위로 온다", () => {
    const rows = byStaff(
      [
        ev({ created_at: mon("15:00"), staff_id: "a", cost_usd: 0.1 }),
        ev({ created_at: mon("15:00"), staff_id: "b", cost_usd: 0.9 }),
      ],
      DEFAULT_HOURS,
    );
    expect(rows.map((r) => r.staffId)).toEqual(["b", "a"]);
  });

  it("처음과 마지막 시각을 잡는다", () => {
    const [u] = byStaff([ev({ created_at: mon("20:00") }), ev({ created_at: mon("14:00") })], DEFAULT_HOURS);
    expect(u.firstAt).toBe(mon("14:00"));
    expect(u.lastAt).toBe(mon("20:00"));
  });
});

describe("시간대별 분포", () => {
  it("한국 기준 시각에 담는다", () => {
    const bins = byHour([ev({ created_at: mon("02:00") }), ev({ created_at: mon("02:30") })], DEFAULT_HOURS);
    expect(bins[2].total).toBe(2);
    expect(bins).toHaveLength(24);
  });

  it("근무 시간 밖인지를 칸이 아니라 건별로 센다", () => {
    /*
      같은 15시라도 월요일은 근무이고 일요일은 아닙니다. 칸 단위로 색을 매기면
      둘을 못 가릅니다 — 요일마다 근무 시간이 다르므로 "15시는 근무"라고
      말할 수 없습니다.
    */
    const sun15 = new Date(Date.UTC(2026, 7, 9, 6, 0)).toISOString(); // 일 15:00 KST
    const bins = byHour([ev({ created_at: mon("15:00") }), ev({ created_at: sun15 })], DEFAULT_HOURS);
    expect(bins[15]).toEqual({ total: 2, off: 1 });
  });
});

describe("근무 시간을 한 줄로 적기", () => {
  const w = (...days: (readonly [number, number] | null)[]): WorkHours =>
    days.map((d) => (d ? { start: d[0], end: d[1] } : null));

  it("같은 시간대끼리 묶는다", () => {
    // 일곱 줄로 늘어놓으면 아무도 안 읽습니다.
    const s = describeHours(w(null, [17, 22], [17, 22], [17, 22], [17, 22], [17, 22], [10, 14]));
    expect(s).toBe("월·화·수·목·금 17:00~22:00 · 토 10:00~14:00");
  });

  it("요일 순서를 지킨다", () => {
    expect(describeHours(w([9, 12], [13, 23], null, null, null, null, null))).toBe("일 09:00~12:00 · 월 13:00~23:00");
  });

  it("근무일이 하나도 없으면 그렇게 말한다", () => {
    expect(describeHours(w(null, null, null, null, null, null, null))).toBe("근무일이 없습니다");
  });
});

describe("합계", () => {
  it("사람별 합을 다시 더한다", () => {
    const rows = byStaff(
      [ev({ created_at: mon("03:00"), staff_id: "a" }), ev({ created_at: mon("15:00"), staff_id: "b" })],
      DEFAULT_HOURS,
    );
    expect(totals(rows)).toMatchObject({ events: 2, pages: 4, offHours: 1 });
  });
});
