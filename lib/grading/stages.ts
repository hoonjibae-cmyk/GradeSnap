import type { CallOptions, ImageInput, ModelClient } from "./provider";
import { ANSWER_KEY_SYSTEM, JUDGE_SYSTEM, MARKS_SYSTEM, TRANSCRIBE_SYSTEM, judgeKeySystem, judgeSystem } from "./prompts";
import { ANSWER_KEY_SCHEMA, JUDGE_KEY_SCHEMA, JUDGE_SCHEMA, MARKS_SCHEMA, TRANSCRIBE_SCHEMA } from "./schemas";
import { ITEM_KEYS, RESULT_KEYS, compactJudgeSchema, compactTranscribeSchema, expand } from "./compact";
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
  client: ModelClient,
  image: ImageInput,
  opts?: CallOptions,
): Promise<{ transcript: Transcript; usage: Usage }> {
  /*
    압축판은 **필드 이름만 짧습니다.** 문항 하나의 JSON에서 이름이 58%를
    차지하는데 그건 아무 정보도 안 나릅니다(docs/13 §13.21). 뜻은
    `description`이 그대로 나르고, 받은 뒤에 원래 이름으로 되돌리므로
    이 함수 바깥은 아무것도 안 바뀝니다.
  */
  // 전사는 `items`·`compact` 둘 다 압축입니다.
  const compact = opts?.variant === "items" || opts?.variant === "compact";
  const { data, usage } = await client.callJson<RawTranscript>(
    {
      system: TRANSCRIBE_SYSTEM,
      text: "이 답안지의 모든 문항을 전사하십시오. 빈칸도 빠짐없이 포함하십시오.",
      images: [image],
      schema: compact ? compactTranscribeSchema(TRANSCRIBE_SCHEMA) : TRANSCRIBE_SCHEMA,
    },
    opts,
  );

  const items = compact ? data.items.map((r) => expand<Item>(r as Record<string, unknown>, ITEM_KEYS)) : data.items;
  const sheet: Sheet = {
    title: data.sheet.title,
    teacher: data.sheet.teacher,
    student: data.sheet.student,
    cutLine: data.sheet.cut_line,
    printedTotal: data.sheet.printed_total,
  };
  return { transcript: { sheet, items }, usage };
}

interface RawMarks {
  convention: { check_mark: string; wrong_mark: string; reasoning: string };
  wrong: string[];
  score_text: string;
  pass_fail: "pass" | "fail" | "unmarked";
  confidence: number;
}

export async function readMarks(
  client: ModelClient,
  image: ImageInput,
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

  const { data, usage } = await client.callJson<RawMarks>(
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
  client: ModelClient,
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

  /*
    🔴 판정은 `compact`에서만 압축합니다.

    실측(2026-08-10): 전사가 **완전히 같은** 답안지에서 판정만 4건이 갈렸고,
    방향이 6:0으로 전부 '오답을 놓치는' 쪽이었습니다. `"correct": false`를
    `"c": false`로 바꾸면 모델이 무엇을 정하는 중인지 알려주는 낱말이
    사라집니다 — 옮겨 적기(전사)와 달리 **따지는 일에는 그 낱말이 값을 합니다.**
  */
  const compact = opts?.variant === "compact";
  const { data, usage } = await client.callJson<{ results: JudgeResult[] }>(
    {
      system: judgeSystem(strictSpelling),
      /*
        들여쓰기는 **압축일 때만** 뺍니다. 조건 밖에 두는 바람에 실제 채점의
        입력까지 조용히 바뀌었습니다(2026-08-10). 재보지 않은 변경이
        운영으로 새어 나간 것이고, 잡음 바닥과 비교할 기준선도 흔들립니다.
      */
      text:
        "아래는 한 답안지를 전사한 결과입니다. 문항마다 정오를 판정하십시오.\n\n" +
        (compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 1)),
      schema: compact ? compactJudgeSchema(JUDGE_SCHEMA) : JUDGE_SCHEMA,
    },
    opts,
  );
  const results = compact
    ? data.results.map((r) => expand<JudgeResult>(r as unknown as Record<string, unknown>, RESULT_KEYS))
    : data.results;
  return { results, usage };
}

/**
 * 정답이 **이미 있는** 판정 — 같은 시험의 참조가 정답을 줍니다(docs/13 §13.27).
 *
 * `judge`와 두 가지가 다릅니다.
 *
 *   - 정답이 입력으로 들어가고 **출력에는 없습니다.** 모델이 정답을 새로
 *     만들지 않으므로 반 안에서 정답이 흔들릴 수가 없습니다.
 *   - 빈칸·판독불가·정답 일치는 **여기 오기 전에 코드가 끝냈습니다**
 *     (`applyReference`). 여기 오는 것은 정답과 다르게 쓴 답뿐입니다.
 *
 * 결과의 `expected`는 참조 값으로 채웁니다 — 검수 화면이 그 칸을 봅니다.
 */
export async function judgeWithKey(
  client: ModelClient,
  items: Item[],
  expectedByNo: Map<string, string>,
  strictSpelling = false,
  opts?: CallOptions,
): Promise<{ results: JudgeResult[]; usage: Usage }> {
  const payload = items.map((i) => ({
    no: i.no,
    prompt: i.prompt,
    direction: i.direction,
    written: i.written,
    expected: expectedByNo.get(i.no) ?? "",
  }));

  const { data, usage } = await client.callJson<{ results: { no: string; correct: boolean; note: string }[] }>(
    {
      system: judgeKeySystem(strictSpelling),
      text:
        "아래는 한 답안지를 전사한 결과입니다. 문항마다 학생 답(written)이 표준 정답(expected)으로 " +
        "인정될 수 있는지 판정하십시오.\n\n" + JSON.stringify(payload, null, 1),
      schema: JUDGE_KEY_SCHEMA,
    },
    opts,
  );
  const results: JudgeResult[] = data.results.map((r) => ({
    no: r.no,
    correct: r.correct,
    expected: expectedByNo.get(r.no) ?? "",
    note: r.note,
  }));
  return { results, usage };
}

export { JUDGE_SYSTEM };

/**
 * **정답지 사진 한 장을 읽습니다.**
 *
 * 학생 답안지가 아니라 인쇄된 정답표입니다. 손글씨가 아니라 활자라 전사가
 * 훨씬 쉽고, 무엇보다 **시험 하나에 한 번만** 합니다.
 *
 * 읽은 결과를 그대로 쓰지 않습니다 — 화면이 표로 보여주고 **사람이 확인한
 * 뒤에** 저장합니다. 정답지가 틀리면 그 시험을 본 반 전체가 같은 오류로
 * 채점되기 때문입니다.
 */
export async function readAnswerKey(
  client: ModelClient,
  image: ImageInput,
  opts?: CallOptions,
): Promise<{ title: string; items: { no: string; expected: string }[]; usage: Usage }> {
  const { data, usage } = await client.callJson<{ title: string; items: { no: string; expected: string }[] }>(
    {
      system: ANSWER_KEY_SYSTEM,
      text: "이 정답지의 문항 번호와 정답을 옮겨 적으십시오.",
      images: [image],
      schema: ANSWER_KEY_SCHEMA,
    },
    opts,
  );
  return { title: (data.title ?? "").trim(), items: data.items ?? [], usage };
}
