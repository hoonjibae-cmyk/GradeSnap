import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOG, costUsd, ids, info, knownPrice } from "@/lib/grading/provider";
import type { Usage } from "@/lib/grading/types";

const use = (input: number, output: number): Usage => ({
  latencyMs: 1000,
  inputTokens: input,
  outputTokens: output,
  model: "x",
});

describe("모델 목록", () => {
  it("아이디가 겹치지 않는다", () => {
    // 겹치면 `info()`가 먼저 걸린 쪽을 돌려주고, 단가가 조용히 틀립니다.
    const seen = CATALOG.map((m) => m.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("모르는 이름은 없는 것으로 답한다", () => {
    expect(info("gpt-9")).toBeUndefined();
  });

  it("회사로 거를 수 있다", () => {
    expect(ids("anthropic").every((id) => id.startsWith("claude-"))).toBe(true);
    expect(ids("openai").every((id) => id.startsWith("gpt-"))).toBe(true);
    expect(ids().length).toBe(CATALOG.length);
  });
});

describe("비용", () => {
  it("단가를 아는 모델은 토큰으로 곱한다", () => {
    // Opus 5는 입력 5 / 출력 25.
    expect(costUsd([use(1_000_000, 0)], "claude-opus-5")).toBeCloseTo(5);
    expect(costUsd([use(0, 1_000_000)], "claude-opus-5")).toBeCloseTo(25);
  });

  it("호출 여러 개를 더한다", () => {
    expect(costUsd([use(500_000, 0), use(500_000, 0)], "claude-opus-5")).toBeCloseTo(5);
  });

  it("단가를 모르는 모델은 0이 아니라 null이다", () => {
    /*
      0으로 두면 `/bench`의 비용 칸이 `$0.000`이 되고, 그건 "공짜"로 읽힙니다.
      값싼 모델을 고르려고 만든 화면에서 가장 나쁜 종류의 거짓말입니다.
    */
    const unknown = CATALOG.find((m) => !m.price);
    expect(unknown).toBeDefined();
    expect(costUsd([use(1_000_000, 1_000_000)], unknown!.id)).toBeNull();
    expect(knownPrice(unknown!.id)).toBe(false);
  });

  it("아예 모르는 모델 이름도 null이다", () => {
    expect(costUsd([use(1_000_000, 0)], "gpt-9")).toBeNull();
  });
});

describe("실제 채점에 쓸 모델", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async () => {
    vi.resetModules();
    return (await import("@/lib/grading/client")) as typeof import("@/lib/grading/client");
  };

  it("환경 변수로 Anthropic 모델끼리는 바꿀 수 있다", async () => {
    vi.stubEnv("GRADING_MODEL", "claude-sonnet-5");
    expect((await load()).DEFAULT_MODEL).toBe("claude-sonnet-5");
  });

  it("GPT로는 못 바꾼다 — 동의서에 없는 회사로 답안지가 나간다", async () => {
    /*
      🔴 이건 취향이 아니라 선입니다. 동의서(docs/14 §14.3)에 적힌 국외 이전
      대상은 Anthropic PBC 하나입니다. 환경 변수 한 줄로 실제 채점이 OpenAI로
      넘어가면 동의 없이 학생 답안지가 나갑니다. 회사를 바꾸려면 동의서를
      고치고 동의를 다시 받은 뒤 CATALOG 쪽을 손대야 합니다.
    */
    vi.stubEnv("GRADING_MODEL", "gpt-5");
    await expect(load()).rejects.toThrow(/GRADING_MODEL/);
  });

  it("오타는 조용히 넘어가지 않는다", async () => {
    vi.stubEnv("GRADING_MODEL", "claude-opus-6");
    await expect(load()).rejects.toThrow();
  });
});
