import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedImage } from "@/lib/image";
import type { JudgeResult, Transcript, Usage, Verdict, Warning } from "@/lib/grading/types";
import { normalizeGrading, type Effort } from "@/lib/grading/provider";
import type { RefStore } from "@/lib/grading/pipeline";
import { matchAnswerKey } from "@/lib/grading/match";
import { keyAsReference, keySlug } from "@/lib/grading/reference";
import {
  keepName,
  toItemRows,
  type AnswerKeyRow,
  type ExamRefRow,
  type ItemRow,
  type ModelTrialRow,
  type Role,
  type SettingsRow,
  type SheetPageRow,
  type SheetRow,
  type SheetStatus,
  type StaffRow,
  type UsageEventRow,
  type WrongItemRow,
} from "./schema";

/**
 * DB에 닿는 곳은 전부 여기입니다. 화면에서 직접 `.from('sheets')`를 부르지
 * 마십시오 — 상태 이름 하나 바뀌면 어디를 고쳐야 하는지 알 수 없게 됩니다.
 */

/**
 * 🔴 **1000줄 벽.**
 *
 * Supabase(PostgREST)는 한 번에 **최대 1000줄**만 돌려줍니다. 더 있으면
 * 오류가 아니라 **조용히 잘립니다.** 2026-08-12에 「판정 불가 분석」이
 * 정확히 `0 / 1000 문항`으로 떴고, 그 1000은 데이터가 아니라 **벽이었습니다.**
 *
 * 잘리는 방식이 더 나쁩니다. `order("seq")`로 가져오면 답안지마다 앞쪽
 * 문항부터 채워지므로, **모든 시험지의 뒤쪽 문항이 통째로 사라집니다.**
 * 순서배열·문장삽입은 대개 시험지 뒤쪽에 있습니다 — 찾으려던 것이 정확히
 * 안 보이는 자리에 있었습니다.
 *
 * 이 학원 규모(월 12,600장)에서는 문항·지출·오답 어느 것이든 하루치도
 * 1000을 넘깁니다. **화면이 조용히 적게 말하면 비용도 채점도 못 믿습니다.**
 */
const PAGE = 1000;

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
    // 마지막 쪽은 덜 찹니다. 딱 맞게 찼으면 다음 쪽이 있을 수 있습니다.
    if (rows.length < PAGE) return out;
  }
}

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

/**
 * 가입 신청 — 자기 행을 **비활성 조교로** 넣습니다(docs/13 §13.31).
 *
 * 이 행이 곧 신청서입니다. 관리자가 People에서 켜면 승인이고,
 * 켜기 전에는 is_staff()가 false라 아무것도 못 봅니다.
 * RLS가 active=false·role='assistant'가 아니면 거부합니다 —
 * 스스로 승인하거나 관리자가 되는 길은 DB가 막습니다.
 */
export async function requestAccess(db: SupabaseClient, name: string): Promise<void> {
  const { data: u } = await db.auth.getUser();
  if (!u.user) throw new Error("로그인이 필요합니다.");
  const res = await db.from("staff").insert({
    id: u.user.id,
    name: name.trim(),
    role: "assistant",
    active: false,
  });
  if (res.error) {
    // 이미 신청했으면(중복 키) 그대로 대기 화면으로 가면 됩니다.
    if (res.error.code === "23505") return;
    throw new Error(`가입 신청: ${res.error.message}`);
  }
}

/** 직원 명부 전부. 끈 사람도 보입니다 — 안 보이면 다시 켤 수가 없습니다. */
export async function allStaff(db: SupabaseClient): Promise<StaffRow[]> {
  return ok(
    await db.from("staff").select("*").order("active", { ascending: false }).order("name"),
    "직원 목록",
  ) as StaffRow[];
}

export async function updateStaff(
  db: SupabaseClient,
  id: string,
  patch: { name?: string; role?: Role; active?: boolean },
): Promise<void> {
  const res = await db.from("staff").update(patch).eq("id", id);
  if (res.error) throw new Error(`직원 수정: ${res.error.message}`);
}

// ---------------------------------------------------------------------------
// 근무 시간 · 사용 기록
// ---------------------------------------------------------------------------

export async function getSettings(db: SupabaseClient): Promise<SettingsRow> {
  return ok(await db.from("settings").select("*").eq("id", true).single(), "설정") as SettingsRow;
}

/**
 * 실제 채점이 쓸 설정. **여기가 유일한 출처입니다.**
 *
 * 예전에는 `GRADING_MODEL` 환경 변수였습니다. 옮긴 이유 둘:
 *
 *   1. 되돌리려면 Vercel에 들어가 재배포해야 했습니다. 원장님이 직접 못
 *      바꾸면 "되돌릴 수 있다"가 아닙니다.
 *   2. 환경 변수는 서버만 알아서 **조교 화면이 지금 무엇으로 채점되는지
 *      말할 수가 없었습니다.**
 *
 * 못 읽거나 모양이 아니면 **던집니다.** 엉뚱한 모델에 돈이 나가는 것보다
 * 채점이 멈추는 편이 낫습니다 — 멈추면 보이고, 틀리게 도는 것은 안 보입니다.
 */
