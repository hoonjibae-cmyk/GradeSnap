import { describe, expect, it } from "vitest";
import { compare } from "../compare";
import { parseCut, verdict } from "../cutline";
import { checkDrift, hasDrift, isIncomplete } from "../drift";
import { mergeTranscripts } from "../merge";
import { norm, numKey } from "../text";
import type { Item, Transcript } from "../types";

/**
 * 이 파일은 파이썬 원본(`tools/grade_page.py`)과 **같은 사례로 같은 답**이 나오는지
 * 봅니다. 사례는 전부 실제 답안지에서 나온 것입니다 — 지어낸 것이 없습니다.
 */

const item = (o: Partial<Item> & { no: string }): Item => ({
  prompt: `p${o.no}`,
  direction: "en2ko",
  prefix: "",
  written: "뜻",
  blank: false,
  legible: true,
  erased: false,
  confidence: 0.9,
  ...o,
});

const sheet = (printedTotal = 0) => ({
  title: "t",
  teacher: "T",
  student: "S",
  cutLine: "",
  printedTotal,
});

const t = (items: Item[], printedTotal = 0): Transcript => ({ sheet: sheet(printedTotal), items });

describe("커트라인 파싱 — 실제 시험지에 인쇄된 표기", () => {
  it.each([
    ["-8 까지 pass", 50, 8],
    ["( -10%까지 PASS )", 48, 4],
    ["커트라인 -7개", 50, 7],
    ["/20(컷 -5)", 20, 5],
    ["어법&구문 -3 까지 PASS", 15, 3],
    ["컷 -8(오답필수)", 140, 8],
    ["-12칸", 60, 12],
  ])("%s (문항 %i) → 허용 %i개", (text, n, want) => {
    expect(parseCut(text, n)).toBe(want);
  });

  it("커트라인이 없으면 판정하지 않는다 — 추측하면 학생이 잘못 남는다", () => {
    expect(parseCut("없음", 30)).toBeNull();
    expect(parseCut("", 30)).toBeNull();
    expect(verdict(3, null)).toBeNull();
  });

  it("허용 개수까지는 통과다", () => {
    expect(verdict(8, 8)).toBe("pass");
    expect(verdict(9, 8)).toBe("fail");
  });
});

describe("밀림 검증", () => {
  it("정상 시험지에는 경보가 없다", () => {
    const items = [
      ...Array.from({ length: 30 }, (_, i) => item({ no: String(i + 1) })),
      ...Array.from({ length: 20 }, (_, i) =>
        item({ no: String(i + 31), direction: "ko2en", prefix: "a", written: "accept" }),
      ),
    ];
    expect(checkDrift(t(items, 50))).toEqual([]);
  });

  it("절이 나뉜 시험지를 중복으로 오인하지 않는다 (1~14 다음 1) 2) 3))", () => {
    // 숫자만 뽑아 비교하면 '1)'이 '1'과 충돌해 없는 중복이 생겼었다.
    const items = [
      ...Array.from({ length: 14 }, (_, i) => item({ no: String(i + 1) })),
      ...[1, 2, 3].map((n) => item({ no: `${n})` })),
    ];
    const w = checkDrift(t(items, 17));
    expect(w.filter((x) => x.text.includes("중복"))).toHaveLength(0);
    expect(hasDrift(w)).toBe(false); // 절 안내는 밀림이 아니다
    expect(w.map((x) => x.level)).toEqual(["info"]);
  });

  it("진짜 중복은 여전히 잡는다", () => {
    const items = [item({ no: "1" }), item({ no: "2" }), item({ no: "2" })];
    const w = checkDrift(t(items));
    expect(w.some((x) => x.level === "drift" && x.text.includes("중복"))).toBe(true);
  });

  it("번호가 비면 밀림으로 본다", () => {
    const items = [1, 2, 4, 5].map((n) => item({ no: String(n) }));
    expect(hasDrift(checkDrift(t(items)))).toBe(true);
  });

  it("전사가 인쇄 문항 수보다 많으면 밀림으로 본다", () => {
    // 개수가 넘치는 것은 페이지 누락으로 설명되지 않는다 — 뭔가 잘못 읽은 것이다
    const items = Array.from({ length: 52 }, (_, i) => item({ no: String(i + 1) }));
    const w = checkDrift(t(items, 50));
    expect(w.some((x) => x.level === "drift" && x.text.includes("인쇄된 문항 수"))).toBe(true);
  });

  it("번호가 비면서 개수도 모자라면 '일부만 찍힘'이 아니라 밀림이다", () => {
    // 1..49 중 7이 빠지고 총 48개. 페이지 누락이면 번호가 안 빈다.
    const items = [...Array(49).keys()].map((n) => n + 1).filter((n) => n !== 7).map((n) => item({ no: String(n) }));
    const w = checkDrift(t(items, 50));
    expect(hasDrift(w)).toBe(true);
    expect(isIncomplete(w)).toBe(false);
  });

  it("첫 글자가 인쇄된 칸에 다른 답이 들어오면 잡는다", () => {
    // 38번 prefix 'p' 자리에 39번 답 'victim'이 들어온 상황
    const items = [
      item({ no: "38", direction: "ko2en", prefix: "p", written: "victim" }),
      item({ no: "39", direction: "ko2en", prefix: "v", written: "virtual" }),
    ];
    const w = checkDrift(t(items));
    expect(w.some((x) => x.text.includes("인쇄된 첫 글자"))).toBe(true);
    expect(w.some((x) => x.text.includes("38"))).toBe(true);
  });

  it("한글→영어 칸에 한글 답이 들어오면 잡는다", () => {
    const items = [item({ no: "31", direction: "ko2en", written: "제안" })];
    expect(checkDrift(t(items)).some((x) => x.text.includes("출제 방향"))).toBe(true);
  });

  it("영어→한글 칸의 정상 답은 언어 경보를 내지 않는다", () => {
    // '~때문에'처럼 기호가 섞여도 한글이 있으면 정상
    const items = [item({ no: "3", written: "~ 때문에" }), item({ no: "5", written: "~불만아니라 ~도" })];
    expect(checkDrift(t(items)).filter((x) => x.text.includes("출제 방향"))).toHaveLength(0);
  });
});

