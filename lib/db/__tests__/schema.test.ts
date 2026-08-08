import { describe, expect, it } from "vitest";
import { compare } from "@/lib/grading/compare";
import type { Item, JudgeResult } from "@/lib/grading/types";
import { needsReview, toItemRows, toJudgeResults } from "../schema";
import type { ItemRow, SheetRow } from "../schema";

const item = (no: string, written = "뜻"): Item => ({
  no,
  prompt: `p${no}`,
  direction: "en2ko",
  prefix: "",
  written,
  blank: false,
  legible: true,
  erased: false,
  confidence: 0.9,
});

const judged = (no: string, correct: boolean): JudgeResult => ({ no, correct, expected: "정답", note: "" });

describe("전사와 판정을 문항 행으로 붙이기", () => {
  it("번호로 맞붙인다 — 순서가 달라도 된다", () => {
    const rows = toItemRows("s1", [item("1"), item("2")], [judged("2", false), judged("1", true)]);
    expect(rows.map((r) => [r.no, r.correct])).toEqual([
      ["1", true],
      ["2", false],
    ]);
  });

  it("seq는 시험지 순서다 — 번호가 문자열이어도 흔들리지 않는다", () => {
    const rows = toItemRows("s1", [item("1)"), item("2)"), item("A-3")], []);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(rows[2].no).toBe("A-3");
  });

  it("판정이 없는 문항도 행은 남긴다 — 조용히 버리면 문항 수가 안 맞는다", () => {
    const rows = toItemRows("s1", [item("1"), item("2")], [judged("1", true)]);
    expect(rows).toHaveLength(2);
    expect(rows[1].correct).toBeNull(); // false가 아니다. 아직 안 본 것이다.
  });

  it("검수 칸은 비워둔다 — 선생님이 손댄 것만 채워야 뒤집힌 건을 셀 수 있다", () => {
    const [row] = toItemRows("s1", [item("1")], [judged("1", false)]);
    expect(row.teacher_correct).toBeNull();
    expect(row.reviewed_by).toBeNull();
  });

  it("학생이 쓴 것을 그대로 옮긴다 — 철자를 고치지 않는다", () => {
    const [row] = toItemRows("s1", [item("1", "refrigiator")], []);
    expect(row.written).toBe("refrigiator");
  });
});

describe("저장된 문항으로 커트라인만 다시 세기", () => {
  // 1차 현장 테스트: 빨간펜이 머리말을 덮어 커트라인을 못 읽었습니다.
  // 모자란 건 숫자 하나뿐이라 모델을 다시 부르지 않고 셈만 고칩니다.
  const stored = (n: number, wrong: number): Pick<ItemRow, "no" | "correct" | "expected" | "note">[] =>
    Array.from({ length: n }, (_, i) => ({ no: String(i + 1), correct: i >= wrong, expected: "", note: "" }));

  it("나중에 넣은 커트라인으로 판정이 나온다", () => {
    const c = compare(toJudgeResults(stored(50, 5)), { wrong: [], passFail: "unmarked" }, "-7 까지 pass");
    expect(c.cut).toBe(7);
    expect(c.ourVerdict).toBe("pass");
  });

  it("경계선이면 그대로 경계선으로 잡힌다", () => {
    const c = compare(toJudgeResults(stored(50, 7)), { wrong: [], passFail: "unmarked" }, "커트라인 -7개");
    expect(c.margin).toBe(0);
    expect(c.nearBoundary).toBe(true);
  });

  it("못 읽은 칸을 함께 넣어 세면 판정이 막힐 수 있다", () => {
    // 60문항 중 47칸만 읽힌 답안지. 못 읽은 13칸이 다 틀리면 FAIL로 뒤집힙니다.
    const c = compare(toJudgeResults(stored(47, 3)), { wrong: [], passFail: "unmarked" }, "-8 까지 pass", 2, 13);
    expect(c.robustToMissing).toBe(false);
    expect(c.ourVerdict).toBeNull();
  });

  it("판정이 안 된 문항은 오답으로 셉니다 — 통과시키는 쪽으로 기울지 않습니다", () => {
    const rows = [{ no: "1", correct: null, expected: "", note: "" }];
    expect(toJudgeResults(rows)[0].correct).toBe(false);
  });

  it("선생님이 고친 값이 시스템 판정을 이깁니다", () => {
    const rows = [
      { no: "1", correct: false, final_correct: true, expected: "", note: "" }, // 선생님이 살려줌
      { no: "2", correct: true, final_correct: false, expected: "", note: "" }, // 선생님이 잡아냄
      { no: "3", correct: true, final_correct: true, expected: "", note: "" },
    ];
    expect(toJudgeResults(rows).map((r) => r.correct)).toEqual([true, false, true]);
  });

  it("검수한 결과로 커트라인을 다시 판단합니다", () => {
    // 시스템은 오답 7개(허용 7, 여유 0)로 봤는데 선생님이 하나를 살려주면
    // 여유가 1로 늘어 경계선에서 벗어나는지까지 다시 세어져야 합니다.
    const rows = Array.from({ length: 50 }, (_, i) => ({
      no: String(i + 1),
      correct: i >= 7,
      final_correct: i >= 6, // 1번을 선생님이 정답 처리
      expected: "",
      note: "",
    }));
    const c = compare(toJudgeResults(rows), { wrong: [], passFail: "unmarked" }, "커트라인 -7개");
    expect(c.oursWrong).toHaveLength(6);
    expect(c.margin).toBe(-1);
    expect(c.ourVerdict).toBe("pass");
  });
});

describe("사람이 반드시 봐야 하는 답안지", () => {
  const sheet = (o: Partial<SheetRow>): SheetRow =>
    ({ status: "graded", near_boundary: false, verdict: "pass", warnings: [], ...o }) as SheetRow;

  it("커트라인에 걸리면 부른다", () => {
    expect(needsReview(sheet({ near_boundary: true }))).toBe(true);
  });

  it("판정을 못 냈으면 부른다", () => {
    expect(needsReview(sheet({ verdict: null }))).toBe(true);
  });

  it("번호가 밀렸으면 부른다", () => {
    expect(needsReview(sheet({ warnings: [{ level: "drift", text: "" }] }))).toBe(true);
  });

  it("절이 나뉜 시험지 같은 안내는 부르지 않는다 — info는 참인 설명이다", () => {
    expect(needsReview(sheet({ warnings: [{ level: "info", text: "" }] }))).toBe(false);
  });

  it("아직 채점 중인 것은 세지 않는다", () => {
    expect(needsReview(sheet({ status: "running", near_boundary: true }))).toBe(false);
  });
});
