import { NextResponse } from "next/server";
import { anthropic, costUsd } from "@/lib/grading/client";
import { readAnswerKey } from "@/lib/grading/stages";
import { bearer, userClient } from "@/lib/db/client";
import { gradingOptions, me, recordUsage } from "@/lib/db/queries";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * **정답지 사진 한 장을 읽어 돌려줍니다. 저장은 안 합니다.**
 *
 * 저장을 여기서 안 하는 것이 핵심입니다. 정답지가 틀리면 그 시험을 본 반
 * 전체가 같은 오류로 채점됩니다(docs/13 §13.42). 그래서 읽은 결과를 화면이
 * 표로 보여주고, **사람이 확인·수정한 뒤에** 저장합니다.
 *
 * 인쇄물이라 손글씨보다 훨씬 쉽고, 시험 하나에 **한 번만** 부릅니다.
 */
export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = userClient(token);
  const staff = await me(db).catch(() => null);
  // 정답지를 정하는 것은 확정과 같은 무게입니다 — 같은 문을 씁니다.
  if (!staff?.active || staff.role === "assistant") {
    return NextResponse.json({ error: "정답지 등록은 선생님·관리자만 할 수 있습니다." }, { status: 403 });
  }

  let data: string;
  try {
    const b = (await req.json()) as { image?: string };
    data = String(b?.image ?? "");
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  if (!data) return NextResponse.json({ error: "사진이 없습니다." }, { status: 400 });

  const t0 = Date.now();
  try {
    const client = anthropic();
    const { useRefs: _useRefs, ...opts } = await gradingOptions(db);
    const r = await readAnswerKey(client, { mediaType: "image/jpeg", data }, opts);
    const cost = costUsd([r.usage], r.usage.model);

    // 답안지가 아니라 정답지지만 **돈은 똑같이 나갑니다.** 기록에 남깁니다.
    await recordUsage(db, {
      kind: "quick",
      sheet_id: null,
      pages: 1,
      cost_usd: cost,
      latency_ms: Date.now() - t0,
      model: r.usage.model,
      effort: r.usage.effort ?? null,
      ok: true,
    });

    return NextResponse.json({ title: r.title, items: r.items });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[answer-key]", message);
    await recordUsage(db, {
      kind: "quick",
      sheet_id: null,
      pages: 0,
      cost_usd: null,
      latency_ms: Date.now() - t0,
      model: null,
      effort: null,
      ok: false,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
