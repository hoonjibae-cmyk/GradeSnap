import { NextResponse } from "next/server";
import { anthropic, costUsd } from "@/lib/grading/client";
import { compare } from "@/lib/grading/compare";
import { checkDrift, missingCount } from "@/lib/grading/drift";
import { mergeTranscripts } from "@/lib/grading/merge";
import { judge, transcribe } from "@/lib/grading/stages";
import { bearer, userClient } from "@/lib/db/client";
import { claimOne, downloadPage, getExam, pagesOf, saveFailure, saveGrading } from "@/lib/db/queries";
import type { SheetRow } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 대기열에서 **한 장 집어 채점하고 저장**합니다.
 *
 * 브라우저가 이걸 동시에 넷 부르고, 끝나면 또 부릅니다. 그게 큐 드라이버 전부입니다 —
 * 크론도, 워커도, 상태 머신도 없습니다. 집어가는 것이 `for update skip locked`라
 * 넷이 같은 답안지를 잡을 일이 없고, 브라우저를 닫아도 행은 남습니다.
 *
 * 한 장(2쪽)이 80초쯤이라 300초 안에 넉넉합니다. **여러 장을 한 요청에 담지 마십시오.**
 */
export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let examId: string;
  try {
    examId = String(((await req.json()) as { examId?: string })?.examId ?? "");
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  if (!examId) return NextResponse.json({ error: "시험을 지정하지 않았습니다." }, { status: 400 });

  const db = userClient(token);

  let sheet: SheetRow | null;
  try {
    const exam = await getExam(db, examId);
    sheet = await claimOne(db, examId);
    if (!sheet) return NextResponse.json({ done: true });

    // 여기서부터 실패하면 그 답안지에 이유를 적어야 합니다. 안 그러면 'running'인
    // 채로 10분을 기다렸다가 다시 잡히고, 조교는 왜 안 되는지 알 수 없습니다.
    try {
      const client = anthropic();
      const pages = await pagesOf(db, sheet.id);
      if (!pages.length) throw new Error("사진이 없습니다. 다시 올려주십시오.");

      const parts = [];
      const usage = [];
      for (const p of pages) {
        const data = await downloadPage(db, p.storage_path);
        const r = await transcribe(client, { mediaType: "image/jpeg", data });
        parts.push(r.transcript);
        usage.push(r.usage);
      }

      const transcript = mergeTranscripts(parts);
      // 시험에 커트라인을 적어뒀으면 그게 우선입니다 — 빨간펜이 머리말을 덮는 경우입니다.
      if (exam.cut_line?.trim()) transcript.sheet.cutLine = exam.cut_line.trim();

      const warnings = checkDrift(transcript, undefined, pages.length);
      const missing = missingCount(transcript);

      const { results, usage: u2 } = await judge(client, transcript, exam.strict_spelling);
      usage.push(u2);
      const cmp = compare(results, { wrong: [], passFail: "unmarked" }, transcript.sheet.cutLine, 2, missing);

      await saveGrading(db, sheet.id, {
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
        costUsd: costUsd(usage, usage[0].model),
      });

      return NextResponse.json({ done: false, sheetId: sheet.id });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[grade-sheet]", sheet.id, message);
      await saveFailure(db, sheet.id, message);
      return NextResponse.json({ done: false, sheetId: sheet.id, error: message });
    }
  } catch (e) {
    // 집어오기 전에 터진 것 — 로그인·권한·시험 없음. 답안지에 적을 데가 없습니다.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[grade-sheet]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
