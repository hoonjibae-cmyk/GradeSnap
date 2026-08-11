import OpenAI from "openai";
import type { CallOptions, JsonRequest, ModelClient } from "./provider";
import type { Usage } from "./types";

/**
 * GPT로도 같은 파이프라인을 돌리기 위한 어댑터.
 *
 * **비교하려고 만든 것입니다.** 실제 채점은 Anthropic으로 나갑니다 —
 * 개인정보 동의서에 적힌 국외 이전 대상이 Anthropic PBC 하나이기 때문입니다
 * (docs/14 §14.3). 여기로 답안지를 보내는 것은 `/bench`의 실험뿐이고,
 * 그것도 원장님이 동의서 문제를 알고 누르는 것입니다.
 *
 * 파이프라인 쪽 코드는 한 줄도 안 바뀝니다. 두 회사가 맞춰야 할 것은
 * `ModelClient` 하나뿐이라, 전사·판정·대조·비교는 그대로 돌아갑니다.
 */

/**
 * OpenAI는 **사고 토큰도 출력 토큰에 들어갑니다.** Anthropic 쪽에 쓰는
 * 16,000을 그대로 두면 50문항 전사가 사고 도중에 잘려 `incomplete`로
 * 끝납니다. 잘린 것을 실패로 세면 "GPT가 못 한다"는 잘못된 결론이 납니다.
 */
const MAX_OUTPUT_TOKENS = 32000;

export function openai(): ModelClient {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다. Vercel 환경 변수에 넣고 재배포해야 합니다.");
  }
  if (!key.startsWith("sk-")) {
    throw new Error(`OPENAI_API_KEY가 'sk-'로 시작하지 않습니다 (받은 값: ${key.slice(0, 8)}…).`);
  }
  const client = new OpenAI({ apiKey: key });
  return {
    provider: "openai",
    callJson: (req, opts) => callJson(client, req, opts),
  };
}

async function callJson<T>(
  client: OpenAI,
  req: JsonRequest,
  opts: CallOptions = {},
): Promise<{ data: T; usage: Usage }> {
  const model = opts.model;
  if (!model) throw new Error("OpenAI 호출에 모델이 지정되지 않았습니다.");
  // 사고를 끈 호출은 `none`으로 옮깁니다. 강도 이름(low·medium·high·xhigh·max)은
  // 양쪽이 같은 낱말을 쓰므로 그대로 넘깁니다.
  // `effort: null`("보내지 마라")도 여기서는 `none`입니다 — 이쪽 API는 빼는
  // 대신 `none`을 받습니다.
  const effort = opts.thinking === false || opts.effort === null ? "none" : (opts.effort ?? "low");

  const content: OpenAI.Responses.ResponseInputContent[] = [
    ...(req.images ?? []).map(
      (im): OpenAI.Responses.ResponseInputContent => ({
        type: "input_image",
        // 답안 한 칸이 40~80px입니다. `auto`로 두면 줄여 보내 연필이 안 읽힙니다.
        detail: "high",
        image_url: `data:${im.mediaType};base64,${im.data}`,
      }),
    ),
    { type: "input_text", text: req.text },
  ];

  const t0 = Date.now();
  const res = await client.responses.create({
    model,
    instructions: req.system,
    input: [{ role: "user", content }],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort },
    text: {
      format: {
        type: "json_schema",
        name: "gradesnap",
        schema: req.schema as Record<string, unknown>,
        // 스키마를 지키게 강제합니다. 우리 스키마는 모든 객체에
        // `additionalProperties: false`와 전 항목 `required`가 이미 붙어 있어
        // 그대로 통과합니다.
        strict: true,
      },
    },
  });

  /*
    잘렸거나 거절당한 것을 **조용히 넘기지 않습니다.** `/bench`에서
    "값싼 모델이 못 해낸 것"도 결과이고, 그걸 지우면 "돌려봤더니 잘 되더라"는
    잘못된 인상만 남습니다.
  */
  if (res.status === "incomplete") {
    throw new Error(`응답이 끝나지 않았습니다 (${res.incomplete_details?.reason ?? "이유 미상"}).`);
  }
  const refusal = res.output
    .flatMap((o) => (o.type === "message" ? o.content : []))
    .find((c) => c.type === "refusal");
  if (refusal && refusal.type === "refusal") {
    throw new Error(`모델이 거절했습니다: ${refusal.refusal}`);
  }

  const text = res.output_text;
  if (!text) throw new Error("모델 응답에 텍스트가 없습니다.");

  return {
    data: JSON.parse(text) as T,
    usage: {
      latencyMs: Date.now() - t0,
      // 사고 토큰은 `output_tokens`에 이미 포함돼 있습니다. 비용은 이걸로 셉니다.
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      model,
      effort,
    },
  };
}
