import { NextResponse } from "next/server";
import { anthropic, costUsd } from "@/lib/grading/client";
import { checkDrift, missingCount } from "@/lib/grading/drift";
import { compare } from "@/lib/grading/compare";
import { mergeTranscripts } from "@/lib/grading/merge";
import { judge, transcribe } from "@/lib/grading/stages";
import type { JudgeResult, Transcript, Usage, Warning } from "@/lib/grading/types";

export const runtime = "nodejs";
/**
 * Vercel Pro는 함수 최대 300초입니다. 한 장에 20~40초라 넉넉하지만,
 * **여러 장을 한 요청에 담으면 넘겨서 죽습니다.** 장 하나에 호출 하나입니다.
 */
export const maxDuration = 300;

export interface GradeResponse {
  transcript: Transcript;
  warnings: Warning[];
  results: JudgeResult[];
  /** 인쇄된 문항 수보다 덜 읽힌 칸 수 */
  missing: number;
  /** 못 읽은 칸을 전부 틀렸다 쳐도 결정이 안 바뀌면 true. false면 판정을 내지 않습니다. */
  robustToMissing: boolean;
  /** 허용 오답 개수. 못 읽으면 null */
  cut: number | null;
  verdict: "pass" | "fail" | null;
  pages: number;
  usage: Usage[];
  costUsd: number;
}

interface GradeRequest {
  /**
   * **한 학생의 답안지** 사진들. 양면 인쇄면 앞·뒤 두 장입니다.
   * 순서를 맞출 필요는 없습니다 — 문항 번호로 정렬해 합칩니다.
   */
  images: { data: string; mediaType?: "image/jpeg" | "image/png" }[];
  /** 철자를 엄격히 볼 것인가. 교육 방침이라 시험 단위로 정합니다. */
  strictSpelling?: boolean;
  /**
   * 머리말의 커트라인이 빨간펜에 가려 안 읽힐 때 사람이 넣는 값.
   * 시험 하나에 한 번만 넣으면 되므로 장마다 입력하는 일이 아닙니다.
   */
  cutLineOverride?: string;
}

export async function POST(req: Request) {
  let body: GradeRequest;
  try {
    body = (await req.json()) as GradeRequest;
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  const images = body?.images ?? [];
  if (!images.length) {
    return NextResponse.json({ error: "사진이 없습니다." }, { status: 400 });
  }

  try {
    const client = anthropic();

    // 장마다 따로 전사합니다. 한 요청에 여러 장을 담아도 **모델 호출은 장당 하나**라야
    // Vercel의 300초 안에 들어옵니다.
    const parts = [];
    const usage = [];
    for (const im of images) {
      const r = await transcribe(client, { mediaType: im.mediaType ?? "image/jpeg", data: im.data });
      parts.push(r.transcript);
      usage.push(r.usage);
    }
    const transcript = mergeTranscripts(parts);
    if (body.cutLineOverride?.trim()) transcript.sheet.cutLine = body.cutLineOverride.trim();

    const warnings = checkDrift(transcript, undefined, parts.length);
    const missing = missingCount(transcript);

    // 전사와 판정을 **따로** 부릅니다. 한 번에 시키면 틀린 답을 정답으로 고쳐 읽습니다.
    const { results, usage: u2 } = await judge(client, transcript, body.strictSpelling ?? false);
    usage.push(u2);
    // 판정은 대조 로직에 맡깁니다 — 화면과 서버가 다른 규칙을 쓰면 언젠가 어긋납니다.
    const cmp = compare(results, { wrong: [], passFail: "unmarked" }, transcript.sheet.cutLine, 2, missing);

    const res: GradeResponse = {
      transcript,
      warnings,
      results,
      missing,
      robustToMissing: cmp.robustToMissing,
      cut: cmp.cut,
      verdict: cmp.ourVerdict,
      pages: parts.length,
      usage,
      costUsd: costUsd(usage, usage[0].model),
    };
    return NextResponse.json(res);
  } catch (e) {
    // 키 오류처럼 사람이 고칠 수 있는 것은 메시지를 그대로 보여줍니다.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[grade]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
