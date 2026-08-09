/**
 * 어느 회사 모델을 쓰든 채점 파이프라인이 안 바뀌게 하는 얇은 층.
 *
 * 파이프라인이 모델에게 요구하는 것은 **딱 하나**입니다 —
 * "이미지(선택) + 글 → 이 스키마에 맞는 JSON". 그 하나만 인터페이스로 두면
 * `transcribe`·`judge`·`compare`·`diffRuns`는 회사가 바뀌어도 그대로입니다.
 *
 * 여기에는 **환경 변수를 읽는 코드가 없습니다.** 모델 목록은 화면(`/bench`)도
 * 쓰는데, 브라우저에는 서버 환경 변수가 없어 값이 조용히 달라지기 때문입니다.
 * 키를 읽는 일은 각 회사 어댑터(`client.ts`, `openai.ts`)가 합니다.
 */

import type { Usage } from "./types";

export type Provider = "anthropic" | "openai";

export interface CallOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * 기본은 켬. 실측에서 전사 단계는 사고를 켜도 출력 토큰이 그대로였습니다
   * (adaptive가 알아서 안 씁니다). 마크 판독처럼 따져야 하는 단계에는 필요합니다.
   */
  thinking?: boolean;
}

export interface ImageInput {
  mediaType: "image/png" | "image/jpeg";
  /** base64. 데이터 URL 접두어 없이 순수 base64입니다. */
  data: string;
}

export interface JsonRequest {
  system: string;
  text: string;
  /** 없으면 글만 보냅니다(판정 단계). */
  images?: ImageInput[];
  schema: unknown;
}

/** 회사별 어댑터가 맞춰야 하는 전부. */
export interface ModelClient {
  readonly provider: Provider;
  callJson<T>(req: JsonRequest, opts?: CallOptions): Promise<{ data: T; usage: Usage }>;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: Provider;
  /** 화면에 붙일 한 줄. 값을 고를 때 근거가 됩니다. */
  note: string;
  /**
   * 1M 토큰당 [입력, 출력] 달러.
   *
   * **모르면 `null`입니다. 0으로 두지 마십시오** — `/bench`의 비용 칸이
   * `$0.000`으로 나오고, 그건 "공짜"로 읽힙니다. 비교하려고 만든 화면에서
   * 가장 나쁜 종류의 거짓말입니다.
   *
   * 단가가 바뀌거나 새 모델을 넣을 때 고치는 곳은 여기 한 군데입니다.
   */
  price: [number, number] | null;
}

/**
 * 실험에 꺼내 쓸 수 있는 모델.
 *
 * 아무 문자열이나 받으면 오타로 엉뚱한 모델에 돈이 나갑니다. 목록에 있는
 * 것만 받습니다.
 */
export const CATALOG: ModelInfo[] = [
  {
    id: "claude-opus-5",
    label: "Opus 5",
    provider: "anthropic",
    note: "지금 쓰는 모델. 입력 5 / 출력 25",
    price: [5.0, 25.0],
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    provider: "anthropic",
    note: "입력 3 / 출력 15 — Opus의 60%",
    price: [3.0, 15.0],
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    provider: "anthropic",
    note: "입력 1 / 출력 5 — Opus의 20%",
    price: [1.0, 5.0],
  },
  /*
    GPT는 **실험용으로만** 열어둡니다. 실제 채점을 이쪽으로 돌리려면
    개인정보 동의서를 먼저 고쳐야 합니다 — 지금 동의서에 적힌 국외 이전
    대상은 Anthropic PBC 하나뿐입니다(docs/14 §14.3). `client.ts`의
    `DEFAULT_MODEL`이 Anthropic 모델만 받는 이유입니다.
  */
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    provider: "openai",
    note: "단가 미상 — 확인 후 CATALOG에 적어야 비용 비교가 됩니다",
    price: null,
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    provider: "openai",
    note: "단가 미상 — 확인 후 CATALOG에 적어야 비용 비교가 됩니다",
    price: null,
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    provider: "openai",
    note: "입력 1.25 / 출력 10",
    price: [1.25, 10.0],
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    provider: "openai",
    note: "입력 0.25 / 출력 2",
    price: [0.25, 2.0],
  },
];

export const info = (model: string): ModelInfo | undefined => CATALOG.find((m) => m.id === model);

export const ids = (provider?: Provider): string[] =>
  CATALOG.filter((m) => !provider || m.provider === provider).map((m) => m.id);

/** 단가를 아는 모델인가. 모르면 비용을 **적지 않습니다**(0이 아니라 빈칸). */
export const knownPrice = (model: string): boolean => Boolean(info(model)?.price);

/**
 * 쓴 토큰을 달러로. **단가를 모르는 모델은 `null`입니다.**
 *
 * 예전에는 모르는 모델을 0으로 쳤는데, 그러면 GPT 실험이 전부 `$0.000`으로
 * 찍혀 "GPT가 훨씬 싸다"는 결론이 저절로 나옵니다.
 */
export function costUsd(usages: Usage[], model: string): number | null {
  const price = info(model)?.price;
  if (!price) return null;
  const [pin, pout] = price;
  const i = usages.reduce((a, u) => a + u.inputTokens, 0);
  const o = usages.reduce((a, u) => a + u.outputTokens, 0);
  return (i * pin + o * pout) / 1_000_000;
}
