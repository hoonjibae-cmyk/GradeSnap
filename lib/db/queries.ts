import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedImage } from "@/lib/image";
import type { JudgeResult, Transcript, Usage, Verdict, Warning } from "@/lib/grading/types";
import { toItemRows, type ExamProgressRow, type ExamRow, type SheetPageRow, type SheetRow, type StaffRow } from "./schema";

/**
 * DB에 닿는 곳은 전부 여기입니다. 화면에서 직접 `.from('sheets')`를 부르지
 * 마십시오 — 상태 이름 하나 바뀌면 어디를 고쳐야 하는지 알 수 없게 됩니다.
 */

/** 던지면 던진 대로 올립니다. 조용히 빈 값을 돌려주면 화면이 거짓말을 합니다. */
function ok<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: 결과가 없습니다.`);
  return res.data;
}

// ---------------------------------------------------------------------------
// 직원
// ---------------------------------------------------------------------------

/** 로그인은 했지만 직원 명부에 없으면 null. 그 사람은 아무것도 못 봅니다. */
export async function me(db: SupabaseClient): Promise<StaffRow | null> {
  const { data } = await db.auth.getUser();
  if (!data.user) return null;
  const res = await db.from("staff").select("*").eq("id", data.user.id).maybeSingle();
  if (res.error) throw new Error(`직원 확인: ${res.error.message}`);
  return (res.data as StaffRow) ?? null;
}

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------

export interface NewExam {
  title: string;
  className: string;
  examDate: string;
  /** 인쇄 표기 그대로. 비우면 시험지 머리말에서 읽습니다. */
  cutLine: string;
  strictSpelling: boolean;
}

export async function createExam(db: SupabaseClient, e: NewExam): Promise<ExamRow> {
  const { data: u } = await db.auth.getUser();
  return ok(
    await db
      .from("exams")
      .insert({
        title: e.title,
        class_name: e.className,
        exam_date: e.examDate,
        cut_line: e.cutLine.trim() || null,
        strict_spelling: e.strictSpelling,
        created_by: u.user?.id ?? null,
      })
      .select()
      .single(),
    "시험 만들기",
  ) as ExamRow;
}

export async function listExams(db: SupabaseClient, limit = 50): Promise<ExamRow[]> {
  return ok(
    await db.from("exams").select("*").order("exam_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit),
    "시험 목록",
  ) as ExamRow[];
}

export async function getExam(db: SupabaseClient, id: string): Promise<ExamRow> {
  return ok(await db.from("exams").select("*").eq("id", id).single(), "시험 불러오기") as ExamRow;
}

export async function progress(db: SupabaseClient, examId: string): Promise<ExamProgressRow> {
  return ok(await db.from("exam_progress").select("*").eq("exam_id", examId).single(), "진행 상황") as ExamProgressRow;
}

// ---------------------------------------------------------------------------
// 답안지 올리기
// ---------------------------------------------------------------------------

export const BUCKET = "sheets";

/**
 * 한 학생분을 올립니다. **순서가 중요합니다.**
 *
 * 1. 행을 `uploading`으로 만듭니다 (사진 행이 가리킬 대상이 필요하므로)
 * 2. 사진을 스토리지에 올립니다
 * 3. 사진 행을 만듭니다
 * 4. 그제서야 `queued`로 바꿉니다 ← 큐가 여기서부터 집어갑니다
 *
 * 중간에 끊기면 `uploading`인 채로 남습니다. 큐가 안 건드리므로 안전하고,
 * 화면에서 "올리다 만 것"으로 보여 지우면 됩니다.
 */
export async function uploadSheet(db: SupabaseClient, examId: string, images: PreparedImage[]): Promise<SheetRow> {
  if (!images.length) throw new Error("사진이 없습니다.");

  const sheet = ok(await db.from("sheets").insert({ exam_id: examId }).select().single(), "답안지 만들기") as SheetRow;

  const pages: Omit<SheetPageRow, "id" | "created_at" | "purged_at">[] = [];
  for (const [idx, img] of images.entries()) {
    const path = `${examId}/${sheet.id}/${idx}.jpg`;
    const up = await db.storage.from(BUCKET).upload(path, base64ToBlob(img.base64, img.mediaType), {
      contentType: img.mediaType,
      upsert: true,
    });
    if (up.error) throw new Error(`사진 올리기(${idx + 1}장): ${up.error.message}`);
    pages.push({
      sheet_id: sheet.id,
      idx,
      storage_path: path,
      rotation: img.rotation,
      width: img.width,
      height: img.height,
      bytes: img.bytes,
    });
  }

  const ins = await db.from("sheet_pages").insert(pages);
  if (ins.error) throw new Error(`사진 기록: ${ins.error.message}`);

  return ok(await db.from("sheets").update({ status: "queued" }).eq("id", sheet.id).select().single(), "대기열에 넣기") as SheetRow;
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

export async function listSheets(db: SupabaseClient, examId: string): Promise<SheetRow[]> {
  return ok(
    await db.from("sheets").select("*").eq("exam_id", examId).order("created_at", { ascending: true }),
    "답안지 목록",
  ) as SheetRow[];
}

/** 올리다 만 것을 지웁니다. 사진 행은 FK로 같이 사라집니다. */
export async function deleteSheet(db: SupabaseClient, sheet: SheetRow): Promise<void> {
  const paths = ok(
    await db.from("sheet_pages").select("storage_path").eq("sheet_id", sheet.id),
    "사진 경로",
  ) as { storage_path: string }[];
  if (paths.length) await db.storage.from(BUCKET).remove(paths.map((p) => p.storage_path));
  const res = await db.from("sheets").delete().eq("id", sheet.id);
  if (res.error) throw new Error(`답안지 지우기: ${res.error.message}`);
}

// ---------------------------------------------------------------------------
// 채점 (서버에서만 부릅니다)
// ---------------------------------------------------------------------------

/** 큐에서 한 장 집어옵니다. 아무것도 없으면 null — 그러면 다 끝난 것입니다. */
export async function claimOne(db: SupabaseClient, examId: string): Promise<SheetRow | null> {
  const res = await db.rpc("claim_sheets", { p_exam: examId, p_limit: 1 });
  if (res.error) throw new Error(`대기열: ${res.error.message}`);
  const rows = (res.data ?? []) as SheetRow[];
  return rows[0] ?? null;
}

export async function pagesOf(db: SupabaseClient, sheetId: string): Promise<SheetPageRow[]> {
  return ok(
    await db.from("sheet_pages").select("*").eq("sheet_id", sheetId).is("purged_at", null).order("idx"),
    "사진 불러오기",
  ) as SheetPageRow[];
}

/** 스토리지에서 내려받아 base64로. 모델에 보낼 모양 그대로입니다. */
export async function downloadPage(db: SupabaseClient, path: string): Promise<string> {
  const res = await db.storage.from(BUCKET).download(path);
  if (res.error || !res.data) throw new Error(`사진 내려받기(${path}): ${res.error?.message ?? "없음"}`);
  return Buffer.from(await res.data.arrayBuffer()).toString("base64");
}

export interface Grading {
  transcript: Transcript;
  warnings: Warning[];
  results: JudgeResult[];
  missing: number;
  robustToMissing: boolean;
  cut: number | null;
  nWrong: number;
  verdict: Verdict | null;
  nearBoundary: boolean;
  margin: number | null;
  usage: Usage[];
  costUsd: number;
}

/**
 * 채점 결과를 씁니다. **문항 행을 먼저 지웁니다** — 재시도로 두 번 채점되면
 * 같은 문항이 두 벌 쌓이고, 그러면 오답 개수가 두 배가 됩니다.
 */
export async function saveGrading(db: SupabaseClient, sheetId: string, g: Grading): Promise<void> {
  const del = await db.from("items").delete().eq("sheet_id", sheetId);
  if (del.error) throw new Error(`이전 채점 지우기: ${del.error.message}`);

  const rows = toItemRows(sheetId, g.transcript.items, g.results);
  if (rows.length) {
    const ins = await db.from("items").insert(rows);
    if (ins.error) throw new Error(`문항 저장: ${ins.error.message}`);
  }

  const up = await db
    .from("sheets")
    .update({
      status: "graded",
      error: null,
      student_name: g.transcript.sheet.student ?? "",
      transcript: g.transcript,
      warnings: g.warnings,
      printed_total: g.transcript.sheet.printedTotal || null,
      missing: g.missing,
      robust_to_missing: g.robustToMissing,
      cut: g.cut,
      n_wrong: g.nWrong,
      verdict: g.verdict,
      near_boundary: g.nearBoundary,
      margin: g.margin,
      token_usage: g.usage,
      cost_usd: g.costUsd,
      graded_at: new Date().toISOString(),
    })
    .eq("id", sheetId);
  if (up.error) throw new Error(`채점 결과 저장: ${up.error.message}`);
}

/**
 * 실패를 기록합니다. **`queued`로 되돌리지 않습니다** —
 * `claim_sheets`가 `attempts < 3`으로 다시 집어가므로, 여기서 되돌리면
 * 실패한 이유를 조교가 볼 새도 없이 무한히 재시도합니다.
 */
export async function saveFailure(db: SupabaseClient, sheetId: string, message: string): Promise<void> {
  await db.from("sheets").update({ status: "failed", error: message.slice(0, 500) }).eq("id", sheetId);
}

/** 실패한 것을 사람이 보고 다시 돌립니다. `attempts`도 0으로 되돌립니다. */
export async function retrySheet(db: SupabaseClient, sheetId: string): Promise<void> {
  const res = await db.from("sheets").update({ status: "queued", attempts: 0, error: null }).eq("id", sheetId);
  if (res.error) throw new Error(`다시 시도: ${res.error.message}`);
}
