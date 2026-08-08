/**
 * `supabase/migrations`의 표를 TypeScript로 옮긴 것입니다.
 *
 * Supabase의 타입 생성기를 쓰지 않고 손으로 씁니다. 표가 다섯 개도 안 되고,
 * **주석이 스키마의 절반**이라 생성된 파일로 대체되면 근거가 사라집니다.
 * 마이그레이션을 고치면 여기도 같이 고쳐야 합니다.
 */

import type { Direction, Item, JudgeResult, Sheet as SheetHead, Usage, Verdict, Warning } from "@/lib/grading/types";

export type Role = "assistant" | "teacher" | "admin";

/**
 * uploading → queued → running → graded → confirmed. 실패하면 failed.
 *
 * `uploading`이 따로 있는 이유: 행을 먼저 만들어야 사진 행이 그걸 가리킬 수
 * 있는데, 그 사이에 `queued`면 **사진 없는 답안지를 채점하러 갑니다.**
 */
export type SheetStatus = "uploading" | "queued" | "running" | "graded" | "failed" | "confirmed";

export interface StaffRow {
  id: string;
  name: string;
  role: Role;
  /**
   * 끈 직원. **지우지 않고 끕니다** — 행을 지우면 그 사람이 채점한 기록이
   * 주인을 잃고, "누가 받았나"를 영영 못 답합니다.
   */
  active: boolean;
  created_at: string;
}

/** 학원이 정하는 근무 시간. 무엇이 '근무 시간 외'인지의 기준입니다. */
export interface SettingsRow {
  id: boolean;
  work_start: number;
  work_end: number;
  /** 0=일 … 6=토 */
  work_days: number[];
  updated_at: string;
}

/**
 * 돈이 나간 호출 하나. `sheets`와 겹치는 것 같지만 다른 사실입니다 —
 * 저쪽은 **무엇을 채점했는가**, 이쪽은 **누가 언제 돈을 썼는가**입니다.
 * 특히 '빠른 시험'은 답안지 행이 없어 **여기가 유일한 기록**입니다.
 */
export interface UsageEventRow {
  id: string;
  staff_id: string | null;
  kind: "grade" | "quick" | "trial";
  sheet_id: string | null;
  pages: number;
  cost_usd: number | null;
  latency_ms: number | null;
  model: string | null;
  effort: string | null;
  ok: boolean;
  created_at: string;
}

/**
 * 답안지 한 벌 — **접수의 단위이자 채점의 단위**입니다.
 *
 * 시험 표가 따로 없습니다. 같은 반이라도 학생마다 보는 시험이 달라서,
 * 묶을 것이 없기 때문입니다. 시험 이름은 머리말에서 읽어 `title`에 둡니다.
 */
export interface SheetRow {
  id: string;
  /** 반. 조교가 한 번 골라두면 다음 학생부터 그대로 씁니다. 빈 값이어도 됩니다. */
  class_name: string;
  /** 시험 이름. 머리말에서 읽습니다. */
  title: string;
  student_name: string;
  /** 커트라인 직접 입력. 머리말이 빨간펜에 가렸을 때만 씁니다. */
  cut_line: string | null;
  strict_spelling: boolean;
  received_by: string | null;

  status: SheetStatus;
  attempts: number;
  claimed_at: string | null;
  claimed_by: string | null;
  error: string | null;

  transcript: { sheet: SheetHead; items: Item[] } | null;
  warnings: Warning[];
  printed_total: number | null;
  missing: number | null;
  robust_to_missing: boolean | null;
  cut: number | null;
  n_wrong: number | null;
  verdict: Verdict | null;
  near_boundary: boolean | null;
  margin: number | null;
  token_usage: Usage[] | null;
  cost_usd: number | null;
  graded_at: string | null;

