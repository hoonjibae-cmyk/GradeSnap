import { NextResponse } from "next/server";
import { compare } from "@/lib/grading/compare";
import { bearer, userClient } from "@/lib/db/client";
import { getSheet, itemsOf, recount } from "@/lib/db/queries";
import { toJudgeResults } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * 커트라인을 뒤늦게 넣어 **판정만 다시 셉니다.**
 *
 * 빨간펜이 머리말을 덮어 커트라인을 못 읽는 일이 실제로 있었습니다(docs/13 §13.8).
 * 그때 모자란 것은 숫자 하나뿐인데 다시 채점하면 $0.14가 또 나갑니다.
 * 전사도 판정도 이미 저장돼 있으므로 **모델을 부르지 않고** 셈만 고칩니다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await params;
  let cutLine: string;
  try {
    cutLine = String(((await req.json()) as { cutLine?: string })?.cutLine ?? "").trim();
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  if (!cutLine) return NextResponse.json({ error: "커트라인을 입력해 주십시오." }, { status: 400 });

  try {
    const db = userClient(token);
    const sheet = await getSheet(db, id);
    if (!sheet.graded_at) return NextResponse.json({ error: "아직 채점되지 않았습니다." }, { status: 400 });

    const results = toJudgeResults(await itemsOf(db, id));
    const cmp = compare(results, { wrong: [], passFail: "unmarked" }, cutLine, 2, sheet.missing ?? 0);

    await recount(db, id, cutLine, {
      missing: sheet.missing ?? 0,
      robustToMissing: cmp.robustToMissing,
      cut: cmp.cut,
      nWrong: cmp.oursWrong.length,
      verdict: cmp.ourVerdict,
      nearBoundary: cmp.nearBoundary,
      margin: cmp.margin,
    });

    return NextResponse.json({ cut: cmp.cut, verdict: cmp.ourVerdict, nearBoundary: cmp.nearBoundary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cutline]", id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
