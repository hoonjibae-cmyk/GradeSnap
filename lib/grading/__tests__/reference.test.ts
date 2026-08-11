import { describe, expect, it } from "vitest";
import { applyReference, buildReference, refFingerprint, refKey, type ExamRef } from "../reference";
import type { Item, JudgeResult, Transcript, Warning } from "../types";

const item = (o: Partial<Item> & { no: string }): Item => ({
  prompt: `p${o.no}`,
  direction: "ko2en",
  prefix: "",
  written: "answer",
  blank: false,
  legible: true,
  erased: false,
  ...o,
});

const t = (items: Item[], title = "M6 Day14-16"): Transcript => ({
  sheet: { title, teacher: "", student: "", cutLine: "-4까지", printedTotal: items.length },
  items,
});

const ref = (items: { no: string; prompt?: string; expected: string }[]): ExamRef => ({
  fingerprint: "f",
  title: "M6 Day14-16",
  items: items.map((i) => ({ no: i.no, prompt: i.prompt ?? `p${i.no}`, direction: "ko2en", expected: i.expected })),
});

describe("시험 지문 — 무엇이 같은 시험인가", () => {
  it("제목과 번호가 같으면 같은 시험", () => {
    const a = refFingerprint(t([item({ no: "1" }), item({ no: "2" })]));
    const b = refFingerprint(t([item({ no: "1", written: "다른답" }), item({ no: "2" })]));
    expect(a).toBe(b);
  });

  it("제목의 공백·대소문자 차이는 같은 시험 — 전사 흔들림에 갈라지면 참조가 안 맞는다", () => {
    expect(refFingerprint(t([item({ no: "1" })], "m6  day14-16"))).toBe(
      refFingerprint(t([item({ no: "1" })], "M6 Day14-16")),
    );
  });

  it("번호가 다르면 다른 시험 — 1~30회차와 31~60회차가 안 섞인다", () => {
    expect(refFingerprint(t([item({ no: "1" })]))).not.toBe(refFingerprint(t([item({ no: "31" })])));
  });

  it("제목을 못 읽었으면 null — 번호만으로 맞추면 모든 단어시험이 한 시험이 된다", () => {
    expect(refFingerprint(t([item({ no: "1" })], ""))).toBeNull();
  });
});

describe("참조 대기 — 무엇을 코드가 판정하나", () => {
  it("정답과 똑같이 썼으면 정답 — 모델에 안 보낸다", () => {
    const { pre, todo } = applyReference([item({ no: "1", written: "accept" })], ref([{ no: "1", expected: "accept" }]));
    expect(pre).toEqual([{ no: "1", correct: true, expected: "accept", note: "" }]);
    expect(todo).toHaveLength(0);
  });

  it("대소문자·공백 차이는 같은 답", () => {
    const { pre } = applyReference([item({ no: "1", written: " Accept " })], ref([{ no: "1", expected: "accept" }]));
    expect(pre[0].correct).toBe(true);
  });

  it("🔴 정답과 다르다고 오답 처리하지 않는다 — 모델로 보낸다", () => {
    /*
      en2ko는 같은 뜻의 다른 표기가 정답이고(§12.6 'undo → 열다'도 정답 처리),
      철자 관대 채점도 있습니다. 자동 판정은 **정답 쪽으로만** 기울어야 합니다.
    */
    const { pre, todo } = applyReference(
      [item({ no: "1", written: "acept" })],
      ref([{ no: "1", expected: "accept" }]),
    );
    expect(pre).toHaveLength(0);
    expect(todo).toHaveLength(1);
  });

  it("빈칸은 오답 — 판정 프롬프트에 이미 있는 결정적 규칙이라 코드가 맞다", () => {
    const { pre } = applyReference(
      [item({ no: "1", written: "", blank: true })],
      ref([{ no: "1", expected: "accept" }]),
    );
    expect(pre[0]).toEqual({ no: "1", correct: false, expected: "accept", note: "무응답" });
  });

  it("판독불가는 오답 + 판독불가 표시", () => {
    const { pre } = applyReference(
      [item({ no: "1", written: "???", legible: false })],
      ref([{ no: "1", expected: "accept" }]),
    );
    expect(pre[0].note).toBe("판독불가");
  });

  it("🔴 제시어가 참조와 다르면 자동 정답 처리를 하지 않는다", () => {
    /*
      밀린 칸의 '정답 일치'는 옆 문항의 답이 우연히 맞은 것일 수 있습니다.
      checkDrift가 같은 대조로 경보를 띄우고, 판정은 모델이 합니다.
    */
    const { pre, todo } = applyReference(
      [item({ no: "1", prompt: "엉뚱한 제시어", written: "accept" })],
      ref([{ no: "1", prompt: "받아들이다", expected: "accept" }]),
    );
    expect(pre).toHaveLength(0);
    expect(todo).toHaveLength(1);
  });

  it("정답이 비어 있으면 자동 정답 처리가 없다", () => {
    const { pre, todo } = applyReference([item({ no: "1", written: "" })], ref([{ no: "1", expected: "" }]));
    expect(pre).toHaveLength(0);
    expect(todo).toHaveLength(1);
  });
});

describe("참조 만들기 — 깨끗한 답안지에서만", () => {
  const results = (items: Item[]): JudgeResult[] =>
    items.map((i) => ({ no: i.no, correct: true, expected: "accept", note: "" }));
  const clean = t([item({ no: "1" }), item({ no: "2" })]);

  it("깨끗하면 만든다", () => {
    const r = buildReference(clean, results(clean.items), [], 0);
    expect(r?.items).toHaveLength(2);
    expect(r?.fingerprint).toBe(refFingerprint(clean));
  });

  it("밀림 경보가 있으면 안 만든다 — 틀린 참조는 반 전체로 번진다", () => {
    const drift: Warning[] = [{ level: "drift", text: "밀림" }];
    expect(buildReference(clean, results(clean.items), drift, 0)).toBeNull();
  });

  it("덜 읽힌 답안지로는 안 만든다", () => {
    expect(buildReference(clean, results(clean.items), [], 2)).toBeNull();
  });

  it("정답이 빈 문항이 있으면 안 만든다", () => {
    const r: JudgeResult[] = [
      { no: "1", correct: true, expected: "accept", note: "" },
      { no: "2", correct: false, expected: "", note: "" },
    ];
    expect(buildReference(clean, r, [], 0)).toBeNull();
  });

  it("info 안내는 참조를 막지 않는다 — 절이 나뉜 시험지도 참조가 된다", () => {
    const info: Warning[] = [{ level: "info", text: "번호 묶음이 2개" }];
    expect(buildReference(clean, results(clean.items), info, 0)).not.toBeNull();
  });
});

describe("밀림 검사용 키", () => {
  it("참조의 번호·제시어를 그대로 낸다", () => {
    expect(refKey(ref([{ no: "1", prompt: "받아들이다", expected: "accept" }]))).toEqual([
      { no: "1", prompt: "받아들이다" },
    ]);
  });
});
