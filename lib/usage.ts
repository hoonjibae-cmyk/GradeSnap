/**
 * "누가 언제 얼마나 썼는가"를 셈하는 규칙.
 *
 * 목적은 **근무 시간 외 사적 사용을 잡는 것**입니다. 답안지 한 장에 $0.14가
 * 나가고 그 돈은 학원이 냅니다.
 *
 * 화면에서 떼어놓은 이유는 시각 계산이 조용히 틀리기 쉽기 때문입니다 —
 * 서버는 UTC로 저장하고, 보는 사람은 서울에 있고, 관리자가 여행 중일 수도 있습니다.
 */

import type { UsageEventRow } from "@/lib/db/schema";

/** 한국은 서머타임이 없어 언제나 UTC+9입니다. 브라우저 시간대에 기대지 않습니다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface WorkHours {
  /** 시작 시각(0~23). 예: 13이면 오후 1시 */
  startHour: number;
  /** 끝 시각(1~24). 예: 23이면 밤 11시까지 */
  endHour: number;
  /** 0=일 … 6=토 */
  days: number[];
}

export const DEFAULT_HOURS: WorkHours = { startHour: 13, endHour: 23, days: [1, 2, 3, 4, 5, 6] };

/** 그 시각의 한국 기준 요일과 시각. */
export function kst(iso: string): { day: number; hour: number } {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  return { day: d.getUTCDay(), hour: d.getUTCHours() };
}

/**
 * 근무 시간 밖인가.
 *
 * 요일이 아니면 시각과 무관하게 밖입니다 — 일요일 오후 3시는 근무가 아닙니다.
 */
export function isOffHours(iso: string, w: WorkHours): boolean {
  const { day, hour } = kst(iso);
  if (!w.days.includes(day)) return true;
  return hour < w.startHour || hour >= w.endHour;
}

export interface StaffUsage {
  staffId: string | null;
  events: number;
  pages: number;
  costUsd: number;
  failed: number;
  /** 근무 시간 밖에서 일어난 것 — **이 숫자를 보려고 만든 화면입니다** */
  offHours: number;
  offHoursCost: number;
  /** 종류별. `quick`은 답안지를 안 남기는 호출이라 따로 봅니다. */
  byKind: Record<UsageEventRow["kind"], number>;
  firstAt: string | null;
  lastAt: string | null;
}

const empty = (staffId: string | null): StaffUsage => ({
  staffId,
  events: 0,
  pages: 0,
  costUsd: 0,
  failed: 0,
  offHours: 0,
  offHoursCost: 0,
  byKind: { grade: 0, quick: 0, trial: 0 },
  firstAt: null,
  lastAt: null,
});

/** 사람별로 모읍니다. 직원 행이 지워진 옛 기록은 `null` 키로 모입니다. */
export function byStaff(events: UsageEventRow[], w: WorkHours): StaffUsage[] {
  const m = new Map<string | null, StaffUsage>();
  for (const e of events) {
    const key = e.staff_id;
    const u = m.get(key) ?? m.set(key, empty(key)).get(key)!;
    const cost = Number(e.cost_usd ?? 0);
    u.events++;
    u.pages += e.pages;
    u.costUsd += cost;
    if (!e.ok) u.failed++;
    u.byKind[e.kind] = (u.byKind[e.kind] ?? 0) + 1;
    if (isOffHours(e.created_at, w)) {
      u.offHours++;
      u.offHoursCost += cost;
    }
    if (!u.firstAt || e.created_at < u.firstAt) u.firstAt = e.created_at;
    if (!u.lastAt || e.created_at > u.lastAt) u.lastAt = e.created_at;
  }
  // 많이 쓴 사람이 위로. 관리자가 먼저 볼 것은 규모입니다.
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * 시간대별 분포. 0~23시(한국 기준).
 *
 * 합계만 보면 "밤에 썼다"가 안 보입니다. **막대로 봐야 새벽 두 시가 튑니다.**
 */
export function byHour(events: UsageEventRow[]): number[] {
  const bins = Array<number>(24).fill(0);
  for (const e of events) bins[kst(e.created_at).hour]++;
  return bins;
}

export function totals(list: StaffUsage[]): Pick<StaffUsage, "events" | "pages" | "costUsd" | "offHours" | "offHoursCost"> {
  return list.reduce(
    (a, u) => ({
      events: a.events + u.events,
      pages: a.pages + u.pages,
      costUsd: a.costUsd + u.costUsd,
      offHours: a.offHours + u.offHours,
      offHoursCost: a.offHoursCost + u.offHoursCost,
    }),
    { events: 0, pages: 0, costUsd: 0, offHours: 0, offHoursCost: 0 },
  );
}
