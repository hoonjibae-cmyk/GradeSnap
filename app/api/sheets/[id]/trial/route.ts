import { NextResponse } from "next/server";
import { CATALOG, clientFor, costUsd, info, takesEffort, NO_EFFORT } from "@/lib/grading/client";
import { compare } from "@/lib/grading/compare";
import { checkDrift, missingCount } from "@/lib/grading/drift";
import { mergeTranscripts } from "@/lib/grading/merge";
import { judge, transcribe } from "@/lib/grading/stages";
import { bearer, userClient } from "@/lib/db/client";
import { downloadPage, getSheet, me, pagesOf, recordUsage, saveTrial } from "@/lib/db/queries";
import type { CallOptions } from "@/lib/grading/client";
import { VARIANTS, type Variant } from "@/lib/grading/provider";
import { EDGES } from "@/lib/grading/resize";
import { downscale } from "@/lib/grading/downscale";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 실험에 쓸 수 있는 조합. 아무 문자열이나 받으면 오타로 돈이 나갑니다.
 *
 * `none`은 **강도를 아예 안 보내는 조건**입니다. Haiku 4.5처럼 강도를 안 받는
 * 모델이 있어서(400) 필요하고, 받는 모델에서도 "기본값으로 돌면 어떤가"를
 * 재볼 수 있는 실제 조건입니다.
 */
const EFFORTS = ["low", "medium", "high", NO_EFFORT] as const;


