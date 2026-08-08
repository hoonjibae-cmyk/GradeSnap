import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedImage } from "@/lib/image";
import type { JudgeResult, Transcript, Usage, Verdict, Warning } from "@/lib/grading/types";
import {
  toItemRows,
  type ItemRow,
  type ModelTrialRow,
  type SheetPageRow,
  type SheetRow,
  type StaffRow,
  type WrongItemRow,
} from "./schema";

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
// 접수
// ---------------------------------------------------------------------------

export const BUCKET = "sheets";

export interface Intake {
  /** 반. 안 골라도 됩니다. 고르면 조교 화면에 남아 다음 학생에도 그대로 붙습니다. */
  className: string;
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
  return ok(
    await db.from("sheets").select("*").gte("created_at", from).lte("created_at", to).order("created_at", { ascending: false }),
    "접수 목록",
  ) as SheetRow[];
}

/**
 * 그날의 오답 전부. `wrong_items` 뷰는 **선생님이 고친 값**으로 걸러집니다.
 *
 * 확정 여부로 거르지 않습니다 — 아직 확정 안 된 답안지의 오답도 보여야
 * "명단이 아직 덜 됐다"를 알 수 있습니다. 거르는 것은 화면이 합니다.
 */
export async function wrongItemsOn(db: SupabaseClient, day: string): Promise<WrongItemRow[]> {
  return ok(
    await db.from("wrong_items").select("*").eq("received_on", day).order("seq"),
    "오답 목록",
  ) as WrongItemRow[];
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
  return ok(await db.from("items").select("*").in("sheet_id", sheetIds).order("seq"), "문항") as ItemRow[];
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
  return ok(
    await db.from("model_trials").select("*").in("sheet_id", sheetIds).order("created_at", { ascending: false }),
    "실험 기록",
  ) as ModelTrialRow[];
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
  await db.from("sheets").update({ status: "failed", error: message.slice(0, 500) }).eq("id", sheetId);
}
