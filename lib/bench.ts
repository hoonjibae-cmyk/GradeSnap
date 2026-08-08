import { norm } from "@/lib/grading/text";
import type { JudgeResult, Item, Verdict } from "@/lib/grading/types";

/**
 * 값싼 모델로 바꾸면 무엇을 잃는가.
 *
 * 하루 300쪽이면 월 120만 원이라 이 질문은 실제 돈 문제입니다.
 * 다만 **무엇을 재느냐가 답을 바꿉니다.**
 *
 * 문항 정답률로 재면 "97%면 충분한가?" 같은 답 없는 논쟁이 됩니다.
 * 이 시스템이 내놓는 것은 **PASS/FAIL 하나**이고, 학생에게 일어나는 일도
 * 그것뿐입니다([12 §12.8](../docs/12-page-level-grading.md)).
 * 그래서 **판정이 갈리는가**를 첫 지표로 둡니다.
 *
 * 나머지 숫자는 판정이 갈렸을 때 **왜 갈렸는지**를 짚기 위한 것입니다.
 */

export interface Run {
  model: string;
  effort: string;
  items: Pick<Item, "no" | "written">[];
  results: JudgeResult[];
  cut: number | null;
  nWrong: number;
  verdict: Verdict | null;
  /** 커트라인 ±2 안. **여기서 갈린 판정은 모델 탓이 아닐 수 있습니다.** */
  nearBoundary: boolean;
  margin: number | null;
  costUsd: number;
  latencyMs: number;
}

export interface Diff {
  /**
   * **이 한 줄이 결론입니다.** 둘 다 판정을 냈고 서로 같으면 true.
   * 한쪽이라도 판정을 못 냈으면 null — 비교 자체가 성립하지 않습니다.
   */
  verdictMatch: boolean | null;
  baseVerdict: Verdict | null;
  trialVerdict: Verdict | null;
  /**
   * 기준이 이미 커트라인에 걸려 있던 장인가.
   *
   * **같은 모델을 두 번 돌려도 여기서는 판정이 갈립니다**(2026-08-08 실측).
   * 여유가 0인 답안지는 문항 하나만 흔들려도 뒤집히므로, 이런 장의 뒤집힘은
   * 대상 모델의 흠이 아니라 **그 답안지의 성질**입니다.
   */
  baseNearBoundary: boolean;
  baseMargin: number | null;

  /** 읽어낸 칸 수. 값싼 모델이 칸을 통째로 놓치면 여기서 먼저 드러납니다. */
  baseRead: number;
  trialRead: number;
  /** 기준만 읽은 번호 / 대상만 읽은 번호 */
  onlyBase: string[];
  onlyTrial: string[];

  /** 같은 칸을 다르게 읽은 것. **고쳐 읽기가 여기 숨습니다.** */
  written: { no: string; base: string; trial: string }[];

  /** 둘 다 읽은 칸 중 정오 판정이 갈린 번호 */
  wrongOnlyBase: string[];
  wrongOnlyTrial: string[];
  /** 정오가 일치한 칸 / 둘 다 읽은 칸 */
  agree: number;
  n: number;

  costUsd: number;
  latencyMs: number;
}

const wrongSet = (r: JudgeResult[]) => new Set(r.filter((x) => !x.correct).map((x) => x.no));

