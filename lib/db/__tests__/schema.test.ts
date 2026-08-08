import { describe, expect, it } from "vitest";
import type { Item, JudgeResult } from "@/lib/grading/types";
import { toItemRows } from "../schema";

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
