import type Anthropic from "@anthropic-ai/sdk";
import { callJson, type CallOptions } from "./client";
import { JUDGE_SYSTEM, MARKS_SYSTEM, TRANSCRIBE_SYSTEM, judgeSystem } from "./prompts";
import { JUDGE_SCHEMA, MARKS_SCHEMA, TRANSCRIBE_SCHEMA } from "./schemas";
import type { Item, JudgeResult, MarkReading, Sheet, Transcript, Usage } from "./types";

/**
 * 세 단계는 **반드시 따로 호출합니다.**
 *
 * 전사와 판정을 한 번에 시키면 AI가 틀린 답을 정답으로 고쳐 읽습니다.
 * "쓰인 글자를 옮겨라"만 시키고, 맞았는지는 다음 단계에서 정합니다.
 * (그래도 전사 단계에서 고쳐 읽는 경우가 남아 있습니다 — docs/12 §12.13)
 */

interface RawTranscript {
  sheet: { title: string; teacher: string; student: string; cut_line: string; printed_total: number };
  items: (Omit<Item, "no"> & { no: string })[];
}

export async function transcribe(
  client: Anthropic,
  image: { mediaType: "image/png" | "image/jpeg"; data: string },
  opts?: CallOptions,
): Promise<{ transcript: Transcript; usage: Usage }> {
  const { data, usage } = await callJson<RawTranscript>(
    client,
    {
      system: TRANSCRIBE_SYSTEM,
      text: "이 답안지의 모든 문항을 전사하십시오. 빈칸도 빠짐없이 포함하십시오.",
      images: [image],
      schema: TRANSCRIBE_SCHEMA,
    },
    opts,
  );

  const sheet: Sheet = {
    title: data.sheet.title,
    teacher: data.sheet.teacher,
    student: data.sheet.student,
    cutLine: data.sheet.cut_line,
    printedTotal: data.sheet.printed_total,
  };
  return { transcript: { sheet, items: data.items }, usage };
}

interface RawMarks {
  convention: { check_mark: string; wrong_mark: string; reasoning: string };
  wrong: string[];
  score_text: string;
  pass_fail: "pass" | "fail" | "unmarked";
  confidence: number;
}

export async function readMarks(
  client: Anthropic,
  image: { mediaType: "image/png" | "image/jpeg"; data: string },
  /**
   * 전사된 번호 목록. 주면 **그 안에서만** 고르게 합니다.
   * 안 주면 '1) 동명사만 쓰는 동사 - decide' 같은 산문이 돌아와 대조가 통째로 깨집니다.
   * 정답을 알려주는 게 아니라 번호 체계를 알려주는 것이라 편향은 없습니다.
   */
  itemNumbers?: string[],
  opts?: CallOptions,
): Promise<{ marks: MarkReading; usage: Usage }> {
  let text = "이 답안지에서 선생님이 오답으로 표시한 문항 번호를 모두 찾으십시오.";
  if (itemNumbers?.length) {
    text +=
      "\n\n이 시험지의 문항 번호는 아래가 전부입니다. **반드시 이 중에서만** 고르고, " +
      "인쇄된 표기 그대로 적으십시오.\n" +
      itemNumbers.join(", ");
  }

  const { data, usage } = await callJson<RawMarks>(
    client,
    { system: MARKS_SYSTEM, text, images: [image], schema: MARKS_SCHEMA },
    opts,
  );
  return {
    marks: {
      convention: {
        checkMark: data.convention.check_mark,
        wrongMark: data.convention.wrong_mark,
        reasoning: data.convention.reasoning,
      },
      wrong: data.wrong,
      scoreText: data.score_text,
      passFail: data.pass_fail,
      confidence: data.confidence,
    },
    usage,
  };
}

export async function judge(
  client: Anthropic,
  transcript: Transcript,
  /** 철자를 엄격히 볼 것인가. **교육 방침이라 시험 단위로 정합니다.** */
  strictSpelling = false,
  opts?: CallOptions,
): Promise<{ results: JudgeResult[]; usage: Usage }> {
  const payload = transcript.items.map((i) => ({
    no: i.no,
    prompt: i.prompt,
    direction: i.direction,
    written: i.written,
    blank: i.blank,
    legible: i.legible,
  }));

  const { data, usage } = await callJson<{ results: JudgeResult[] }>(
    client,
    {
      system: judgeSystem(strictSpelling),
      text: "아래는 한 답안지를 전사한 결과입니다. 문항마다 정오를 판정하십시오.\n\n" + JSON.stringify(payload, null, 1),
      schema: JUDGE_SCHEMA,
    },
    opts,
  );
  return { results: data.results, usage };
}

export { JUDGE_SYSTEM };
