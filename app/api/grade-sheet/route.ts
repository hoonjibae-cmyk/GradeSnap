import { NextResponse } from "next/server";
import { anthropic, costUsd } from "@/lib/grading/client";
import { compare } from "@/lib/grading/compare";
import { mergeTranscripts } from "@/lib/grading/merge";
import { transcribe } from "@/lib/grading/stages";
import { mapLimit } from "@/lib/parallel";
import { judgeSheet } from "@/lib/grading/pipeline";
import { splitUnjudged } from "@/lib/grading/unjudged";
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
 * 한 답안지 안에서 **동시에 읽을 쪽 수**(docs/13 §13.47).
 *
 * 흔한 장수(1~2쪽)는 어차피 전부 동시라 이 값이 안 걸립니다. 드물게 6쪽,
 * 8쪽이 올라올 때만 나눠 보냅니다 — 브라우저가 답안지 4장을 동시에
 * 돌리므로(`LANES`), 여기까지 무제한이면 한꺼번에 수십 개가 나가 429를
 * 맞습니다. **얻을 것은 다 얻고 사고만 막는 자리**입니다.
 */
const PAGE_LANES = 4;

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
    /*
      벽시계로 잽니다. 쪽을 동시에 읽기 시작한 뒤로는 **호출 시간을 더한
      값이 실제로 걸린 시간이 아닙니다**(§13.47) — 겹쳐 도니까요. 그대로
      두면 비용 화면이 한 번도 일어난 적 없는 시간을 말하고, 무엇보다
      **빨라진 것이 화면에 안 나타납니다.**
    */
    const t0 = Date.now();
    const client = anthropic();
    // 어떤 모델로 채점할지는 **관리 화면의 설정**입니다. 환경 변수가 아닙니다.
    const { useRefs, ...opts } = await gradingOptions(db);
    const pages = await pagesOf(db, id);
    if (!pages.length) throw new Error("사진이 없습니다. 다시 접수해 주십시오.");

    /*
      🔴 **쪽을 동시에 읽습니다**(docs/13 §13.47).

      쪽마다 읽는 일은 서로 아무 상관이 없습니다. 그런데 여기가 차례로
      기다리고 있었고, 시범 운용에서 가장 많이 나온 의견인 "채점이 느리다"의
      대부분이 이 줄이었습니다. 2쪽이면 전사 시간이 그대로 두 배입니다.

      **품질에는 영향이 0입니다.** 보내는 내용도 받는 내용도 똑같고,
      `mapLimit`이 결과를 들어간 차례대로 돌려주므로 아래 `mergeTranscripts`가
      보는 것도 예전과 한 글자도 다르지 않습니다. 바뀌는 것은 걸리는 시간뿐입니다.

      뚜껑(`PAGE_LANES`)이 있는 이유는 `lib/parallel.ts`에 적어 뒀습니다 —
      브라우저가 이미 답안지 4장을 동시에 돌리고 있어서, 여기까지 무제한으로
      열면 429를 맞습니다.
    */
    const read = await mapLimit(pages, PAGE_LANES, async (p) => {
      const data = await downloadPage(db, p.storage_path);
      return transcribe(client, { mediaType: "image/jpeg", data }, opts);
    });
    const parts = read.map((r) => r.transcript);
    const usage = read.map((r) => r.usage);

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
    const { results, warnings, missing, unjudged } = judged;
    usage.push(...judged.usage);

    const cost = costUsd(usage, usage[0].model);
    /*
      🔴 **판정 못 한 문항은 오답으로 세지 않습니다**(§13.40).

      순서배열·문장삽입처럼 정답이 지문에 달린 문항은 판정 단계가 알 수
      없습니다. 그걸 오답으로 세면 **우리가 못 푼 것을 학생이 뒤집어씁니다.**
      정답으로 세면 반대로 그냥 넘어갑니다.

      그래서 못 읽은 칸과 같은 자리로 보냅니다 — 이만큼 전부 틀렸다고
      가정해도 결과가 그대로면 판정하고, 뒤집히면 PASS/FAIL을 안 냅니다.
    */
    const counted = splitUnjudged(results).judged;
    const cmp = compare(
      counted,
      { wrong: [], passFail: "unmarked" },
      transcript.sheet.cutLine,
      2,
      missing + unjudged,
    );

    const saved = await saveGrading(db, id, {
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

    /*
      🔴 **중단됐어도 지출은 기록합니다.**

      결과는 버렸지만 돈은 나갔습니다. 안 적으면 비용 화면이 실제보다 싸게
      말하고, 그 화면으로 절감을 판단합니다. 버린 일도 쓴 돈입니다.
    */
    await recordUsage(db, {
      kind: "grade",
      sheet_id: id,
      pages: pages.length,
      cost_usd: cost,
      latency_ms: Date.now() - t0,
      model: usage[0].model,
      effort: usage[0].effort ?? null,
      ok: true,
    });

    if (!saved) console.warn("[grade-sheet] 중단된 답안지라 결과를 버렸습니다", id);
    return NextResponse.json({ done: false, sheetId: id, cancelled: !saved });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[grade-sheet]", id, message);
    // 실패해도 토큰은 나갔을 수 있습니다. 지출 기록에 남깁니다.
    await recordUsage(db, { kind: "grade", sheet_id: id, pages: 0, cost_usd: null, latency_ms: null, model: null, effort: null, ok: false });
    await saveFailure(db, id, message);
    return NextResponse.json({ done: false, sheetId: id, error: message });
  }
}
