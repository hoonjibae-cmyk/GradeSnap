import Anthropic from "@anthropic-ai/sdk";
import { openai } from "./openai";
import { CATALOG, ids, info, type CallOptions, type JsonRequest, type ModelClient } from "./provider";
import type { Usage } from "./types";

export { costUsd, knownPrice, CATALOG, info } from "./provider";
export type { CallOptions, ModelClient, ModelInfo, Provider } from "./provider";

/**
 * 채점에 쓰는 모델과 사고 강도.
 *
 * **환경 변수로 뺀 이유는 되돌리기 위해서입니다.** 2026-08-08 실측에서
 * `Opus 5 + low`가 잡음과 구별되지 않으면서 비용 82% · 시간 74%로 나와
 * 기본값을 옮겼습니다(docs/13 §13.15). 다만 표본이 6장뿐이라
 * **운영에서 이상하면 코드를 안 고치고 되돌려야 합니다.**
 *
 *   GRADING_MODEL=claude-opus-5
 *   GRADING_EFFORT=high        ← Vercel 환경 변수만 바꾸고 재배포
 *
 * 오타로 엉뚱한 모델에 돈이 나가지 않도록 아는 값만 받습니다.
 *
 * 🔴 **여기서 받는 것은 Anthropic 모델뿐입니다.** GPT는 `/bench` 실험에서만
 * 꺼내 쓸 수 있습니다. 실제 채점을 GPT로 돌리면 학생 답안지가 동의서에 없는
 * 회사로 나가는데(docs/14 §14.3 — 국외 이전 대상은 Anthropic PBC 하나),
 * 그건 환경 변수 한 줄로 넘어가면 안 되는 선입니다. 회사를 바꾸려면 동의서를
 * 고치고 동의를 다시 받은 뒤 이 목록을 고치십시오.
 */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, name: string): T {
  const v = (value ?? "").trim();
  if (!v) return fallback;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new Error(`${name}에 모르는 값이 들어 있습니다: ${v} (가능: ${allowed.join(", ")})`);
  }
  return v as T;
}

export const DEFAULT_MODEL = pick(process.env.GRADING_MODEL, ids("anthropic"), "claude-opus-5", "GRADING_MODEL");
/** 실측 근거는 docs/13 §13.15. 강도는 **판정 단계만** 건드립니다 — 전사는 안 변합니다. */
export const DEFAULT_EFFORT = pick(process.env.GRADING_EFFORT, EFFORTS, "low", "GRADING_EFFORT");

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
    system: req.system,
    messages: [{ role: "user", content }],
    ...(opts.thinking === false ? { thinking: { type: "disabled" as const } } : {}),
    output_config: {
      effort: opts.effort ?? DEFAULT_EFFORT,
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
      model,
      // 나중에 "이 답안지는 어떤 설정으로 채점됐나"를 되짚으려면 남아 있어야 합니다.
      // 칼럼을 새로 파지 않고 usage jsonb에 같이 넣습니다.
      effort: opts.effort ?? DEFAULT_EFFORT,
    },
  };
}
