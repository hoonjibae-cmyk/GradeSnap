import { parseCut, verdict } from "./cutline";
import { byNumber } from "./text";
import type { Comparison, JudgeResult, MarkReading } from "./types";

/**
 * 우리 채점과 선생님 채점을 맞춰 봅니다.
 *
 * 두 가지를 지킵니다.
 *
 * **① 정렬 실패를 채점 실패로 세지 않습니다.** 마크 판독이 문항 번호가 아니라
 * '1) 동명사만 쓰는 동사 - decide' 같은 산문을 돌려주면, 그건 우리가 오답을 놓친
 * 것이 아니라 두 결과를 맞출 수 없는 것입니다. 섞으면 판정 지표가 조용히 부풉니다.
 *
 * **② 결정 단위는 문항이 아니라 답안지 한 장의 PASS/FAIL입니다.**
 * 학생에게 일어나는 일은 집에 가느냐 남아서 재시험이냐 뿐이고, 문항 한둘이
 * 어긋나도 커트라인에서 멀면 결정은 안 바뀝니다(docs/12 §12.8).
 */
export function compare(
  results: JudgeResult[],
  marks: Pick<MarkReading, "wrong" | "passFail">,
  cutLine?: string | null,
  boundary = 2,
  /**
   * 인쇄된 문항 수보다 덜 읽힌 칸 수.
   *
   * 이만큼을 **전부 틀렸다고 가정해도** 결정이 그대로면 판정을 냅니다.
   * 뒤집히면 내지 않습니다 — 안 읽힌 칸을 통째로 틀린 학생을 집에 보내게 됩니다.
   */
  missing = 0,
): Comparison {
  const known = new Set(results.map((r) => r.no));
  const ours = new Set(results.filter((r) => !r.correct).map((r) => r.no));

  const raw = new Set((marks.wrong ?? []).map((w) => String(w).trim()).filter(Boolean));
  const theirs = new Set([...raw].filter((w) => known.has(w)));
  const unmatched = [...raw].filter((w) => !known.has(w)).sort(byNumber);

  const sym = [...new Set([...ours, ...theirs])].filter((x) => ours.has(x) !== theirs.has(x));
  const agree = known.size - sym.length;

  const cut = parseCut(cutLine, known.size + missing);
  const plain = verdict(ours.size, cut);
  // 못 읽은 칸이 전부 오답이었다면 어떻게 되는가. 결과가 같으면 판정해도 안전합니다.
  const worst = verdict(ours.size + missing, cut);
  const robustToMissing = missing === 0 || (plain !== null && plain === worst);

  const ourVerdict = robustToMissing ? plain : null;
  // 선생님이 PASS/FAIL을 적어 두었으면 그게 우선입니다. 없으면 마크 개수로 셉니다.
  const theirVerdict = !robustToMissing
    ? null
    : marks.passFail === "pass" || marks.passFail === "fail"
      ? marks.passFail
      : verdict(theirs.size, cut);

  return {
    missing,
    robustToMissing,
    cut,
    ourVerdict,
    theirVerdict,
    verdictMatch: ourVerdict === null || theirVerdict === null ? null : ourVerdict === theirVerdict,
    // 커트라인 근처면 문항 오차 하나가 결정을 뒤집습니다. 그 장만 사람이 봅니다.
    nearBoundary: robustToMissing && cut !== null && Math.abs(ours.size - cut) <= boundary,
    margin: cut === null ? null : ours.size - cut,
    n: known.size,
    agree,
    rate: known.size ? agree / known.size : 0,
    oursOnly: [...ours].filter((x) => !theirs.has(x)).sort(byNumber),
    theirsOnly: [...theirs].filter((x) => !ours.has(x)).sort(byNumber),
    oursWrong: [...ours].sort(byNumber),
    theirsWrong: [...theirs].sort(byNumber),
    unmatchedMarks: unmatched,
  };
}
