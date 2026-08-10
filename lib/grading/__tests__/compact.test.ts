import { describe, expect, it } from "vitest";
import { ITEM_KEYS, RESULT_KEYS, compactJudgeSchema, compactTranscribeSchema, expand, renameProps } from "../compact";
import { JUDGE_SCHEMA, TRANSCRIBE_SCHEMA } from "../schemas";
import type { Item, JudgeResult } from "../types";

const itemSchema = (s: unknown) =>
  (s as { properties: { items: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties
    .items.items;

describe("압축 스키마 만들기", () => {
  it("문항 필드 이름만 짧아진다", () => {
    const c = itemSchema(compactTranscribeSchema(TRANSCRIBE_SCHEMA));
    expect(Object.keys(c.properties).sort()).toEqual(["b", "d", "e", "l", "n", "p", "w", "x"]);
    expect(c.required.sort()).toEqual(["b", "d", "e", "l", "n", "p", "w", "x"]);
  });

  it("설명은 그대로 남는다 — 뜻을 나르는 건 이름이 아니라 설명이다", () => {
    const full = itemSchema(TRANSCRIBE_SCHEMA);
    const c = itemSchema(compactTranscribeSchema(TRANSCRIBE_SCHEMA));
    expect(c.properties.p).toEqual(full.properties.prompt);
    expect(c.properties.w).toEqual(full.properties.written);
  });

  it("confidence는 아예 뺀다", () => {
    /*
      문항마다 18자를 쓰는데 쓰는 곳은 겹친 칸 고르기 한 군데뿐이고,
      docs/12 §12.13에서 고쳐 읽기를 못 잡는 것이 확인된 값입니다.
    */
    const c = itemSchema(compactTranscribeSchema(TRANSCRIBE_SCHEMA));
    expect(c.properties.confidence).toBeUndefined();
    expect(c.properties.c).toBeUndefined();
    expect(c.required).not.toContain("confidence");
  });

  it("머리말은 안 건드린다 — 답안지당 한 번이라 아낄 게 없다", () => {
    const c = compactTranscribeSchema(TRANSCRIBE_SCHEMA) as { properties: { sheet: unknown } };
    expect(c.properties.sheet).toEqual((TRANSCRIBE_SCHEMA as { properties: { sheet: unknown } }).properties.sheet);
  });

  it("판정 결과도 같은 방식으로", () => {
    const r = (compactJudgeSchema(JUDGE_SCHEMA) as { properties: { results: { items: { required: string[] } } } })
      .properties.results.items;
    expect(r.required.sort()).toEqual(["c", "m", "n", "x"]);
  });

  it("원본 스키마를 안 건드린다", () => {
    // 실제 채점은 원본을 씁니다. 여기서 망가뜨리면 실험이 운영을 오염시킵니다.
    compactTranscribeSchema(TRANSCRIBE_SCHEMA);
    expect(itemSchema(TRANSCRIBE_SCHEMA).properties.prompt).toBeDefined();
    expect(itemSchema(TRANSCRIBE_SCHEMA).required).toContain("confidence");
  });
});

describe("짧은 이름을 되돌리기", () => {
  it("문항 하나를 원래 모양으로", () => {
    const got = expand<Item>(
      { n: "31", p: "자주 일어나는", d: "ko2en", x: "f", w: "frequent", b: false, l: true, e: false },
      ITEM_KEYS,
    );
    expect(got).toEqual({
      no: "31",
      prompt: "자주 일어나는",
      direction: "ko2en",
      prefix: "f",
      written: "frequent",
      blank: false,
      legible: true,
      erased: false,
    });
  });

  it("판정 결과도", () => {
    expect(expand<JudgeResult>({ n: "7", c: false, x: "abandon", m: "철자 오류" }, RESULT_KEYS)).toEqual({
      no: "7",
      correct: false,
      expected: "abandon",
      note: "철자 오류",
    });
  });

  it("안 온 칸은 안 만든다 — 없는 값을 지어내지 않는다", () => {
    const got = expand<Record<string, unknown>>({ n: "1", w: "" }, ITEM_KEYS);
    expect(Object.keys(got)).toEqual(["no", "written"]);
    expect("confidence" in got).toBe(false);
  });

  it("false와 빈 문자열을 잃지 않는다", () => {
    // `if (row[short])`로 짰으면 여기서 조용히 사라집니다.
    const got = expand<Record<string, unknown>>({ b: false, w: "" }, ITEM_KEYS);
    expect(got.blank).toBe(false);
    expect(got.written).toBe("");
  });
});

describe("얼마나 줄어드나", () => {
  it("문항 하나의 JSON이 3할 넘게 짧아진다", () => {
    const full = JSON.stringify({
      no: "31",
      prompt: "자주 일어나는",
      direction: "ko2en",
      prefix: "f",
      written: "frequent",
      blank: false,
      legible: true,
      erased: false,
      confidence: 0.95,
    });
    const compact = JSON.stringify({
      n: "31",
      p: "자주 일어나는",
      d: "ko2en",
      x: "f",
      w: "frequent",
      b: false,
      l: true,
      e: false,
    });
    expect(compact.length / full.length).toBeLessThan(0.7);
  });
});

describe("renameProps", () => {
  it("모르는 이름은 그대로 둔다", () => {
    const out = renameProps({ properties: { a: 1, zzz: 2 }, required: ["a", "zzz"] }, { a: "x" });
    expect(out.properties).toEqual({ x: 1, zzz: 2 });
    expect(out.required).toEqual(["x", "zzz"]);
  });
});
