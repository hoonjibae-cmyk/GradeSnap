import { describe, expect, it } from "vitest";
import { judgeSheet, type RefStore } from "../pipeline";
import { JUDGE_KEY_SCHEMA } from "../schemas";
import type { ExamRef } from "../reference";
import type { CallOptions, JsonRequest, ModelClient } from "../provider";
import type { Item, Transcript, Usage } from "../types";

/*
  🔴 이 파일이 있는 이유.

  시험 참조는 라이브러리·마이그레이션·설정 스위치가 전부 있었고 조각마다
  테스트가 통과했는데, **실제 채점이 그 조각을 한 번도 안 지나갔습니다.**
  라우트에 흐름이 있어서 흐름을 테스트할 자리가 없었습니다(§13.34).

  그래서 여기서 재는 것은 함수의 정확성이 아니라 **무엇이 실제로 불렸는가**
  입니다. 참조가 있으면 정답을 다시 만들지 않는가, 없으면 만들어 두는가.
*/

const usage = (): Usage => ({ latencyMs: 1, inputTokens: 10, outputTokens: 10, model: "test" });

function item(no: string, written: string, extra: Partial<Item> = {}): Item {
  return {
    no,
    prompt: `p${no}`,
    direction: "ko2en",
    prefix: "",
    written,
    blank: false,
    legible: true,
    erased: false,
    ...extra,
  };
}

function transcript(items: Item[], title = "3과 단어시험"): Transcript {
  return {
    sheet: { title, student: "홍길동", teacher: "", cutLine: "-2 까지 pass", printedTotal: items.length },
    items,
  };
}

/** 어떤 스키마로 불렸는지 기록하는 가짜 모델. 값보다 **호출 자체**가 증거입니다. */
function fake(answer: (req: JsonRequest) => unknown) {
  const calls: { schema: unknown; text: string }[] = [];
  const client: ModelClient = {
    provider: "anthropic",
    async callJson<T>(req: JsonRequest, _opts?: CallOptions) {
      calls.push({ schema: req.schema, text: req.text });
      return { data: answer(req) as T, usage: usage() };
    },
  };
  return { client, calls };
}

const REF: ExamRef = {
  fingerprint: "3과 단어시험|1,2,3",
  title: "3과 단어시험",
  items: [
    { no: "1", prompt: "p1", direction: "ko2en", expected: "apple" },
    { no: "2", prompt: "p2", direction: "ko2en", expected: "banana" },
    { no: "3", prompt: "p3", direction: "ko2en", expected: "cherry" },
  ],
};

function store(initial?: ExamRef) {
  const saved: { ref: ExamRef; sheet: string }[] = [];
  let held = initial ?? null;
  const refs: RefStore = {
    async get(fp) {
      return held && held.fingerprint === fp ? held : null;
    },
    async save(ref, sheet) {
      saved.push({ ref, sheet });
      held = ref;
    },
  };
  return { refs, saved };
}

describe("채점 흐름 — 시험 참조가 실제로 불리는가", () => {
  it("참조가 있으면 정답을 다시 만들지 않습니다 (judgeWithKey로 갑니다)", async () => {
    const t = transcript([item("1", "apple"), item("2", "bananna"), item("3", "cherry")]);
    const { client, calls } = fake(() => ({ results: [{ no: "2", correct: true, note: "오타" }] }));

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: true, sheetId: "s1" },
      store(REF).refs,
    );

    expect(out.usedRef).toBe(true);
    expect(calls).toHaveLength(1);
    // 정답이 **입력**으로 들어가고 출력 스키마에는 없습니다.
    expect(calls[0].schema).toBe(JUDGE_KEY_SCHEMA);
    // 정확히 같게 쓴 두 칸은 모델에 안 갑니다.
    expect(out.judgedByModel).toBe(1);
    expect(calls[0].text).toContain("bananna");
    expect(calls[0].text).not.toContain("apple");
    // 그래도 결과는 전 문항이 나옵니다.
    expect(out.results.map((r) => r.no).sort()).toEqual(["1", "2", "3"]);
    expect(out.results.find((r) => r.no === "1")).toMatchObject({ correct: true, expected: "apple" });
  });

  it("전부 정답과 같으면 판정 호출을 아예 안 합니다", async () => {
    const t = transcript([item("1", "apple"), item("2", "banana"), item("3", "cherry")]);
    const { client, calls } = fake(() => ({ results: [] }));

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: true, sheetId: "s2" },
      store(REF).refs,
    );

    expect(calls).toHaveLength(0);
    expect(out.judgedByModel).toBe(0);
    expect(out.results).toHaveLength(3);
    expect(out.results.every((r) => r.correct)).toBe(true);
  });

  it("참조가 없으면 지금까지처럼 판정하고, 깨끗하면 참조로 남깁니다", async () => {
    const t = transcript([item("1", "apple"), item("2", "banana"), item("3", "cherry")]);
    const { client, calls } = fake(() => ({
      results: [
        { no: "1", correct: true, expected: "apple", note: "" },
        { no: "2", correct: true, expected: "banana", note: "" },
        { no: "3", correct: true, expected: "cherry", note: "" },
      ],
    }));
    const s = store();

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: true, sheetId: "s3" },
      s.refs,
    );

    expect(out.usedRef).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].schema).not.toBe(JUDGE_KEY_SCHEMA);
    expect(out.savedRef).toBe(true);
    expect(s.saved).toHaveLength(1);
    expect(s.saved[0].sheet).toBe("s3");
    expect(s.saved[0].ref.items.map((i) => i.expected)).toEqual(["apple", "banana", "cherry"]);
  });

  it("스위치가 꺼져 있으면 참조를 읽지도 만들지도 않습니다", async () => {
    const t = transcript([item("1", "apple")]);
    const { client } = fake(() => ({ results: [{ no: "1", correct: true, expected: "apple", note: "" }] }));
    const s = store(REF);

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: false, sheetId: "s4" },
      s.refs,
    );

    expect(out.usedRef).toBe(false);
    expect(out.savedRef).toBe(false);
    expect(s.saved).toHaveLength(0);
  });

  it("못 읽은 칸이 있으면 참조로 만들지 않습니다 — 틀린 참조는 반 전체로 번집니다", async () => {
    const t = transcript([item("1", "apple"), item("2", "", { blank: true }), item("3", "cherry")]);
    const { client } = fake(() => ({
      results: [
        { no: "1", correct: true, expected: "apple", note: "" },
        { no: "2", correct: false, expected: "", note: "무응답" },
        { no: "3", correct: true, expected: "cherry", note: "" },
      ],
    }));
    const s = store();

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: true, sheetId: "s5" },
      s.refs,
    );

    expect(out.savedRef).toBe(false);
    expect(s.saved).toHaveLength(0);
  });

  it("저장이 실패해도 채점 결과는 그대로 나갑니다", async () => {
    const t = transcript([item("1", "apple")]);
    const { client } = fake(() => ({ results: [{ no: "1", correct: true, expected: "apple", note: "" }] }));
    const refs: RefStore = {
      async get() {
        return null;
      },
      async save() {
        throw new Error("RLS 거부");
      },
    };

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: true, sheetId: "s6" },
      refs,
    );

    expect(out.savedRef).toBe(false);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].correct).toBe(true);
  });
});