export function diffRuns(base: Run, trial: Run): Diff {
  const bw = new Map(base.items.map((i) => [i.no, i.written]));
  const tw = new Map(trial.items.map((i) => [i.no, i.written]));
  const both = [...bw.keys()].filter((no) => tw.has(no));

  const bWrong = wrongSet(base.results);
  const tWrong = wrongSet(trial.results);
  const judged = both.filter((no) => base.results.some((r) => r.no === no) && trial.results.some((r) => r.no === no));

  return {
    // 판정을 안 낸 쪽이 있으면 "같다/다르다"를 말할 수 없습니다. 억지로 세지 않습니다.
    verdictMatch: base.verdict === null || trial.verdict === null ? null : base.verdict === trial.verdict,
    baseVerdict: base.verdict,
    trialVerdict: trial.verdict,
    baseNearBoundary: base.nearBoundary,
    baseMargin: base.margin,

    baseRead: bw.size,
    trialRead: tw.size,
    onlyBase: [...bw.keys()].filter((no) => !tw.has(no)),
    onlyTrial: [...tw.keys()].filter((no) => !bw.has(no)),

    // 철자는 건드리지 않고 공백·대소문자만 맞춰 비교합니다.
    // 'expectution' 과 'expectation' 은 **달라야** 합니다 — 그게 보려는 것입니다.
    written: both
      .filter((no) => norm(bw.get(no)!) !== norm(tw.get(no)!))
      .map((no) => ({ no, base: bw.get(no)!, trial: tw.get(no)! })),

    wrongOnlyBase: judged.filter((no) => bWrong.has(no) && !tWrong.has(no)),
    wrongOnlyTrial: judged.filter((no) => tWrong.has(no) && !bWrong.has(no)),
    agree: judged.filter((no) => bWrong.has(no) === tWrong.has(no)).length,
    n: judged.length,

    costUsd: trial.costUsd,
    latencyMs: trial.latencyMs,
  };
}

export interface Summary {
  sheets: number;
  /** 판정을 양쪽 다 낸 답안지 수. 일치율의 분모입니다. */
  compared: number;
  verdictAgree: number;
  /** 판정이 갈린 답안지 */
  flipped: number;
  /**
   * 그중 **기준이 이미 커트라인에 걸려 있던** 장. 같은 모델로 다시 돌려도
   * 갈리는 자리라 대상 모델의 흠으로 세면 안 됩니다.
   */
  flippedAtBoundary: number;
  /**
   * 여유가 있었는데도 갈린 장. **이게 늘면 못 바꿉니다.**
   * 모델을 바꿔서 생긴 차이라고 말할 수 있는 것은 이쪽뿐입니다.
   */
  flippedWithMargin: number;
  /**
   * **대상만** 판정을 못 낸 답안지. 값싼 모델이 커트라인을 못 읽으면 여기가 늡니다.
   * 이건 대상 모델의 흠입니다.
   */
  trialUndecided: number;
  /**
   * **기준도** 판정이 없던 답안지. 애초에 비교가 안 되는 장이고,
   * 대상 모델의 흠이 아닙니다. 둘을 뭉뚱그리면 값싼 모델을 억울하게 만듭니다.
   */
  incomparable: number;
  itemsCompared: number;
  itemsAgree: number;
  writtenDiffs: number;
  missedCells: number;
  baseCost: number;
  trialCost: number;
  baseMs: number;
  trialMs: number;
}

export function summarize(pairs: { base: Run; diff: Diff }[]): Summary {
  const s: Summary = {
    sheets: pairs.length,
    compared: 0,
    verdictAgree: 0,
    flipped: 0,
    flippedAtBoundary: 0,
    flippedWithMargin: 0,
    trialUndecided: 0,
    incomparable: 0,
    itemsCompared: 0,
    itemsAgree: 0,
    writtenDiffs: 0,
    missedCells: 0,
    baseCost: 0,
    trialCost: 0,
    baseMs: 0,
    trialMs: 0,
  };
  for (const { base, diff } of pairs) {
    if (diff.verdictMatch === null) {
      // 기준이 판정을 못 낸 장은 대상 모델 탓이 아닙니다. 구분해서 셉니다.
      if (diff.baseVerdict === null) s.incomparable++;
      else s.trialUndecided++;
    } else {
      s.compared++;
      if (diff.verdictMatch) s.verdictAgree++;
      else {
        s.flipped++;
        if (diff.baseNearBoundary) s.flippedAtBoundary++;
        else s.flippedWithMargin++;
      }
    }
    s.itemsCompared += diff.n;
    s.itemsAgree += diff.agree;
    s.writtenDiffs += diff.written.length;
    s.missedCells += diff.onlyBase.length;
    s.baseCost += base.costUsd;
    s.trialCost += diff.costUsd;
    s.baseMs += base.latencyMs;
    s.trialMs += diff.latencyMs;
  }
  return s;
}

/** 0으로 나누지 않고 비율을 씁니다. 분모가 0이면 비율이 없는 것이지 100%가 아닙니다. */
export function pct(num: number, den: number): string {
  return den ? `${((num / den) * 100).toFixed(1)}%` : "—";
}
