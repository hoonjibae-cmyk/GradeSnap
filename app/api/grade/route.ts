import { NextResponse } from "next/server";
import { anthropic, costUsd } from "@/lib/grading/client";
import { checkDrift } from "@/lib/grading/drift";
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
  usage: Usage[];
  costUsd: number;
}

interface GradeRequest {
  /** 브라우저에서 2576px로 줄인 JPEG의 base64 (데이터 URL 접두사 없이) */
  image: string;
  mediaType?: "image/jpeg" | "image/png";
  /** 철자를 엄격히 볼 것인가. 교육 방침이라 시험 단위로 정합니다. */
  strictSpelling?: boolean;
}

export async function POST(req: Request) {
  let body: GradeRequest;
  try {
    body = (await req.json()) as GradeRequest;
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  if (!body?.image) {
    return NextResponse.json({ error: "image가 없습니다." }, { status: 400 });
  }

  try {
    const client = anthropic();
    const image = { mediaType: body.mediaType ?? ("image/jpeg" as const), data: body.image };

    // 전사와 판정을 **따로** 부릅니다. 한 번에 시키면 틀린 답을 정답으로 고쳐 읽습니다.
    const { transcript, usage: u1 } = await transcribe(client, image);
    const warnings = checkDrift(transcript);
    const { results, usage: u2 } = await judge(client, transcript, body.strictSpelling ?? false);

    const usage = [u1, u2];
    const res: GradeResponse = {
      transcript,
      warnings,
      results,
      usage,
      costUsd: costUsd(usage, u1.model),
    };
    return NextResponse.json(res);
  } catch (e) {
    // 키 오류처럼 사람이 고칠 수 있는 것은 메시지를 그대로 보여줍니다.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[grade]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
