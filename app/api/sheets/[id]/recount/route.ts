import { NextResponse } from "next/server";
import { compare } from "@/lib/grading/compare";
import { bearer, userClient } from "@/lib/db/client";
import { getSheet, itemsOf, recount } from "@/lib/db/queries";
import { toJudgeResults } from "@/lib/db/schema";
import { isOpen } from "@/lib/grading/unjudged";

export const runtime = "nodejs";

/**
 * 저장된 문항으로 **판정만 다시 셉니다. 모델을 부르지 않습니다.**
 *
 * 두 가지 경우에 부릅니다.
 *
 * | 언제 | 본문 |
 * |---|---|
 * | 커트라인을 뒤늦게 넣을 때 (빨간펜이 머리말을 덮었던 경우) | `{cutLine}` |
 * | 선생님이 문항 판정을 고쳤을 때 | `{}` |
 *
 * 둘 다 모자란 것은 숫자 몇 개뿐입니다. 다시 채점하면 $0.14가 또 나가고,
 * **더 나쁜 것은 결과가 달라질 수 있다는 점**입니다 — 선생님이 방금 검수한
 * 내용이 새 전사로 덮여버립니다.
 *
 * 셈은 언제나 `final_correct`(선생님이 고친 값)로 합니다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await params;
  let cutLine: string | undefined;
  try {
    const body = (await req.json()) as { cutLine?: string };
    cutLine = body?.cutLine?.trim() || undefined;
  } catch {
    cutLine = undefined;
  }

  try {
    const db = userClient(token);
    const sheet = await getSheet(db, id);
    if (!sheet.graded_at) return NextResponse.json({ error: "아직 채점되지 않았습니다." }, { status: 400 });

    // 넣어준 값 > 조교가 전에 넣어둔 값 > 시험지에서 읽은 값
    const cutText = cutLine ?? sheet.cut_line ?? sheet.transcript?.sheet.cutLine ?? "";
    /*
      🔴 **다시 셀 때도 같은 규칙입니다**(§13.40).

      정답을 알 수 없어 판정 못 한 문항을 여기서 오답으로 세면, 검수 화면에서
      다른 문항 하나만 고쳐도 **판정이 조용히 뒤집힙니다.** 채점 때와 다시 셀
      때가 다르면 어느 쪽도 못 믿습니다.

      단, **사람이 그 문항을 직접 채점했으면 더 이상 모름이 아닙니다.**
    */
    const rows = await itemsOf(db, id);
    const open = rows.filter(isOpen).length;
    const results = toJudgeResults(rows.filter((r) => !isOpen(r)));
    const cmp = compare(results, { wrong: [], passFail: "unmarked" }, cutText, 2, (sheet.missing ?? 0) + open);

    await recount(db, id, cutLine ?? sheet.cut_line ?? "", {
      missing: sheet.missing ?? 0,
      robustToMissing: cmp.robustToMissing,
      cut: cmp.cut,
      nWrong: cmp.oursWrong.length,
      verdict: cmp.ourVerdict,
      nearBoundary: cmp.nearBoundary,
      margin: cmp.margin,
    });

    return NextResponse.json({
      cut: cmp.cut,
      nWrong: cmp.oursWrong.length,
      verdict: cmp.ourVerdict,
      nearBoundary: cmp.nearBoundary,
      margin: cmp.margin,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[recount]", id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
