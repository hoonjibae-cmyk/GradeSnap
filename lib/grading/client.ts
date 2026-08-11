import Anthropic from "@anthropic-ai/sdk";
import { openai } from "./openai";
import { CATALOG, effortToSend, info, type CallOptions, type JsonRequest, type ModelClient } from "./provider";
import type { Usage } from "./types";

export { costUsd, knownPrice, CATALOG, info, takesEffort, effortLabel, NO_EFFORT } from "./provider";
export type { CallOptions, ModelClient, ModelInfo, Provider } from "./provider";

/**
 * 마지막 보루로 쓰는 모델과 사고 강도.
 *
 * **실제 채점이 무엇을 쓰는지는 여기서 안 정합니다.** `settings` 표에 있고,
 * 관리 화면에서 원장님이 고릅니다(`gradingOptions()`).
 *
 * 예전에는 `GRADING_MODEL` · `GRADING_EFFORT` 환경 변수였습니다. 되돌릴 수
 * 있게 하려고 코드 밖에 뒀는데, 되돌리려면 여전히 Vercel에 들어가 재배포해야
 * 했습니다. 그리고 서버만 아는 값이라 **조교 화면이 지금 무엇으로 채점되는지
 * 말할 수가 없었습니다.** 둘 다 DB로 옮기면서 풀렸습니다.
 *
 * 🔴 그 값도 **Anthropic 모델뿐입니다.** 실제 채점을 GPT로 돌리면 학생
 * 답안지가 동의서에 없는 회사로 나갑니다(docs/14 §14.8 — 국외 이전 대상은
 * Anthropic PBC 하나). `normalizeGrading()`과 DB의 CHECK가 **둘 다** 막습니다.
 *
 * 아래 값은 옵션 없이 부른 호출에만 쓰입니다. 실측 근거는 docs/13 §13.15.
 */
export const DEFAULT_MODEL = "claude-opus-5";
/** 강도는 **판정 단계만** 건드립니다 — 전사는 안 변합니다(docs/12 §12.7). */
export const DEFAULT_EFFORT = "low" as const;

/**
 * 고해상도 상한. 답안 한 칸이 40~80px 높이가 되므로 여기서 더 줄이면 연필이 안 읽힙니다.
 * 실측에서 A4 50문항이 통짜로 읽혔습니다 — 페이지를 나눌 필요가 없었습니다.
 */
export const MAX_EDGE = 2576;

export function anthropic(): ModelClient {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  if (!key.startsWith("sk-ant-")) {
    throw new Error(`ANTHROPIC_API_KEY가 'sk-ant-'로 시작하지 않습니다 (받은 값: ${key.slice(0, 12)}…).`);
  }
  const client = new Anthropic({ apiKey: key });
  return { provider: "anthropic", callJson: (req, opts) => callJson(client, req, opts) };
}

/**
 * 계정에서 실제로 쓸 수 있는 모델 목록. **관리 화면의 "모델 확인"이 씁니다.**
 *
 * 문서 페이지도 영업 담당자도 이 계정의 진실을 모릅니다 — Models API가
 * 압니다(2026-08-11, "claude-opus-5는 없다"는 주장이 계기). 여기 나오는
 * 목록이 이 키로 부를 수 있는 전부입니다.
 */
export async function listModels(): Promise<{ id: string; name: string }[]> {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const client = new Anthropic({ apiKey: key });
  const out: { id: string; name: string }[] = [];
  for await (const m of client.models.list()) out.push({ id: m.id, name: m.display_name });
  return out;
}

/**
 * 모델 이름만 주면 알아서 그 회사 어댑터를 엽니다.
 *
 * 부르는 쪽(`/api/sheets/[id]/trial`)이 회사를 알 필요가 없어야 합니다 —
 * 알게 두면 모델을 하나 더할 때마다 라우트에 if가 붙습니다.
 */
export function clientFor(model: string): ModelClient {
  const m = info(model);
  if (!m) throw new Error(`모르는 모델입니다: ${model} (가능: ${CATALOG.map((x) => x.id).join(", ")})`);
  return m.provider === "openai" ? openai() : anthropic();
}

/** 이미지 + 텍스트 → 스키마에 맞는 JSON. 실패는 그대로 던집니다(상위에서 job에 기록). */
async function callJson<T>(
  client: Anthropic,
  req: JsonRequest,
  opts: CallOptions = {},
): Promise<{ data: T; usage: Usage }> {
  const model = opts.model ?? DEFAULT_MODEL;
  /*
    🔴 **강도를 안 받는 모델에는 안 보냅니다.**

    2026-08-11, Haiku 4.5로 실험을 돌리다 그대로 맞았습니다:
    `400 This model does not support the effort parameter.` 값싼 모델을
    재보려고 만든 화면인데 값싼 모델이 아예 안 돌아갔습니다.

    `null`은 "일부러 안 보냄"이고 `undefined`는 "안 정함"입니다. 둘을 같이
    다루면 안 보내려고 null을 넣은 자리에 기본값이 채워집니다.
  */
  const effort = effortToSend(model, opts.effort, DEFAULT_EFFORT);
  const content: Anthropic.ContentBlockParam[] = [
    ...(req.images ?? []).map(
      (im): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: im.mediaType, data: im.data },
      }),
    ),
    { type: "text", text: req.text },
  ];

  const t0 = Date.now();
  const msg = await client.messages.create({
    model,
    max_tokens: 16000,
    /*
      시스템 프롬프트에 **캐시 표시만** 붙입니다. 글자는 한 자도 안 바꿉니다 —
      프롬프트가 바뀌면 재봐야 하고(§13.21에서 데었습니다), 이건 같은 글자를
      싸게 보내는 것뿐이라 잴 것이 없습니다.

      최소 길이(1,024토큰)를 넘을 때만 실제로 캐시됩니다. 못 넘으면 아무 일도
      안 일어납니다 — 그래서 붙여두고 관리 화면 「비용」으로 확인합니다.
      수업 시간에는 호출이 분 단위로 이어져 5분 TTL 안에서 계속 맞습니다.
    */
    system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user", content }],
    ...(opts.thinking === false ? { thinking: { type: "disabled" as const } } : {}),
    output_config: {
      ...(effort ? { effort } : {}),
      format: { type: "json_schema", schema: req.schema as Record<string, unknown> },
    },
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("모델 응답에 텍스트 블록이 없습니다.");

  return {
    data: JSON.parse(block.text) as T,
    usage: {
      latencyMs: Date.now() - t0,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      /*
        **응답이 말한 모델**을 적습니다 — 우리가 보낸 문자열이 아니라.
        "그 ID가 진짜 그 모델이냐"는 물음(2026-08-11, Anthropic 영업)에
        우리가 보낸 값을 다시 보여주는 것은 답이 아닙니다. 서버가 무엇으로
        처리했다고 답했는지가 답이고, 그걸 답안지마다 남깁니다.
      */
      model: msg.model || model,
      // 나중에 "이 답안지는 어떤 설정으로 채점됐나"를 되짚으려면 남아 있어야 합니다.
      // 칼럼을 새로 파지 않고 usage jsonb에 같이 넣습니다.
      // **보낸 값만 적습니다** — 안 보냈으면 빈칸입니다. 채워두면 나중에
      // 되짚는 사람이 돌지도 않은 조건을 믿습니다.
      ...(effort ? { effort } : {}),
      // 캐시가 걸린 만큼 input_tokens에서 빠져서 옵니다. 안 적으면 비용이 거짓말합니다.
      cacheRead: msg.usage.cache_read_input_tokens ?? 0,
      cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
