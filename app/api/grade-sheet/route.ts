import { NextResponse } from "next/server";
import { anthropic, costUsd } from "@/lib/grading/client";
import { compare } from "@/lib/grading/compare";
import { mergeTranscripts } from "@/lib/grading/merge";
import { transcribe } from "@/lib/grading/stages";
import { judgeSheet } from "@/lib/grading/pipeline";
import { bearer, userClient } from "@/lib/db/client";
import {
  claim,
  downloadPage,
  examRefs,
  gradingOptions,
  pagesOf,
  recordUsage,
  saveFailure,
  saveGrading,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 답안지 **한 장을 집어 채점하고 저장**합니다.
 *
 * 두 가지로 부릅니다.
 *
 * | 부르는 때 | 본문 | 하는 일 |
 * |---|---|---|
 * | 접수 직후 | `{sheetId}` | 방금 받은 그 장을 바로 채점 |
 * | 화면을 열었을 때 | `{}` | 떠도는 것을 아무거나 집어 마저 채점 |
 *
 * 뒤쪽이 있어야 조교가 채점 도중 창을 닫아도 그 한 장이 버려지지 않습니다.
 * 집는 것이 `for update skip locked`라 조교 둘이 동시에 눌러도 겹치지 않습니다.
 *
 * 한 장(2쪽)이 80초쯤이라 300초 안에 넉넉합니다. **여러 장을 한 요청에 담지 마십시오.**
 */
export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let sheetId: string | undefined;
  try {
    sheetId = ((await req.json()) as { sheetId?: string })?.sheetId || undefined;
  } catch {
    sheetId = undefined; // 본문 없이 부르면 "아무거나"입니다.
  }

  const db = userClient(token);

  let sheet;
  try {
    sheet = await claim(db, sheetId);
    // 집을 게 없다 = 남이 집었거나 다 끝났다. 둘 다 정상입니다.
    if (!sheet) return NextResponse.json({ done: true });
  } catch (e) {
    // 집기 전에 터진 것 — 로그인·권한. 이유를 적을 답안지가 아직 없습니다.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[grade-sheet] claim", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 여기서부터의 실패는 **그 답안지에 이유를 적어야 합니다.** 안 그러면 'running'인
  // 채로 10분을 기다렸다 다시 잡히고, 조교는 왜 안 되는지 알 수 없습니다.
  const id = sheet.id;
  try {
    const client = anthropic();
    // 어떤 모델로 채점할지는 **관리 화면의 설정**입니다. 환경 변수가 아닙니다.
    const { useRefs, ...opts } = await gradingOptions(db);
    const pages = await pagesOf(db, id);
    if (!pages.length) throw new Error("사진이 없습니다. 다시 접수해 주십시오.");

    const parts = [];
    const usage = [];
    for (const p of pages) {
      const data = await downloadPage(db, p.storage_path);
      const r = await transcribe(client, { mediaType: "image/jpeg", data }, opts);
      parts.push(r.transcript);
      usage.push(r.usage);
    }

    const transcript = mergeTranscripts(parts);
    // 조교가 커트라인을 적어뒀으면 그게 우선입니다 — 빨간펜이 머리말을 덮는 경우입니다.
    if (sheet.cut_line?.trim()) transcript.sheet.cutLine = sheet.cut_line.trim();

    /*
      🔴 **여기가 시험 참조입니다**(docs/13 §13.27·§13.34).

      한 반 30명이 같은 시험을 봅니다. 참조가 없으면 판정 모델이 그 시험의
      정답을 **30번 새로 만들어냅니다.** 값도 값이지만 같은 답을 쓴 두 학생이
      다른 판정을 받을 수 있습니다 — 절감보다 먼저 **공정성** 문제입니다.

      흐름 자체는 `judgeSheet`에 있습니다. 라우트에 두면 테스트할 자리가
      없고, 없어서 이 기능이 **한 번도 안 불린 채로 배포됐습니다**(§13.34).
    */
    const judged = await judgeSheet(
      client,
      { transcript, pages: pages.length, strictSpelling: sheet.strict_spelling, useRefs, sheetId: id, opts },
      examRefs(db),
    );
    const { results, warnings, missing } = judged;
    usage.push(...judged.usage);

    const cost = costUsd(usage, usage[0].model);
    const cmp = compare(results, { wrong: [], passFail: "unmarked" }, transcript.sheet.cutLine, 2, missing);

    await saveGrading(db, id, {
      transcript,
      warnings,
      results,
      missing,
      robustToMissing: cmp.robustToMissing,
      cut: cmp.cut,
      nWrong: cmp.oursWrong.length,
      verdict: cmp.ourVerdict,
      nearBoundary: cmp.nearBoundary,
      margin: cmp.margin,
      usage,
      costUsd: cost,
    });

    await recordUsage(db, {
      kind: "grade",
      sheet_id: id,
      pages: pages.length,
      cost_usd: cost,
      latency_ms: usage.reduce((a, u) => a + u.latencyMs, 0),
      model: usage[0].model,
      effort: usage[0].effort ?? null,
      ok: true,
    });

    return NextResponse.json({ done: false, sheetId: id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[grade-sheet]", id, message);
    // 실패해도 토큰은 나갔을 수 있습니다. 지출 기록에 남깁니다.
    await recordUsage(db, { kind: "grade", sheet_id: id, pages: 0, cost_usd: null, latency_ms: null, model: null, effort: null, ok: false });
    await saveFailure(db, id, message);
    return NextResponse.json({ done: false, sheetId: id, error: message });
  }
}
