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

/** 하루의 근무 시간. `null`이면 그날은 근무일이 아닙니다. */
export type DayHours = { start: number; end: number } | null;

/**
 * 요일별 근무 시간. **길이 7 고정**이고 0=일 … 6=토입니다.
 *
 * 처음에는 시작·끝 한 쌍에 근무 요일 목록을 붙였는데, 그러면 모든 요일이
 * 같은 시간이어야 합니다. 학원은 토요일만 오전이거나 금요일만 늦게 끝나는
 * 일이 흔하고, 그 상태로 두면 **'근무 시간 외'가 틀리게 세어집니다.**
 * 그 숫자는 직원을 의심하는 데 쓰이므로 기준이 틀리면 안 됩니다.
 */
export type WorkHours = DayHours[];

export const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

const WEEKDAY: DayHours = { start: 13, end: 23 };
export const DEFAULT_HOURS: WorkHours = [null, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY];

/**
 * DB에서 온 값을 믿을 수 있는 모양으로 바꿉니다.
 *
 * **모양이 아니면 `null`을 돌려줍니다 — 기본값으로 슬쩍 메우지 않습니다.**
 * 설정을 못 읽었는데 아무 일 없는 척하면
 *
 *   - 전부 근무 시간으로 치면 → 사적 사용이 조용히 묻히고
 *   - 전부 근무 시간 외로 치면 → 멀쩡한 직원이 무더기로 찍힙니다
 *
 * 둘 다 사람에 관한 판단이라 추측하면 안 됩니다. 못 읽었으면 못 읽었다고
 * 화면에 말하는 것이 맞습니다.
 *
 * 실제로 마이그레이션을 돌리기 전에 배포가 먼저 붙어 이 값이 `undefined`가
 * 됐고, 화면이 통째로 죽었습니다.
 */
export function normalizeHours(value: unknown): WorkHours | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const out: WorkHours = [];
  for (const v of value) {
    if (v === null || v === undefined) {
      out.push(null);
      continue;
    }
    const h = v as { start?: unknown; end?: unknown };
    if (typeof h.start !== "number" || typeof h.end !== "number") return null;
    if (h.start < 0 || h.end > 24 || h.start >= h.end) return null;
    out.push({ start: h.start, end: h.end });
  }
  return out;
}

/** 그 시각의 한국 기준 요일과 시각. */
export function kst(iso: string): { day: number; hour: number } {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  return { day: d.getUTCDay(), hour: d.getUTCHours() };
}

/**
 * 근무 시간 밖인가.
 *
 * 근무일이 아니면 시각과 무관하게 밖입니다 — 일요일 오후 3시는 근무가 아닙니다.
 * 설정이 깨져 그 요일 칸이 없으면 **근무일이 아닌 것으로 봅니다** —
 * 모르는 것을 근무 시간으로 세면 사적 사용이 조용히 묻힙니다.
 */
export function isOffHours(iso: string, w: WorkHours): boolean {
  const { day, hour } = kst(iso);
  const h = w[day];
  if (!h) return true;
  return hour < h.start || hour >= h.end;
}

const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;

/**
 * 사람이 읽는 한 줄. 같은 시간대끼리 묶습니다.
 *
 *   월·화·수·목·금 17:00~22:00 · 토 10:00~14:00
 *
 * 요일마다 한 줄씩 늘어놓으면 **일곱 줄이 되고 아무도 안 읽습니다.**
 * 무엇이 기준인지가 한눈에 들어와야 '근무 시간 외' 숫자를 믿을 수 있습니다.
 */
export function describeHours(w: WorkHours): string {
  const groups: { key: string; days: number[]; h: NonNullable<DayHours> }[] = [];
  for (let d = 0; d < 7; d++) {
    const h = w[d];
    if (!h) continue;
    const key = `${h.start}-${h.end}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.days.push(d);
    else groups.push({ key, days: [d], h });
  }
  if (!groups.length) return "근무일이 없습니다";
  return groups.map((g) => `${g.days.map((d) => DAY_NAMES[d]).join("·")} ${hh(g.h.start)}~${hh(g.h.end)}`).join(" · ");
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
 *
 * 근무 시간 밖인지를 **칸이 아니라 건별로** 셉니다. 요일마다 근무 시간이
 * 다르므로 "17시는 근무 시간"이라고 말할 수 없습니다 — 평일 17시는 근무이고
 * 일요일 17시는 아닙니다. 같은 칸에 둘이 섞이면 색으로 가를 수 없습니다.
 */
export function byHour(events: UsageEventRow[], w: WorkHours): { total: number; off: number }[] {
  const bins = Array.from({ length: 24 }, () => ({ total: 0, off: 0 }));
  for (const e of events) {
    const b = bins[kst(e.created_at).hour];
    b.total++;
    if (isOffHours(e.created_at, w)) b.off++;
  }
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