describe("대조 — 정렬 실패를 채점 실패로 세지 않는다", () => {
  const results = (n: number, wrong: string[]) =>
    Array.from({ length: n }, (_, i) => ({
      no: String(i + 1),
      correct: !wrong.includes(String(i + 1)),
      expected: "",
      note: "",
    }));

  it("산문 라벨은 '놓친 오답'이 아니라 '대조 불가'다", () => {
    const c = compare(results(17, []), {
      wrong: ["1) 동명사만 목적어로 쓰는 동사 - decide", "2) to부정사만 - keep"],
      passFail: "unmarked",
    });
    expect(c.theirsOnly).toHaveLength(0);
    expect(c.unmatchedMarks).toHaveLength(2);
  });

  it("정상 번호는 그대로 대조된다", () => {
    const c = compare(results(50, ["16", "39", "46"]), { wrong: ["16", "39", "46", "47"], passFail: "pass" });
    expect(c.theirsOnly).toEqual(["47"]);
    expect(c.oursOnly).toEqual([]);
    expect(c.agree).toBe(49);
  });

  it("번호는 사전순이 아니라 수 순서로 정렬한다", () => {
    const c = compare(results(50, ["2", "10", "9"]), { wrong: [], passFail: "unmarked" });
    expect(c.oursWrong).toEqual(["2", "9", "10"]);
  });
});

describe("PASS/FAIL — 학생에게 실제로 일어나는 일", () => {
  const results = (n: number, wrong: string[]) =>
    Array.from({ length: n }, (_, i) => ({
      no: String(i + 1),
      correct: !wrong.includes(String(i + 1)),
      expected: "",
      note: "",
    }));
  const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

  it("오답 하나를 놓쳐도 커트라인에서 멀면 결정은 같다 (실측 pair3)", () => {
    // 선생님 13개, 우리 12개. 커트라인 8개 → 양쪽 다 FAIL.
    const c = compare(results(50, nums(1, 12)), { wrong: nums(1, 13), passFail: "fail" }, "-8 까지 pass");
    expect(c.theirsOnly).toEqual(["13"]); // 문항 단위로는 놓쳤지만
    expect(c.verdictMatch).toBe(true); // 학생에게 일어난 일은 같다
    expect(c.nearBoundary).toBe(false);
  });

  it("커트라인에 걸리면 문항 하나가 결정을 뒤집고, 그 장은 검수로 표시된다", () => {
    const c = compare(results(48, nums(1, 5)), { wrong: nums(1, 4), passFail: "pass" }, "( -10%까지 PASS )");
    expect(c.cut).toBe(4);
    expect(c.ourVerdict).toBe("fail");
    expect(c.theirVerdict).toBe("pass");
    expect(c.verdictMatch).toBe(false);
    expect(c.nearBoundary).toBe(true); // ← 사람이 본다
  });

  it("선생님이 적은 PASS/FAIL이 마크 개수보다 우선한다", () => {
    // 마크를 하나 덜 읽었어도 선생님이 F라고 썼으면 F다
    const c = compare(results(50, nums(1, 12)), { wrong: nums(1, 3), passFail: "fail" }, "-8 까지 pass");
    expect(c.theirVerdict).toBe("fail");
  });

  it("커트라인을 못 읽으면 판정하지 않는다", () => {
    const c = compare(results(20, ["1"]), { wrong: ["1"], passFail: "unmarked" }, "없음");
    expect(c.verdictMatch).toBeNull();
    expect(c.nearBoundary).toBe(false);
  });
});