export async function gradingOptions(
  db: SupabaseClient,
): Promise<{ model: string; effort: Effort; useRefs: boolean }> {
  const s = await getSettings(db);
  const g = normalizeGrading(s.grading_model, s.grading_effort);
  if (!g) {
    throw new Error(
      `채점 설정을 읽지 못했습니다 (모델 ${String(s.grading_model)} · 강도 ${String(s.grading_effort)}). ` +
        "관리 화면에서 다시 고르거나, 마이그레이션이 밀려 있는지 확인해 주십시오.",
    );
  }
  /*
    모델·강도와 달리 이 칸이 없으면 **끈 것으로 봅니다.** 없을 때의 동작이
    "지금까지와 완전히 같음"이라 안전하고, 채점을 멈출 이유가 없습니다.
  */
  return { ...g, useRefs: s.use_exam_refs === true };
}

/** 시험 참조를 켜고 끕니다. 관리 화면에서만 부릅니다. */
export async function saveUseExamRefs(db: SupabaseClient, on: boolean): Promise<void> {
  const res = await db
    .from("settings")
    .update({ use_exam_refs: on, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (res.error) throw new Error(`시험 참조 설정: ${res.error.message}`);
}

// ---------------------------------------------------------------------------
// 시험 참조 (docs/13 §13.27)
// ---------------------------------------------------------------------------

export async function getExamRef(db: SupabaseClient, fingerprint: string): Promise<ExamRefRow | null> {
  const res = await db.from("exam_refs").select("*").eq("fingerprint", fingerprint).maybeSingle();
  // 표가 아직 없으면(마이그레이션 지연) 참조 없이 갑니다 — 지금까지와 같은 경로입니다.
  if (res.error) {
    console.error("[exam_refs]", res.error.message);
    return null;
  }
  return (res.data as ExamRefRow) ?? null;
}

/**
 * 참조를 저장합니다. **충돌이면 먼저 것을 둡니다.**
 *
 * 조교 둘이 같은 시험의 첫 두 장을 동시에 채점하면 둘 다 저장하러 옵니다.
 * 나중 것으로 덮으면 반 중간에 정답 기준이 바뀝니다 — 일관성을 위해 만든
 * 것이 일관성을 깹니다. 먼저 온 것이 남습니다.
 */
export async function saveExamRef(
  db: SupabaseClient,
  ref: Omit<ExamRefRow, "created_by" | "created_at">,
): Promise<void> {
  const { data: u } = await db.auth.getUser();
  const res = await db
    .from("exam_refs")
    .upsert({ ...ref, created_by: u.user?.id ?? null }, { onConflict: "fingerprint", ignoreDuplicates: true });
  if (res.error) throw new Error(`시험 참조 저장: ${res.error.message}`);
}

/**
 * 지금까지 저장된 참조 개수. **켜져 있는데 0이면 아직 안 도는 것입니다.**
 *
 * 이 숫자를 화면에 내놓는 이유가 있습니다. 참조 기능은 스위치가 켜져 있는데
 * 코드가 한 번도 안 불린 채로 며칠을 보냈습니다(§13.34). 화면이 "켜짐"만
 * 말하면 그 상태를 아무도 눈치채지 못합니다. **동작의 증거를 보여줍니다.**
 */
export async function countExamRefs(db: SupabaseClient): Promise<number | null> {
  const res = await db.from("exam_refs").select("fingerprint", { count: "exact", head: true });
  // 표가 없으면(마이그레이션 지연) 숫자를 지어내지 않습니다.
  if (res.error) return null;
  return res.count ?? 0;
}

/**
 * 채점 흐름(`judgeSheet`)이 쓰는 참조 저장소.
 *
 * 흐름 쪽은 표도 RLS도 몰라야 테스트할 수 있습니다. 여기가 그 경계입니다.
 */
export function examRefs(db: SupabaseClient): RefStore {
  return {
    async get(fingerprint) {
      const row = await getExamRef(db, fingerprint);
      return row ? { fingerprint: row.fingerprint, title: row.title, items: row.items } : null;
    },
    /*
      사람이 등록한 정답지. 있으면 이것이 이깁니다.

      **제목이 똑같은 경우를 먼저 봅니다.** 색인 조회 한 번이고, 실제로
      대부분 여기서 끝납니다. 목록을 통째로 읽는 것은 그게 빗나갔을 때뿐이라
      흔한 길은 예전만큼 가볍습니다(§13.45).
    */
    async findKey(sheet) {
      const exact = await answerKeyFor(db, sheet.title);
      if (exact) {
        return {
          ref: keyAsReference(exact),
          how: "제목",
          why: `제목이 「${exact.title}」과 같습니다.`,
          ambiguous: [],
        };
      }
      // 정답지는 한 달이면 지워지므로 목록이 길어질 일이 없습니다(KEY_DAYS).
      const keys = await listAnswerKeys(db).catch((e) => {
        console.error("[answer_keys] 목록", e instanceof Error ? e.message : String(e));
        return [] as AnswerKeyRow[];
      });
      if (!keys.length) return { ref: null, ambiguous: [] };

      const { match, ambiguous } = matchAnswerKey(sheet, keys);
      if (!match) return { ref: null, ambiguous };
      return { ref: keyAsReference(match.key), how: match.how, why: match.why, ambiguous: [] };
    },
    async save(ref, sourceSheet) {
      await saveExamRef(db, { ...ref, source_sheet: sourceSheet });
    },
  };
}

// ---------------------------------------------------------------------------
// 정답지 (docs/13 §13.42)
// ---------------------------------------------------------------------------

/** 이 제목의 정답지. 없으면 null — 지금까지처럼 모델이 판정합니다. */
export async function answerKeyFor(db: SupabaseClient, title: string): Promise<AnswerKeyRow | null> {
  const slug = keySlug(title);
  if (!slug) return null;
  const res = await db.from("answer_keys").select("*").eq("slug", slug).maybeSingle();
  // 표가 아직 없으면(마이그레이션 지연) 정답지 없이 갑니다.
  if (res.error) {
    console.error("[answer_keys]", res.error.message);
    return null;
  }
  return (res.data as AnswerKeyRow) ?? null;
}

export async function listAnswerKeys(db: SupabaseClient): Promise<AnswerKeyRow[]> {
  return all<AnswerKeyRow>(
    (a, b) => db.from("answer_keys").select("*").order("updated_at", { ascending: false }).range(a, b),
    "정답지 목록",
  );
}

/**
 * 정답지를 등록합니다. **같은 제목이면 덮어씁니다.**
 *
 * 참조(`saveExamRef`)와 반대입니다. 저쪽은 먼저 것을 지키는데, 이쪽은
 * **사람이 일부러 다시 등록한 것**이라 새 것이 뜻입니다 — 잘못 읽힌 정답을
 * 고치는 길이 이것뿐입니다.
 */
export interface SaveKey {
  title: string;
  items: { no: string; expected: string; prompt?: string }[];
  note?: string;
  /**
   * 구글 폴더에서 가져온 것이면 그 파일. **사진으로 올렸으면 안 넘깁니다**
   * (§13.46) — 그래야 아무 파일도 목록에서 안 가립니다.
   */
  source?: { fileId: string; name: string; modified: string } | null;
}

export async function saveAnswerKey(db: SupabaseClient, k: SaveKey): Promise<void> {
  const slug = keySlug(k.title);
  if (!slug) throw new Error("시험 제목을 적어 주십시오. 제목으로 답안지와 맞춥니다.");
  if (!k.items.length) throw new Error("정답이 하나도 없습니다.");
  const { data: u } = await db.auth.getUser();
  const res = await db.from("answer_keys").upsert({
    slug,
    title: k.title.trim(),
    items: k.items,
    note: k.note ?? "",
    /*
      사진으로 올렸으면 **셋 다 비웁니다.** 같은 제목의 정답지를 예전에
      파일로 등록했다가 이번에 사진으로 다시 올린 경우, 옛 파일 연결이
      남아 있으면 그 파일이 목록에서 계속 숨습니다. 덮어쓰기가 뜻하는
      바는 "이번 것이 맞다"입니다.
    */
    source_file_id: k.source?.fileId ?? null,
    source_name: k.source?.name ?? null,
    source_modified: k.source?.modified ?? null,
    created_by: u.user?.id ?? null,
    updated_at: new Date().toISOString(),
  });
  if (res.error) throw new Error(`정답지 저장: ${res.error.message}`);
}

/**
 * 정답지 보관 기간. **한 달**입니다(§13.43).
 *
 * 시험 제목으로 맞추므로, 다음 학기에 같은 제목으로 **내용이 다른** 시험을
 * 내면 옛 정답지가 조용히 적용됩니다. 반 전체가 틀리게 채점되고 경고도
 * 안 뜹니다. 기간을 두는 이유가 그것입니다 — **오래된 정답은 위험합니다.**
 *
 * 다시 올리면 그날부터 다시 한 달입니다(`updated_at` 기준).
 */
export const KEY_DAYS = 30;

/** 이 정답지가 몇 날 뒤에 지워지는가. 0 이하면 이미 지날 것입니다. */
export function keyDaysLeft(updatedAt: string, now = new Date()): number {
  const gone = new Date(updatedAt).getTime() + KEY_DAYS * 86400000;
  return Math.ceil((gone - now.getTime()) / 86400000);
}

/**
 * 한 달이 지난 정답지를 지웁니다. **매일 새벽 정리 작업이 부릅니다.**
 *
 * 사진 정리와 같은 자리에 둡니다 — 따로 도는 것을 하나 더 만들면 그것만
 * 조용히 안 도는 날이 옵니다.
 */
export async function purgeAnswerKeys(admin: SupabaseClient, now = new Date()): Promise<number> {
  const cut = new Date(now.getTime() - KEY_DAYS * 86400000).toISOString();
  const res = await admin.from("answer_keys").delete().lt("updated_at", cut).select("slug");
  if (res.error) throw new Error(`정답지 정리: ${res.error.message}`);
  return (res.data ?? []).length;
}

export async function deleteAnswerKey(db: SupabaseClient, slug: string): Promise<void> {
  const res = await db.from("answer_keys").delete().eq("slug", slug);
  if (res.error) throw new Error(`정답지 삭제: ${res.error.message}`);
}

/** 관리자가 채점 모델을 바꿉니다. **다음 답안지부터 적용됩니다.** */
export async function saveGradingModel(db: SupabaseClient, model: string, effort: string): Promise<void> {
  const g = normalizeGrading(model, effort);
  if (!g) throw new Error(`쓸 수 없는 조합입니다: ${model} · ${effort}`);
  const res = await db
    .from("settings")
    .update({ grading_model: g.model, grading_effort: g.effort, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (res.error) throw new Error(`채점 모델 저장: ${res.error.message}`);
}

export async function saveSettings(db: SupabaseClient, workHours: SettingsRow["work_hours"]): Promise<void> {
  if (workHours.length !== 7) throw new Error("근무 시간은 요일 일곱 칸이라야 합니다.");
  const res = await db
    .from("settings")
    .update({ work_hours: workHours, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (res.error) throw new Error(`설정 저장: ${res.error.message}`);
}

/**
 * 지출 기록을 남깁니다. **실패해도 던지지 않습니다.**
 *
 * 기록을 못 남겼다고 채점 결과까지 버리면 학생이 손해입니다.
 * 돈은 이미 나갔고, 남길 수 있으면 남기고 아니면 로그로 흘립니다.
 */
export async function recordUsage(
  db: SupabaseClient,
  e: Omit<UsageEventRow, "id" | "staff_id" | "created_at">,
): Promise<void> {
  try {
    const { data: u } = await db.auth.getUser();
    if (!u.user) return;
    const res = await db.from("usage_events").insert({ ...e, staff_id: u.user.id });
    if (res.error) console.error("[usage]", res.error.message);
  } catch (err) {
    console.error("[usage]", err instanceof Error ? err.message : String(err));
  }
}

/** 기간 안의 사용 기록. 관리자는 전부, 나머지는 자기 것만 보입니다(RLS). */
export async function usageBetween(db: SupabaseClient, fromDay: string, toDay: string): Promise<UsageEventRow[]> {
  return all<UsageEventRow>(
    (a, b) =>
      db
        .from("usage_events")
        .select("*")
        .gte("created_at", `${fromDay}T00:00:00`)
        .lte("created_at", `${toDay}T23:59:59.999`)
        .order("created_at", { ascending: false })
        .range(a, b),
    "사용 기록",
  );
}

// ---------------------------------------------------------------------------
// 접수
// ---------------------------------------------------------------------------

export const BUCKET = "sheets";

export interface Intake {
  /** 반. 안 골라도 됩니다. 고르면 조교 화면에 남아 다음 학생에도 그대로 붙습니다. */
  className: string;
  /**
   * 학생 이름. 안 적으면 시험지 머리말에서 읽습니다.
   *
   * **반과 달리 다음 학생에게 남기면 안 됩니다.** 남으면 다음 답안지가
   * 앞 학생 이름을 달고 채점되고, 그건 조용히 틀립니다.
   */
  studentName: string;
  /** 머리말이 가려 커트라인이 안 읽힐 때만. 보통 비웁니다. */
  cutLine: string;
  strictSpelling: boolean;
}

/**
 * 한 학생분을 접수합니다. **순서가 중요합니다.**
 *
 * 1. 행을 `uploading`으로 만듭니다 (사진 행이 가리킬 대상이 필요하므로)
 * 2. 사진을 스토리지에 올립니다
 * 3. 사진 행을 만듭니다
 * 4. 그제서야 `queued`로 바꿉니다 ← 여기서부터 채점 대상입니다
 *
 * 중간에 끊기면 `uploading`인 채로 남습니다. 큐가 안 건드리므로 안전하고,
 * 화면에서 "올리는 중"으로 보여 지우면 됩니다.
 */
export async function intake(db: SupabaseClient, images: PreparedImage[], opts: Intake): Promise<SheetRow> {
  if (!images.length) throw new Error("사진이 없습니다.");
  const { data: u } = await db.auth.getUser();

  const sheet = ok(
    await db
      .from("sheets")
      .insert({
        class_name: opts.className.trim(),
        student_name: opts.studentName.trim(),
        cut_line: opts.cutLine.trim() || null,
        strict_spelling: opts.strictSpelling,
        received_by: u.user?.id ?? null,
      })
      .select()
      .single(),
    "접수",
  ) as SheetRow;

  const pages: Omit<SheetPageRow, "id" | "created_at" | "purged_at">[] = [];
  for (const [idx, img] of images.entries()) {
    const path = `${sheet.id}/${idx}.jpg`;
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

  return ok(
    await db.from("sheets").update({ status: "queued" }).eq("id", sheet.id).select().single(),
    "채점 걸기",
  ) as SheetRow;
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

// ---------------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------------

/** 그날 접수된 것 전부. 조교 둘이 같은 화면을 봅니다 — 남의 것도 보입니다. */
export async function sheetsOn(db: SupabaseClient, day: string): Promise<SheetRow[]> {
  const from = `${day}T00:00:00`;
  const to = `${day}T23:59:59.999`;
  return all<SheetRow>(
    (a, b) =>
      db
        .from("sheets")
        .select("*")
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: false })
        .range(a, b),
    "접수 목록",
  );
}

/**
 * 기간 안에 채점된 답안지. **비용을 재는 데 씁니다.**
 *
 * `usage_events`에는 달러만 있고 토큰이 없습니다. "어디에 돈이 나가는가"는
 * 토큰을 봐야 알 수 있고, 그건 `sheets.token_usage`에만 있습니다.
 */
export async function gradedBetween(db: SupabaseClient, fromDay: string, toDay: string): Promise<SheetRow[]> {
  return all<SheetRow>(
    (a, b) =>
      db
        .from("sheets")
        .select("*")
        .gte("created_at", `${fromDay}T00:00:00`)
        .lte("created_at", `${toDay}T23:59:59.999`)
        .not("graded_at", "is", null)
        .order("created_at", { ascending: false })
        .range(a, b),
    "채점 기록",
  );
}

/**
 * 그날의 오답 전부. `wrong_items` 뷰는 **선생님이 고친 값**으로 걸러집니다.
 *
 * 확정 여부로 거르지 않습니다 — 아직 확정 안 된 답안지의 오답도 보여야
 * "명단이 아직 덜 됐다"를 알 수 있습니다. 거르는 것은 화면이 합니다.
 */
export async function wrongItemsOn(db: SupabaseClient, day: string): Promise<WrongItemRow[]> {
  return all<WrongItemRow>(
    (a, b) => db.from("wrong_items").select("*").eq("received_on", day).order("seq").range(a, b),
    "오답 목록",
  );
}

export async function getSheet(db: SupabaseClient, id: string): Promise<SheetRow> {
  return ok(await db.from("sheets").select("*").eq("id", id).single(), "답안지") as SheetRow;
}

export async function itemsOf(db: SupabaseClient, sheetId: string): Promise<ItemRow[]> {
  return ok(await db.from("items").select("*").eq("sheet_id", sheetId).order("seq"), "문항") as ItemRow[];
}

/** 여러 답안지의 문항을 한 번에. 모델 비교 화면이 장마다 질의하지 않도록. */
export async function itemsFor(db: SupabaseClient, sheetIds: string[]): Promise<ItemRow[]> {
  if (!sheetIds.length) return [];
  // 답안지 일곱 장이면 벌써 1000문항입니다. **한 쪽으로 안 끝납니다.**
  return all<ItemRow>(
    (from, to) => db.from("items").select("*").in("sheet_id", sheetIds).order("seq").range(from, to),
    "문항",
  );
}

/** 사진을 잠깐 볼 수 있는 주소. 비공개 버킷이라 서명 URL로만 봅니다. */
export async function pageUrls(db: SupabaseClient, sheetId: string, seconds = 600): Promise<string[]> {
  const pages = await pagesOf(db, sheetId);
  if (!pages.length) return [];
  const res = await db.storage.from(BUCKET).createSignedUrls(pages.map((p) => p.storage_path), seconds);
  if (res.error) throw new Error(`사진 주소: ${res.error.message}`);
  // 한 장이 실패해도 나머지는 보여줍니다 — 검수가 사진 하나 때문에 막히면 안 됩니다.
  return (res.data ?? []).flatMap((d) => (d.signedUrl ? [d.signedUrl] : []));
}

/**
 * 선생님이 문항 판정을 고칩니다. `null`이면 시스템 판정으로 되돌립니다.
 *
 * **시스템과 같은 값이라도 눌렀으면 기록합니다.** "사람이 보고 그대로 뒀다"와
 * "아무도 안 봤다"는 다른 사실이고, 검수를 줄일지 판단할 때 필요한 것은 앞쪽입니다.
 */
export async function setTeacherVerdict(db: SupabaseClient, itemId: string, correct: boolean | null): Promise<void> {
  const { data: u } = await db.auth.getUser();
  const res = await db
    .from("items")
    .update({
      teacher_correct: correct,
      reviewed_by: correct === null ? null : (u.user?.id ?? null),
      reviewed_at: correct === null ? null : new Date().toISOString(),
    })
    .eq("id", itemId);
  if (res.error) throw new Error(`판정 고치기: ${res.error.message}`);
}

/**
 * 확정합니다. **이게 실제로 나가는 결과입니다.**
 * 조교가 누르면 DB의 트리거가 막습니다 — 화면에서도 감추지만 경계는 DB입니다.
 */
export async function confirmSheet(db: SupabaseClient, sheetId: string, verdict: Verdict): Promise<void> {
  const res = await db.from("sheets").update({ status: "confirmed", final_verdict: verdict }).eq("id", sheetId);
  if (res.error) throw new Error(`확정: ${res.error.message}`);
}

/** 확정을 되돌립니다. 잘못 눌렀을 때 나갈 길이 있어야 합니다. */
export async function unconfirmSheet(db: SupabaseClient, sheetId: string): Promise<void> {
  const res = await db
    .from("sheets")
    .update({ status: "graded", final_verdict: null, confirmed_by: null, confirmed_at: null })
    .eq("id", sheetId);
  if (res.error) throw new Error(`확정 취소: ${res.error.message}`);
}

/**
 * 이름과 반을 고칩니다.
 *
 * 시험지 머리말이 흐리거나 학생이 이름을 흘려 써 잘못 읽히는 일이 있습니다.
 * **채점을 다시 돌릴 일이 아니라 글자만 고치면 되는 일**이라 따로 뒀습니다.
 */
export async function updateSheetInfo(
  db: SupabaseClient,
  sheetId: string,
  patch: { student_name?: string; class_name?: string },
): Promise<void> {
  const res = await db
    .from("sheets")
    .update({
      ...(patch.student_name !== undefined ? { student_name: patch.student_name.trim() } : {}),
      ...(patch.class_name !== undefined ? { class_name: patch.class_name.trim() } : {}),
    })
    .eq("id", sheetId);
  if (res.error) throw new Error(`이름 고치기: ${res.error.message}`);
}

/**
 * 한 학생의 답안지 전부 — **동의 철회 처리용**(docs/14 §14.7).
 *
 * **정확히 같은 이름만** 찾습니다(공백만 다듬음). 부분 일치로 하면
 * '김예진'을 지우다 '김예진아'가 걸립니다. 동명이인은 화면이 반·날짜를
 * 같이 보여줘 사람이 가립니다 — 코드가 추측하지 않습니다.
 */
export async function sheetsOfStudent(db: SupabaseClient, name: string): Promise<SheetRow[]> {
  const n = name.trim();
  if (!n) return [];
  return ok(
    await db.from("sheets").select("*").eq("student_name", n).order("created_at", { ascending: false }),
    "학생 답안지 찾기",
  ) as SheetRow[];
}

/** 올리다 만 것, 실패한 것을 지웁니다. 사진 행은 FK로 같이 사라집니다. */
export async function deleteSheet(db: SupabaseClient, sheet: SheetRow): Promise<void> {
  const paths = ok(
    await db.from("sheet_pages").select("storage_path").eq("sheet_id", sheet.id),
    "사진 경로",
  ) as { storage_path: string }[];
  if (paths.length) await db.storage.from(BUCKET).remove(paths.map((p) => p.storage_path));
  const res = await db.from("sheets").delete().eq("id", sheet.id);
  if (res.error) throw new Error(`답안지 지우기: ${res.error.message}`);
}

/** 실패한 것을 사람이 보고 다시 돌립니다. `attempts`도 0으로 되돌립니다. */
/**
 * 채점을 **중단**합니다. 뒷장을 안 찍고 접수한 것을 알아챘을 때입니다.
 *
 * 끝난 답안지는 못 멈춥니다(`in` 목록). 채점됨·확정을 되돌리는 것은 중단이
 * 아니라 다른 일이고, 그걸 이 단추로 하게 두면 검수한 결과가 사라집니다.
 *
 * 🔴 **모델 호출 자체는 못 멈춥니다.** 이미 요청이 나갔으면 그 호출은
 * 끝까지 갑니다. 여기서 하는 일은 **그 결과를 안 쓰는 것**이고
 * (`saveGrading`이 확인합니다), 이미 쓴 돈은 기록에 그대로 남습니다.
 * 아직 안 집힌 것(`queued`)을 멈추면 한 푼도 안 나갑니다.
 */
export async function cancelSheet(db: SupabaseClient, sheetId: string): Promise<void> {
  const res = await db
    .from("sheets")
    .update({ status: "cancelled", error: null })
    .eq("id", sheetId)
    .in("status", ["uploading", "queued", "running"]);
  if (res.error) throw new Error(`채점 중단: ${res.error.message}`);
}

export async function retrySheet(db: SupabaseClient, sheetId: string): Promise<void> {
  const res = await db.from("sheets").update({ status: "queued", attempts: 0, error: null }).eq("id", sheetId);
  if (res.error) throw new Error(`다시 시도: ${res.error.message}`);
}

// ---------------------------------------------------------------------------
// 채점 (서버에서만 부릅니다)
// ---------------------------------------------------------------------------

/**
 * 채점할 답안지를 집습니다.
 *
 * - `sheetId`를 주면 그것만 — 방금 접수한 장입니다.
 * - 안 주면 떠도는 것 아무거나 — 조교가 창을 닫아 남겨진 것을 쓸어담습니다.
 *
 * 남이 이미 집었으면 null입니다. 그게 정상이고, 부르는 쪽은 그냥 멈추면 됩니다.
 */
export async function claim(db: SupabaseClient, sheetId?: string): Promise<SheetRow | null> {
  const res = sheetId
    ? await db.rpc("claim_sheet", { p_id: sheetId })
    : await db.rpc("claim_next", { p_limit: 1 });
  if (res.error) throw new Error(`대기열: ${res.error.message}`);
  return ((res.data ?? []) as SheetRow[])[0] ?? null;
}

export async function pagesOf(db: SupabaseClient, sheetId: string): Promise<SheetPageRow[]> {
  return ok(
    await db.from("sheet_pages").select("*").eq("sheet_id", sheetId).is("purged_at", null).order("idx"),
    "사진 불러오기",
  ) as SheetPageRow[];
}

/**
 * 여러 답안지의 사진 기록. **크기를 보려고 씁니다.**
 *
 * 2026-08-11에 사진이 입력의 65%인 줄 알고 해상도를 줄여봤는데 23%였습니다.
 * 그 65%는 제가 시스템 프롬프트를 750토큰으로 어림잡아 뺀 값이었습니다.
 * **저장된 사진의 실제 크기는 여기 이미 있었습니다.**
 */
export async function pagesFor(db: SupabaseClient, sheetIds: string[]): Promise<SheetPageRow[]> {
  if (!sheetIds.length) return [];
  /*
    `.limit()`으로는 1000줄 벽을 못 넘습니다 — 서버가 그 위에서 다시 자릅니다.
    넘는 방법은 쪽을 나눠 여러 번 묻는 것뿐입니다.
  */
  return all<SheetPageRow>(
    (a, b) => db.from("sheet_pages").select("*").in("sheet_id", sheetIds).is("purged_at", null).range(a, b),
    "사진 기록",
  );
}

/** 스토리지에서 내려받아 base64로. 모델에 보낼 모양 그대로입니다. */
export async function downloadPage(db: SupabaseClient, path: string): Promise<string> {
  const res = await db.storage.from(BUCKET).download(path);
  if (res.error || !res.data) throw new Error(`사진 내려받기(${path}): ${res.error?.message ?? "없음"}`);
  return Buffer.from(await res.data.arrayBuffer()).toString("base64");
}

// ---------------------------------------------------------------------------
// 사진 보관 — 90일
// ---------------------------------------------------------------------------

export interface RetentionStatus {
  /** 아직 갖고 있는 사진 수 */
  kept: number;
  /** 보관 기간이 지나 지워야 할 사진 수 */
  expired: number;
  /** 지운 뒤 행만 남은 것 */
  purged: number;
  /** 갖고 있는 것 중 가장 오래된 사진의 날짜 */
  oldest: string | null;
}

export async function retentionStatus(db: SupabaseClient): Promise<RetentionStatus> {
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const res = await q;
    if (res.error) throw new Error(`보관 현황: ${res.error.message}`);
    return res.count ?? 0;
  };
  const kept = await count(db.from("sheet_pages").select("id", { count: "exact", head: true }).is("purged_at", null));
  const purged = await count(db.from("sheet_pages").select("id", { count: "exact", head: true }).not("purged_at", "is", null));
  const expired = await count(db.from("expired_pages").select("id", { count: "exact", head: true }));

  const res = await db
    .from("sheet_pages")
    .select("created_at")
    .is("purged_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error) throw new Error(`보관 현황: ${res.error.message}`);

  return { kept, purged, expired, oldest: (res.data as { created_at: string } | null)?.created_at ?? null };
}

export interface Purged {
  deleted: number;
  rounds: number;
  /** 지울 게 더 남았는데 한 번에 다 못 한 경우. 다음 실행이 이어서 합니다. */
  remaining: boolean;
}

/**
 * 보관 기간이 지난 사진을 **파일까지** 지웁니다.
 *
 * `service_role`로 도는 정리 작업 전용입니다 — 부르는 사람의 세션이 없습니다.
 *
 * **순서가 중요합니다: 파일 먼저, 도장은 나중.**
 * 거꾸로 하면 "지웠다"고 적어놓고 파일이 남는 일이 생깁니다. 그건 학부모에게
 * 한 약속을 어기는 것입니다. 반대로 파일만 지우고 도장을 못 찍으면 다음 실행이
 * 없는 파일을 한 번 더 지우려 할 뿐이고, 그건 아무 해가 없습니다.
 *
 * **행은 남깁니다.** 무엇이 있었는지는 기록입니다(docs/13 §13.7).
 */
export async function purgeExpired(admin: SupabaseClient, batch = 100, maxRounds = 20): Promise<Purged> {
  let deleted = 0;
  let rounds = 0;

  for (; rounds < maxRounds; rounds++) {
    const res = await admin.from("expired_pages").select("id, storage_path").limit(batch);
    if (res.error) throw new Error(`만료 목록: ${res.error.message}`);
    const rows = (res.data ?? []) as { id: string; storage_path: string }[];
    if (!rows.length) return { deleted, rounds, remaining: false };

    const rm = await admin.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
    if (rm.error) throw new Error(`사진 삭제: ${rm.error.message}`);

    const up = await admin
      .from("sheet_pages")
      .update({ purged_at: new Date().toISOString() })
      .in(
        "id",
        rows.map((r) => r.id),
      );
    if (up.error) throw new Error(`삭제 기록: ${up.error.message}`);

    deleted += rows.length;
  }

  // 한 번에 다 못 지웠습니다. 남은 것은 다음 실행이 가져갑니다.
  return { deleted, rounds, remaining: true };
}

// ---------------------------------------------------------------------------
// 모델 비교 실험
// ---------------------------------------------------------------------------

/** 그날 답안지들에 대해 돌려본 기록. 최신 것이 앞에 옵니다. */
export async function trialsOn(db: SupabaseClient, sheetIds: string[]): Promise<ModelTrialRow[]> {
  if (!sheetIds.length) return [];
  return all<ModelTrialRow>(
    (a, b) =>
      db.from("model_trials").select("*").in("sheet_id", sheetIds).order("created_at", { ascending: false }).range(a, b),
    "실험 기록",
  );
}

export async function saveTrial(
  db: SupabaseClient,
  row: Omit<ModelTrialRow, "id" | "created_at" | "created_by">,
): Promise<void> {
  const { data: u } = await db.auth.getUser();
  const res = await db.from("model_trials").insert({ ...row, created_by: u.user?.id ?? null });
  if (res.error) throw new Error(`실험 기록: ${res.error.message}`);
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
  /** 단가를 모르는 모델이면 null. 0으로 적으면 공짜로 보입니다. */
  costUsd: number | null;
}

/**
 * 채점 결과를 씁니다. **문항 행을 먼저 지웁니다** — 재시도로 두 번 채점되면
 * 같은 문항이 두 벌 쌓이고, 그러면 오답 개수가 두 배가 됩니다.
 */
/**
 * 채점 결과를 저장합니다. **중단된 답안지면 아무것도 안 쓰고 `false`.**
 */
export async function saveGrading(db: SupabaseClient, sheetId: string, g: Grading): Promise<boolean> {
  // 지금 적혀 있는 이름을 먼저 봅니다 — 접수할 때 적었거나 검수에서 고친 것일 수 있습니다.
  const cur = await db.from("sheets").select("student_name, status").eq("id", sheetId).maybeSingle();
  const current = cur.data as { student_name: string; status: SheetStatus } | null;

  /*
    🔴 **중단된 답안지에는 결과를 안 씁니다.**

    조교가 중단을 눌러도 이미 나간 모델 호출은 끝까지 갑니다. 그 결과를
    그대로 저장하면 **중단 단추가 아무 일도 안 한 것이 됩니다** — 뒷장이
    빠진 채로 채점된 결과가 화면에 뜨고, 조교는 자기가 멈춘 줄 압니다.
    돈은 이미 나갔고 그건 기록에 남습니다. 여기서 막는 것은 결과입니다.
  */
  if (current?.status === "cancelled") return false;

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
      // 사람이 적어둔 이름을 시험지에서 읽은 이름으로 덮지 않습니다.
      student_name: keepName(current?.student_name, g.transcript.sheet.student),
      title: g.transcript.sheet.title ?? "",
      transcript: g.transcript,
      warnings: g.warnings,
      printed_total: g.transcript.sheet.printedTotal || null,
      ...verdictFields(g),
      token_usage: g.usage,
      cost_usd: g.costUsd,
      graded_at: new Date().toISOString(),
    })
    .eq("id", sheetId);
  if (up.error) throw new Error(`채점 결과 저장: ${up.error.message}`);
  return true;
}

/** 판정에 관한 칸들. 커트라인만 다시 넣고 셀 때도 같은 모양이라야 합니다. */
function verdictFields(g: Pick<Grading, "missing" | "robustToMissing" | "cut" | "nWrong" | "verdict" | "nearBoundary" | "margin">) {
  return {
    missing: g.missing,
    robust_to_missing: g.robustToMissing,
    cut: g.cut,
    n_wrong: g.nWrong,
    verdict: g.verdict,
    near_boundary: g.nearBoundary,
    margin: g.margin,
  };
}

/**
 * 커트라인만 다시 넣어 판정을 고쳐 셉니다. **모델을 다시 부르지 않습니다** —
 * 전사도 판정도 이미 있고 모자란 건 숫자 하나뿐인데, 다시 부르면 $0.14입니다.
 */
export async function recount(
  db: SupabaseClient,
  sheetId: string,
  cutLine: string,
  g: Parameters<typeof verdictFields>[0],
): Promise<void> {
  const up = await db
    .from("sheets")
    .update({ cut_line: cutLine.trim() || null, ...verdictFields(g) })
    .eq("id", sheetId);
  if (up.error) throw new Error(`커트라인 반영: ${up.error.message}`);
}

/**
 * 실패를 기록합니다. **`queued`로 되돌리지 않습니다** —
 * 되돌리면 무한히 재시도하고, 조교는 왜 안 되는지 볼 새가 없습니다.
 */
export async function saveFailure(db: SupabaseClient, sheetId: string, message: string): Promise<void> {
  /*
    **중단한 것을 실패로 덮지 않습니다.** 조교가 멈춘 뒤에 그 호출이 터지면
    화면에 "실패"가 뜨고 「다시」 단추가 나옵니다. 다시 돌릴 이유가 없는
    답안지에 다시 돌리라고 권하는 셈이고, 누르면 돈이 또 나갑니다.
  */
  await db
    .from("sheets")
    .update({ status: "failed", error: message.slice(0, 500) })
    .eq("id", sheetId)
    .neq("status", "cancelled");
}
