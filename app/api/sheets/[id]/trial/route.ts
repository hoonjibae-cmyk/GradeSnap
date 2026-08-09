import { NextResponse } from "next/server";
import { CATALOG, clientFor, costUsd, info } from "@/lib/grading/client";
import { compare } from "@/lib/grading/compare";
import { checkDrift, missingCount } from "@/lib/grading/drift";
import { mergeTranscripts } from "@/lib/grading/merge";
import { judge, transcribe } from "@/lib/grading/stages";
import { bearer, userClient } from "@/lib/db/client";
import { downloadPage, getSheet, me, pagesOf, recordUsage, saveTrial } from "@/lib/db/queries";
import type { CallOptions } from "@/lib/grading/client";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 실험에 쓸 수 있는 조합. 아무 문자열이나 받으면 오타로 돈이 나갑니다. */
const EFFORTS = ["low", "medium", "high"] as const;

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
  try {
    const body = (await req.json()) as { model?: string; effort?: string };
    model = String(body?.model ?? "");
    effort = String(body?.effort ?? "high");
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

  const db = userClient(token);
  const staff = await me(db).catch(() => null);
  if (!staff?.active || staff.role !== "admin") {
    return NextResponse.json({ error: "모델 비교는 관리자만 돌릴 수 있습니다." }, { status: 403 });
  }

  const opts: CallOptions = { model, effort: effort as CallOptions["effort"] };
  const t0 = Date.now();

  try {
    const sheet = await getSheet(db, id);
    const pages = await pagesOf(db, id);
    if (!pages.length) throw new Error("사진이 없습니다. 90일이 지나 지워졌을 수 있습니다.");

    const client = clientFor(model);
    const parts = [];
    const usage = [];
    for (const p of pages) {
      const data = await downloadPage(db, p.storage_path);
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
      effort,
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
      effort,
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
        effort,
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
      effort,
      ok: false,
    });
    return NextResponse.json({ ok: false, error: message });
  }
}
