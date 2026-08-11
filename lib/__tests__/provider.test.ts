import { describe, expect, it } from "vitest";
import { CATALOG, costUsd, ids, info, knownPrice, normalizeGrading } from "@/lib/grading/provider";
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

      지금은 목록의 모든 모델에 단가가 있어 아래 반복문이 빕니다. 그래도
      남겨둡니다 — 단가를 모르는 모델을 넣는 순간 이 규칙이 다시 살아납니다.
    */
    for (const m of CATALOG.filter((x) => !x.price)) {
      expect(costUsd([use(1_000_000, 1_000_000)], m.id)).toBeNull();
      expect(knownPrice(m.id)).toBe(false);
    }
    expect(costUsd([use(1_000_000, 0)], "gpt-9")).toBeNull();
    expect(knownPrice("gpt-9")).toBe(false);
  });

  it("화면에 적어둔 'Opus 대비 몇 %'가 실제 계산과 맞는다", () => {
    /*
      실측 토큰은 전사 1쪽 = 입력 4,993 / 출력 3,306 (docs/12 §12.2).
      `note`에 적힌 비율이 여기서 나옵니다 — 표시와 계산이 갈리면 원장님이
      틀린 값으로 모델을 고릅니다.
    */
    const page = [use(4_993, 3_306)];
    const rel = (id: string) => Math.round((costUsd(page, id)! / costUsd(page, "claude-opus-5")!) * 100);
    expect(rel("gpt-5.6-sol")).toBe(115);
    expect(rel("gpt-5.6-terra")).toBe(46);
    expect(rel("gpt-5.6-luna")).toBe(5);
    expect(rel("claude-sonnet-5")).toBe(60);
  });
});

describe("실제 채점에 쓸 설정", () => {
  it("아는 Anthropic 모델과 아는 강도는 통과한다", () => {
    expect(normalizeGrading("claude-opus-5", "low")).toEqual({ model: "claude-opus-5", effort: "low" });
    expect(normalizeGrading("claude-sonnet-5", "high")).toEqual({ model: "claude-sonnet-5", effort: "high" });
  });

  it("🔴 GPT는 통과 못 한다 — 동의서에 없는 회사로 답안지가 나간다", () => {
    /*
      취향이 아니라 선입니다. 동의서(docs/14 §14.8)에 적힌 국외 이전 대상은
      Anthropic PBC 하나입니다. 실제 채점이 OpenAI로 넘어가면 동의 없이
      학생 답안지가 나갑니다. DB의 CHECK와 여기서 **둘 다** 막습니다 —
      한 겹이 뚫려도 나머지가 남게.
    */
    expect(normalizeGrading("gpt-5.6-terra", "low")).toBeNull();
    expect(normalizeGrading("gpt-5.6-luna", "high")).toBeNull();
  });

  it("모르는 모델·강도는 통과 못 한다", () => {
    expect(normalizeGrading("claude-opus-6", "low")).toBeNull();
    expect(normalizeGrading("claude-opus-5", "빠르게")).toBeNull();
  });

  it("칸이 없으면 null — 기본값으로 슬쩍 메우지 않는다", () => {
    /*
      마이그레이션 전에 배포가 먼저 붙으면 이 값이 undefined입니다. 그때
      기본값을 채우면 화면은 "Opus 5"라고 말하는데 실제로는 다른 것이 돌 수
      있습니다. 조교에게 무엇으로 채점됐는지 보여주려고 만든 값이라
      추측하면 안 됩니다.
    */
    expect(normalizeGrading(undefined, undefined)).toBeNull();
    expect(normalizeGrading(null, "low")).toBeNull();
  });
});

describe("캐시 단가", () => {
  const u = (o: Partial<Usage>): Usage => ({ latencyMs: 0, inputTokens: 0, outputTokens: 0, model: "x", ...o });

  it("캐시 읽기는 10%, 쓰기는 125%", () => {
    // 1M 읽기 = 정가 $5의 10% = $0.5 · 1M 쓰기 = $6.25
    expect(costUsd([u({ cacheRead: 1_000_000 })], "claude-opus-5")).toBeCloseTo(0.5);
    expect(costUsd([u({ cacheWrite: 1_000_000 })], "claude-opus-5")).toBeCloseTo(6.25);
  });

  it("🔴 캐시 토큰을 빼먹으면 비용이 싸게 나온다 — 그래서 따로 센다", () => {
    /*
      캐시가 걸리면 그 몫이 input_tokens에서 빠져서 옵니다. 이 테스트가
      없었다면 캐싱을 켠 날부터 비용 화면이 조용히 거짓말을 했을 것입니다.
    */
    const cached = costUsd([u({ inputTokens: 4_000, cacheRead: 1_000, outputTokens: 3_000 })], "claude-opus-5")!;
    const uncached = costUsd([u({ inputTokens: 5_000, outputTokens: 3_000 })], "claude-opus-5")!;
    expect(cached).toBeLessThan(uncached); // 읽기가 싸니 총액은 내려가고
    expect(cached).toBeGreaterThan(costUsd([u({ inputTokens: 4_000, outputTokens: 3_000 })], "claude-opus-5")!); // 공짜는 아닙니다
  });

  it("옛 기록(캐시 칸 없음)은 예전 그대로 계산된다", () => {
    expect(costUsd([u({ inputTokens: 1_000_000 })], "claude-opus-5")).toBeCloseTo(5);
  });
});