/**
 * **같은 답안지를 다른 모델로 다시 채점해 봅니다.**
 *
 * 실제 채점 결과(`sheets`·`items`)는 건드리지 않습니다. 결과는 `model_trials`에
 * 따로 쌓이고, 비교는 `/bench` 화면이 합니다. 섞으면 학생에게 나간 판정이
 * 실험 때문에 바뀝니다.
 *
 * 커트라인과 철자 방침은 **실제 채점과 같은 규칙**을 씁니다. 그래야 갈린
 * 이유가 모델 차이로 좁혀집니다 — 조건을 바꿔놓고 비교하면 아무것도 못 배웁니다.
 *
 * 🔴 **관리자만** 부를 수 있습니다. 돈이 나가는 호출이고, GPT를 고르면
 * 학생 답안지가 동의서에 없는 회사로 나갑니다(docs/14 §14.3). 화면에서만
 * 막아두면 주소를 아는 사람은 그대로 부를 수 있습니다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await params;
  let model: string;
  let effort: string;
  let variant: string;
  let edge: number | null;
  try {
    const body = (await req.json()) as { model?: string; effort?: string; variant?: string; edge?: number | null };
    model = String(body?.model ?? "");
    effort = String(body?.effort ?? "high");
    variant = String(body?.variant ?? "full");
    edge = body?.edge == null ? null : Number(body.edge);
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  if (!info(model)) {
    return NextResponse.json(
      { error: `모르는 모델입니다: ${model} (가능: ${CATALOG.map((m) => m.id).join(", ")})` },
      { status: 400 },
    );
  }
  if (!EFFORTS.includes(effort as (typeof EFFORTS)[number])) {
    return NextResponse.json({ error: `모르는 사고 강도입니다: ${effort}` }, { status: 400 });
  }
  if (!VARIANTS.includes(variant as Variant)) {
    return NextResponse.json({ error: `모르는 출력 형식입니다: ${variant}` }, { status: 400 });
  }
  if (edge !== null && !(EDGES as readonly number[]).includes(edge)) {
    return NextResponse.json({ error: `모르는 해상도입니다: ${edge}` }, { status: 400 });
  }

  const db = userClient(token);
  const staff = await me(db).catch(() => null);
  if (!staff?.active || staff.role !== "admin") {
    return NextResponse.json({ error: "모델 비교는 관리자만 돌릴 수 있습니다." }, { status: 403 });
  }

  /*
    🔴 **키를 여기서 확인합니다 — try 밖에서.**

    안에 두면 키가 없을 때 그게 답안지마다 "실험 실패"로 기록됩니다. 그러면
    화면에는 여섯 장이 실패한 것으로 보이고, 다시 돌릴 수도 없고, 무엇보다
    **설정 실수가 모델의 흠으로 남습니다.** 재려는 것은 모델의 실력이지
    우리가 환경 변수를 넣었는지가 아닙니다.

    실제로 그렇게 됐습니다(2026-08-10). 키 없이 여섯 장을 돌렸더니
    `OPENAI_API_KEY가 설정되지 않았습니다`가 여섯 번 실험 기록으로 쌓였습니다.

    키 문제는 답안지와 무관하므로 **한 번 답하고 끝냅니다.** 기록도 안 남깁니다.
  */
  let client;
  try {
    client = clientFor(model);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, setup: true, error: message }, { status: 400 });
  }

  /*
    강도를 안 받는 모델이면 **화면이 뭘 골랐든 안 보냅니다.** 그리고 기록에도
    안 보냈다고 적습니다(`NO_EFFORT`) — 실제로 돈 조건과 표에 적힌 조건이
    갈리면 이 화면은 비교 도구가 아니라 오해 생성기가 됩니다.
  */
  const sent = effort === NO_EFFORT || !takesEffort(model) ? null : (effort as CallOptions["effort"]);
  const recorded = sent ?? NO_EFFORT;
  const opts: CallOptions = { model, effort: sent, variant: variant as Variant };
  const t0 = Date.now();

  try {
    const sheet = await getSheet(db, id);
    const pages = await pagesOf(db, id);
    if (!pages.length) throw new Error("사진이 없습니다. 90일이 지나 지워졌을 수 있습니다.");

    const parts = [];
    const usage = [];
    for (const p of pages) {
      const stored = await downloadPage(db, p.storage_path);
      /*
        **여기서만 줄입니다.** 실제 채점은 접수할 때 브라우저가 줄인 것을
        그대로 씁니다. 재서 통과하면 고칠 곳은 `lib/image.ts`의 `MAX_EDGE`이고,
        그러면 서버에서 줄일 일이 아예 없어집니다.
      */
      const data = edge === null ? stored : await downscale(stored, edge);
      const r = await transcribe(client, { mediaType: "image/jpeg", data }, opts);
      parts.push(r.transcript);
      usage.push(r.usage);
    }

    const transcript = mergeTranscripts(parts);
    if (sheet.cut_line?.trim()) transcript.sheet.cutLine = sheet.cut_line.trim();

    const warnings = checkDrift(transcript, undefined, pages.length);
    const missing = missingCount(transcript);

    const { results, usage: u2 } = await judge(client, transcript, sheet.strict_spelling, opts);
    usage.push(u2);
    const cmp = compare(results, { wrong: [], passFail: "unmarked" }, transcript.sheet.cutLine, 2, missing);

    // 단가를 모르는 모델은 **빈칸**입니다. 0으로 적으면 화면에서 공짜로 보입니다.
    const cost = costUsd(usage, model);

    await saveTrial(db, {
      sheet_id: id,
      model,
      effort: recorded,
      variant,
      edge,
      transcript,
      results,
      warnings,
      missing,
      cut: cmp.cut,
      n_wrong: cmp.oursWrong.length,
      verdict: cmp.ourVerdict,
      near_boundary: cmp.nearBoundary,
      margin: cmp.margin,
      token_usage: usage,
      cost_usd: cost,
      latency_ms: Date.now() - t0,
      error: null,
    });

    await recordUsage(db, {
      kind: "trial",
      sheet_id: id,
      pages: pages.length,
      cost_usd: cost,
      latency_ms: Date.now() - t0,
      model,
      effort: recorded,
      ok: true,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    // **거절도 스키마 실패도 결과입니다.** 값싼 모델이 못 해내는 것을 지우면
    // "돌려봤더니 잘 되더라"는 잘못된 인상만 남습니다.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[trial]", id, model, message);
    try {
      await saveTrial(db, {
        sheet_id: id,
        model,
        effort: recorded,
        variant,
        edge,
        transcript: null,
        results: null,
        warnings: [],
        missing: null,
        cut: null,
        n_wrong: null,
        verdict: null,
        near_boundary: null,
        margin: null,
        token_usage: null,
        cost_usd: null,
        latency_ms: Date.now() - t0,
        error: message.slice(0, 500),
      });
    } catch {
      /* 기록조차 못 남기면 응답으로만 알립니다 */
    }
    await recordUsage(db, {
      kind: "trial",
      sheet_id: id,
      pages: 0,
      cost_usd: null,
      latency_ms: Date.now() - t0,
      model,
      effort: recorded,
      ok: false,
    });
    return NextResponse.json({ ok: false, error: message });
  }
}