describe("정규화 — 철자는 건드리지 않는다", () => {
  it("공백·대소문자만 통일한다", () => {
    expect(norm("  Accept ")).toBe("accept");
    expect(norm("~ 때문에")).toBe("~ 때문에");
  });

  it("오타를 고치지 않는다", () => {
    expect(norm("propessional")).not.toBe(norm("professional"));
    expect(norm("관전")).not.toBe(norm("관점"));
  });

  it("번호 키는 접미 기호를 무시한다", () => {
    expect(numKey("3)")).toBe(3);
    expect(numKey("12")).toBe(12);
  });
});

describe("현장 테스트에서 나온 것 — 양면 시험지", () => {
  const page = (from: number, to: number, printedTotal = 0): Transcript =>
    t(
      Array.from({ length: to - from + 1 }, (_, i) => item({ no: String(from + i) })),
      printedTotal,
    );

  it("앞면만 찍으면 '뒷면을 마저 찍으라'고 한다 — 밀림이 아니다", () => {
    // 실제로 겪은 상황: 60문항 시험지의 앞면 47문항만 촬영
    const w = checkDrift(page(1, 47, 60));
    expect(hasDrift(w)).toBe(false); // 밀림 경보가 아니다
    expect(isIncomplete(w)).toBe(true);
    expect(w[0].text).toContain("뒷면");
    expect(w[0].text).toContain("47문항만");
  });

  it("일부만 찍혔으면 PASS/FAIL을 내지 않는다", () => {
    // 안 찍힌 13문항을 통째로 틀린 학생도 통과로 나가면 안 된다
    const results = Array.from({ length: 47 }, (_, i) => ({
      no: String(i + 1),
      correct: i >= 3,
      expected: "",
      note: "",
    }));
    const ok = compare(results, { wrong: [], passFail: "unmarked" }, "-8 까지 pass", 2, false);
    expect(ok.ourVerdict).toBe("pass"); // 완전한 시험지였다면 통과

    const partial = compare(results, { wrong: [], passFail: "unmarked" }, "-8 까지 pass", 2, true);
    expect(partial.ourVerdict).toBeNull(); // 일부만 찍혔으면 판정하지 않는다
    expect(partial.nearBoundary).toBe(false);
  });

  it("앞뒤 두 장을 문항 번호로 합친다 — 순서를 사람이 맞출 필요가 없다", () => {
    // 뒷면에는 머리말이 없습니다 — 제목도 문항 수도 안 찍혀 있습니다
    const back = page(48, 60);
    back.sheet = { title: "", teacher: "", student: "", cutLine: "", printedTotal: 0 };
    const front = page(1, 47, 60);
    front.sheet.title = "M6 Day14-16";

    // 일부러 뒤집어 넣는다
    const merged = mergeTranscripts([back, front]);
    expect(merged.items).toHaveLength(60);
    expect(merged.items[0].no).toBe("1");
    expect(merged.items[59].no).toBe("60");
    expect(merged.sheet.title).toBe("M6 Day14-16"); // 머리말은 있는 쪽에서
    expect(merged.sheet.printedTotal).toBe(60); // 큰 값을 쓴다
    expect(checkDrift(merged)).toEqual([]); // 합치면 경보가 없다
  });

  it("겹쳐 찍힌 문항은 확신도가 높은 쪽을 남긴다", () => {
    const a = t([item({ no: "47", written: "흐림", confidence: 0.4 })]);
    const b = t([item({ no: "47", written: "또렷", confidence: 0.95 })]);
    expect(mergeTranscripts([a, b]).items[0].written).toBe("또렷");
    expect(mergeTranscripts([b, a]).items[0].written).toBe("또렷");
  });

  it("커트라인을 사람이 넣으면 그대로 쓰인다", () => {
    // 채점 표시가 머리말을 가려 못 읽는 경우. 시험 하나에 한 번이면 된다.
    expect(parseCut("-8 까지 pass", 60)).toBe(8);
  });
});
