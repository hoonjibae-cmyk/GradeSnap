import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "./types";

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * 고해상도 상한. 답안 한 칸이 40~80px 높이가 되므로 여기서 더 줄이면 연필이 안 읽힙니다.
 * 실측에서 A4 50문항이 통짜로 읽혔습니다 — 페이지를 나눌 필요가 없었습니다.
 */
export const MAX_EDGE = 2576;

/** 1M 토큰당 달러. 실측 장당 $0.217(Opus 5, 입력 ~5,000 / 출력 ~3,300). */
const PRICING: Record<string, [number, number]> = {
  "claude-opus-5": [5.0, 25.0],
  "claude-sonnet-5": [3.0, 15.0],
  "claude-haiku-4-5": [1.0, 5.0],
};

export function costUsd(usages: Usage[], model: string): number {
  const [pin, pout] = PRICING[model] ?? [0, 0];
  const i = usages.reduce((a, u) => a + u.inputTokens, 0);
  const o = usages.reduce((a, u) => a + u.outputTokens, 0);
  return (i * pin + o * pout) / 1_000_000;
}

export function anthropic(): Anthropic {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  if (!key.startsWith("sk-ant-")) {
    throw new Error(`ANTHROPIC_API_KEY가 'sk-ant-'로 시작하지 않습니다 (받은 값: ${key.slice(0, 12)}…).`);
  }
  return new Anthropic({ apiKey: key });
}

export interface CallOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * 기본은 켬. 실측에서 전사 단계는 사고를 켜도 출력 토큰이 그대로였습니다
   * (adaptive가 알아서 안 씁니다). 마크 판독처럼 따져야 하는 단계에는 필요합니다.
   */
  thinking?: boolean;
}

/** 이미지 + 텍스트 → 스키마에 맞는 JSON. 실패는 그대로 던집니다(상위에서 job에 기록). */
export async function callJson<T>(
  client: Anthropic,
  args: {
    system: string;
    text: string;
    /** base64 PNG/JPEG. 없으면 텍스트만 보냅니다(판정 단계). */
    images?: { mediaType: "image/png" | "image/jpeg"; data: string }[];
    schema: unknown;
  },
  opts: CallOptions = {},
): Promise<{ data: T; usage: Usage }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const content: Anthropic.ContentBlockParam[] = [
    ...(args.images ?? []).map(
      (im): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: im.mediaType, data: im.data },
      }),
    ),
    { type: "text", text: args.text },
  ];

  const t0 = Date.now();
  const msg = await client.messages.create({
    model,
    max_tokens: 16000,
    system: args.system,
    messages: [{ role: "user", content }],
    ...(opts.thinking === false ? { thinking: { type: "disabled" as const } } : {}),
    output_config: {
      effort: opts.effort ?? "high",
      format: { type: "json_schema", schema: args.schema as Record<string, unknown> },
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
    },
  };
}
