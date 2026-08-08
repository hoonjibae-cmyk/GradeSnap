/**
 * `supabase/migrations`의 표를 TypeScript로 옮긴 것입니다.
 *
 * Supabase의 타입 생성기를 쓰지 않고 손으로 씁니다. 표가 여덟 개도 안 되고,
 * **주석이 스키마의 절반**이라 생성된 파일로 대체되면 근거가 사라집니다.
 * 마이그레이션을 고치면 여기도 같이 고쳐야 합니다.
 */

import type { Direction, Item, JudgeResult, Sheet as SheetHead, Usage, Verdict, Warning } from "@/lib/grading/types";

export type Role = "assistant" | "teacher" | "admin";
/** queued → running → graded → confirmed. 실패하면 failed. */
export type SheetStatus = "queued" | "running" | "graded" | "failed" | "confirmed";

export interface StaffRow {
  id: string;
  name: string;
  role: Role;
  created_at: string;
}

export interface ExamRow {
  id: string;
  title: string;
  class_name: string;
  exam_date: string;
  /** 인쇄 표기 그대로. null이면 시험지 머리말에서 읽습니다. */
  cut_line: string | null;
  strict_spelling: boolean;
  status: "open" | "closed";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SheetRow {
  id: string;
  exam_id: string;
  student_name: string;
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

export interface ExamProgressRow {
  exam_id: string;
  total: number;
  pending: number;
  graded: number;
  confirmed: number;
  failed: number;
  /** 경계선·밀림·판정 보류 — **사람이 반드시 봐야 하는 것** */
  needs_review: number;
  cost_usd: number;
}

/** 저장할 때 쓰는 모양. 생성 칼럼(`final_correct`·`overturned`)은 빠집니다. */
export type ItemInsert = Omit<ItemRow, "id" | "final_correct" | "overturned">;

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