/*
  2026-08-12. 순서배열·문장삽입은 정답이 지문에 달려 있어 답란만 봐서는
  알 수 없습니다. **사람이 시험마다 정답지를 한 번 등록**하면 그때부터
  채점됩니다(§13.42).

  여기서 재는 것은 그 정답지가 **실제로 채점 경로에 끼어드는가**입니다.
  §13.34에서 만들어 놓고 안 부른 적이 있어서, 이번에는 흐름으로 고정합니다.
*/
describe("사람이 등록한 정답지", () => {
  const KEY: ExamRef = {
    fingerprint: "key:ch13문법추가시험",
    title: "Ch.13 문법 추가시험",
    // 정답지에는 제시어가 없습니다 — 번호와 정답뿐입니다.
    items: [
      { no: "1", prompt: "", direction: "ko2en", expected: "(C)-(A)-(B)" },
      { no: "2", prompt: "", direction: "ko2en", expected: "③" },
    ],
  };
  const withKey = (k: ExamRef | null): RefStore => ({
    async get() {
      return null;
    },
    async byTitle() {
      return k;
    },
    async save() {},
  });

  it("정답과 똑같이 쓴 기호 답은 **모델을 안 부르고** 코드가 정답 처리합니다", async () => {
    const t = transcript([item("1", "(C)-(A)-(B)"), item("2", "③")], "Ch.13 문법 추가시험");
    const { client, calls } = fake(() => ({ results: [] }));

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: false, sheetId: "s1" },
      withKey(KEY),
    );

    expect(calls).toHaveLength(0);
    expect(out.usedRef).toBe(true);
    expect(out.unjudged).toBe(0);
    expect(out.results.every((r) => r.correct)).toBe(true);
  });

  it("다르게 쓴 것만 모델이 봅니다", async () => {
    const t = transcript([item("1", "(C)-(A)-(B)"), item("2", "②")], "Ch.13 문법 추가시험");
    const { client, calls } = fake(() => ({ results: [{ no: "2", correct: false, note: "" }] }));

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: false, sheetId: "s2" },
      withKey(KEY),
    );

    expect(out.judgedByModel).toBe(1);
    expect(calls[0].text).toContain("②");
    expect(out.results.find((r) => r.no === "1")?.correct).toBe(true);
  });

  it("🔴 절감 스위치가 꺼져 있어도 정답지는 씁니다 — 값이 아니라 근거입니다", async () => {
    const t = transcript([item("1", "(C)-(A)-(B)"), item("2", "③")], "Ch.13 문법 추가시험");
    const { client, calls } = fake(() => ({ results: [] }));

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: false, sheetId: "s3" },
      withKey(KEY),
    );

    expect(out.usedRef).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("정답지가 없으면 지금까지처럼 갑니다", async () => {
    const t = transcript([item("1", "(C)-(A)-(B)")], "등록 안 된 시험");
    const { client, calls } = fake(() => ({
      results: [{ no: "1", correct: true, expected: "(C)-(A)-(B)", note: "" }],
    }));

    const out = await judgeSheet(
      client,
      { transcript: t, pages: 1, strictSpelling: false, useRefs: false, sheetId: "s4" },
      withKey(null),
    );

    expect(out.usedRef).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
