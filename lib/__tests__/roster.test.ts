import { describe, expect, it } from "vitest";
import type { SheetRow, WrongItemRow } from "@/lib/db/schema";
import { byClass, retestText, splitRoster, wrongText } from "../roster";

const sheet = (o: Partial<SheetRow>): SheetRow =>
  ({
    id: o.student_name ?? "x",
    class_name: "",
    title: "단어시험",
    student_name: "",
    status: "confirmed",
    final_verdict: "pass",
    n_wrong: 0,
    cut: 5,
    ...o,
  }) as SheetRow;

describe("누가 남고 누가 가는가", () => {
  it("확정된 것만 명단에 넣는다", () => {
    const s = splitRoster([
      sheet({ student_name: "가", final_verdict: "fail" }),
      sheet({ student_name: "나", final_verdict: "pass" }),
    ]);
    expect(s.retest.map((r) => r.student_name)).toEqual(["가"]);
    expect(s.passed.map((r) => r.student_name)).toEqual(["나"]);
    expect(s.pending).toHaveLength(0);
  });

  it("검수 전 판정으로 학생을 남기지 않는다", () => {
    // 시스템이 FAIL로 봤지만 아직 선생님이 확정하지 않은 답안지.
    const s = splitRoster([sheet({ student_name: "가", status: "graded", verdict: "fail", final_verdict: null })]);
    expect(s.retest).toHaveLength(0);
    expect(s.pending).toHaveLength(1);
  });

  it("채점 중·실패도 미확정으로 센다 — 통과로 새지 않는다", () => {
    const s = splitRoster([
      sheet({ student_name: "가", status: "running", final_verdict: null }),
      sheet({ student_name: "나", status: "failed", final_verdict: null }),
    ]);
    expect(s.pending).toHaveLength(2);
    expect(s.passed).toHaveLength(0);
  });

  it("확정인데 판정이 없으면 통과로 세지 않는다", () => {
    const s = splitRoster([sheet({ student_name: "가", status: "confirmed", final_verdict: null })]);
    expect(s.passed).toHaveLength(0);
    expect(s.pending).toHaveLength(1);
  });
});

describe("반별로 묶기", () => {
  it("반 이름순으로 묶는다", () => {
    const g = byClass([
      sheet({ student_name: "가", class_name: "중3 B" }),
      sheet({ student_name: "나", class_name: "중3 A" }),
      sheet({ student_name: "다", class_name: "중3 A" }),
    ]);
    expect(g.map(([k, v]) => [k, v.length])).toEqual([
      ["중3 A", 2],
      ["중3 B", 1],
    ]);
  });

  it("반을 안 적었어도 사라지지 않는다", () => {
    const g = byClass([sheet({ student_name: "가", class_name: "  " })]);
    expect(g).toEqual([["반 없음", expect.any(Array)]]);
  });
});

describe("붙여넣을 글로 만들기", () => {
  it("반별로 이름을 나열한다", () => {
    const t = retestText("2026-08-08", [sheet({ student_name: "가", class_name: "중3 A" })], 0);
    expect(t).toContain("2026-08-08 재시험 명단 (1명)");
    expect(t).toContain("중3 A");
    expect(t).toContain("가");
  });

  it("미확정이 남았으면 글 안에 적는다 — 화면 경고는 붙여넣기를 따라가지 않는다", () => {
    const t = retestText("2026-08-08", [], 3);
    expect(t).toContain("3장");
    expect(t).toContain("늘어날 수 있습니다");
  });

  it("대상이 없으면 '없음'이라고 쓴다 — 빈 글을 붙여넣게 두지 않는다", () => {
    expect(retestText("2026-08-08", [], 0)).toContain("없음");
  });

  it("오답을 학생별로 묶고 무응답도 적는다", () => {
    const w = (o: Partial<WrongItemRow>): WrongItemRow =>
      ({
        sheet_id: "s1",
        received_on: "2026-08-08",
        class_name: "",
        student_name: "가",
        title: "DAY 32",
        seq: 0,
        no: "1",
        prompt: "expectation",
        written: "",
        expected: "기대",
        note: "",
        overturned: false,
        ...o,
      }) as WrongItemRow;
    const t = wrongText("2026-08-08", [w({}), w({ sheet_id: "s2", student_name: "나", no: "7", written: "관전" })]);
    expect(t).toContain("가 — DAY 32 (1개)");
    expect(t).toContain("1. expectation → (무응답) (정답: 기대)");
    expect(t).toContain("나 — DAY 32 (1개)");
    expect(t).toContain("7. expectation → 관전");
  });
});