  final_verdict: Verdict | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SheetPageRow {
  id: string;
  sheet_id: string;
  idx: number;
  storage_path: string;
  rotation: 0 | 90 | 180 | 270;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: string;
  purged_at: string | null;
}

export interface ItemRow {
  id: string;
  sheet_id: string;
  seq: number;
  no: string;
  prompt: string;
  direction: Direction | null;
  prefix: string;
  written: string;
  blank: boolean;
  legible: boolean;
  erased: boolean;
  confidence: number | null;
  correct: boolean | null;
  expected: string;
  note: string;
  /** 선생님이 바꾼 것만 채워집니다. null이면 시스템 판정 그대로입니다. */
  teacher_correct: boolean | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  /** DB가 계산합니다 — 쓰지 마십시오. `coalesce(teacher_correct, correct)` */
  final_correct: boolean | null;
  /** DB가 계산합니다 — 쓰지 마십시오. 우리가 틀렸던 건입니다. */
  overturned: boolean;
}

/** 저장할 때 쓰는 모양. 생성 칼럼(`final_correct`·`overturned`)은 빠집니다. */
export type ItemInsert = Omit<ItemRow, "id" | "final_correct" | "overturned">;

/**
 * 값싼 모델로 다시 채점해 본 기록. **실제 채점 결과와 섞지 않습니다** —
 * `sheets`·`items`는 학생에게 나간 것이고, 여기는 "만약 다른 모델이었다면"입니다.
 */
export interface ModelTrialRow {
  id: string;
  sheet_id: string;
  model: string;
  effort: string;
  transcript: { sheet: SheetHead; items: Item[] } | null;
  results: JudgeResult[] | null;
  warnings: Warning[];
  missing: number | null;
  cut: number | null;
  n_wrong: number | null;
  verdict: Verdict | null;
  near_boundary: boolean | null;
  margin: number | null;
  token_usage: Usage[] | null;
  cost_usd: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
  created_by: string | null;
}

/** `wrong_items` 뷰 한 줄. 선생님이 고친 값이 반영된 오답입니다. */
export interface WrongItemRow {
  sheet_id: string;
  received_on: string;
  class_name: string;
  student_name: string;
  title: string;
  seq: number;
  no: string;
  prompt: string;
  written: string;
  expected: string;
  note: string;
  overturned: boolean;
}

/** 사람이 반드시 봐야 하는 답안지. 목록에서 이걸로 셉니다. */
export function needsReview(s: SheetRow): boolean {
  if (s.status !== "graded") return false;
  return Boolean(s.near_boundary) || s.verdict === null || (s.warnings ?? []).some((w) => w.level === "drift");
}

/**
 * 전사 결과와 판정 결과를 문항 행으로 붙입니다.
 *
 * 둘은 **다른 호출**이라 서로 빠질 수 있습니다. 판정이 없는 문항도 행은
 * 남깁니다 — 무엇을 읽었는지가 기록이고, `correct`가 null이면 화면이 그렇게
 * 보여주면 됩니다. 조용히 버리면 문항 수가 안 맞습니다.
 */
export function toItemRows(sheetId: string, items: Item[], results: JudgeResult[]): ItemInsert[] {
  const byNo = new Map(results.map((r) => [r.no, r]));
  return items.map((it, i) => {
    const j = byNo.get(it.no);
    return {
      sheet_id: sheetId,
      seq: i,
      no: it.no,
      prompt: it.prompt,
      direction: it.direction,
      prefix: it.prefix,
      written: it.written,
      blank: it.blank,
      legible: it.legible,
      erased: it.erased,
      confidence: it.confidence,
      correct: j ? j.correct : null,
      expected: j?.expected ?? "",
      note: j?.note ?? "",
      teacher_correct: null,
      reviewed_by: null,
      reviewed_at: null,
    };
  });
}

/**
 * 저장된 문항 행에서 판정 결과를 되살립니다. 다시 셀 때 씁니다.
 *
 * **선생님이 고친 값을 씁니다**(`final_correct`). 그래야 검수한 대로 오답이
 * 세어지고, 커트라인에 걸리는지도 검수 결과 기준으로 다시 판단됩니다.
 * 판정이 아예 없는 문항은 오답으로 셉니다 — 모르는 것을 통과 쪽으로
 * 기울이면 학생이 잘못 집에 갑니다.
 */
export function toJudgeResults(
  rows: { no: string; correct?: boolean | null; final_correct?: boolean | null; expected: string; note: string }[],
): JudgeResult[] {
  return rows.map((r) => ({
    no: r.no,
    correct: (r.final_correct ?? r.correct) ?? false,
    expected: r.expected,
    note: r.note,
  }));
}
