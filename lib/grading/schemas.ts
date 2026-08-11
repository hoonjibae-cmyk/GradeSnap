/** 구조화 출력 스키마. `output_config.format`에 그대로 넣습니다. */

export const TRANSCRIBE_SCHEMA = {
  type: "object",
  properties: {
    sheet: {
      type: "object",
      properties: {
        title: { type: "string", description: "시험지 제목 (머리말에 인쇄된 것)" },
        teacher: { type: "string" },
        student: { type: "string" },
        cut_line: { type: "string", description: "커트라인 표기 그대로. 예 '-8까지 pass'" },
        printed_total: { type: "integer", description: "시험지에 인쇄된 총 문항 수. 안 적혀 있으면 0" },
      },
      required: ["title", "teacher", "student", "cut_line", "printed_total"],
      additionalProperties: false,
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          no: { type: "string", description: "인쇄된 문항 번호" },
          prompt: { type: "string", description: "그 문항에 인쇄된 제시어를 그대로. 밀림 검증용이라 반드시 채운다." },
          direction: { type: "string", enum: ["en2ko", "ko2en", "other"] },
          prefix: { type: "string", description: "답란에 첫 글자가 인쇄돼 있으면 그 글자. 없으면 빈 문자열." },
          written: { type: "string", description: "학생이 손으로 쓴 것 그대로. prefix가 있으면 포함한 완성형. 무응답이면 빈 문자열." },
          blank: { type: "boolean" },
          legible: { type: "boolean", description: "글자는 있으나 판독 불가면 false" },
          erased: { type: "boolean", description: "지우거나 뭉갠 흔적이 있으면 true" },
          confidence: { type: "number" },
        },
        required: ["no", "prompt", "direction", "prefix", "written", "blank", "legible", "erased", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["sheet", "items"],
  additionalProperties: false,
} as const;

export const MARKS_SCHEMA = {
  type: "object",
  properties: {
    convention: {
      type: "object",
      properties: {
        check_mark: { type: "string", description: "거의 모든 문항에 붙은 '채점함' 표시" },
        wrong_mark: { type: "string", description: "일부 문항에만 붙은 '오답' 표시" },
        reasoning: { type: "string", description: "왜 그렇게 나눴는지 한두 문장" },
      },
      required: ["check_mark", "wrong_mark", "reasoning"],
      additionalProperties: false,
    },
    wrong: {
      type: "array",
      items: { type: "string" },
      description: "오답 표시가 붙은 문항 번호. 인쇄된 표기 그대로('12', '3)' 등). 설명·문항 내용은 넣지 말 것. 번호를 특정할 수 없는 표시는 아예 넣지 말 것.",
    },
    score_text: { type: "string", description: "선생님이 적은 점수·오답 개수 표기 그대로. 예 '-12'" },
    pass_fail: { type: "string", enum: ["pass", "fail", "unmarked"] },
    confidence: { type: "number" },
  },
  required: ["convention", "wrong", "score_text", "pass_fail", "confidence"],
  additionalProperties: false,
} as const;

export const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          no: { type: "string" },
          correct: { type: "boolean" },
          expected: { type: "string", description: "이 문항의 정답" },
          note: { type: "string", description: "애매하면 한 줄 이유. 명확하면 빈 문자열" },
        },
        required: ["no", "correct", "expected", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

/**
 * 정답이 **입력으로 주어진** 판정의 출력. `expected`가 없습니다 —
 * 참조에서 오므로 모델이 다시 뱉을 이유가 없고, 다시 뱉게 두면
 * 학생마다 정답이 흔들리는 문제(docs/13 §13.27)가 도로 생깁니다.
 */
export const JUDGE_KEY_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          no: { type: "string" },
          correct: { type: "boolean" },
          note: { type: "string", description: "애매하면 한 줄 이유. 명확하면 빈 문자열" },
        },
        required: ["no", "correct", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;
