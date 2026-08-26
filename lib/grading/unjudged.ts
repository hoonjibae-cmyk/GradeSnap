/**
 * **모르는 것을 모른다고 말하게 하는 자리.**
 *
 * 2026-08-11, 순서배열·문장삽입 문항에서 정답이 통째로 틀리게 나왔습니다.
 * 프롬프트를 고쳐서 될 일이 아니었습니다 — **판정 단계는 이미지를 안 봅니다.**
 * 받는 것은 전사된 `{번호, 제시어, 학생 답}`뿐입니다.
 *
 * 단어 시험은 그것으로 충분합니다. `intention`의 정답은 제시어만 알면 나옵니다.
 * 그런데 순서배열의 정답은 **그 문항의 지문에 달려 있고**, 지문은 전사에
 * 안 담깁니다. 그래서 모델은 알 수가 없고, 알 수 없는 자리에서 **추측했습니다.**
 * 추측한 정답으로 학생을 재시험에 남기거나 통과시켰습니다.
 *
 * 고칠 방향은 둘 중 하나였습니다.
 *
 *   ① 지문을 판정 단계까지 들고 간다 — 비용이 뛰고, 그러고도 모델이 문제를
 *      **풀어야** 합니다. 채점과 다른 일이고 정확도를 잰 적이 없습니다.
 *   ② **모르면 모른다고 말하게 한다.**
 *
 * ②를 골랐습니다. 이 파일은 그 신호를 다루는 곳입니다.
 *
 * 못 푸는 문항이 생기는 것은 흠이 아닙니다. **모르면서 아는 척하는 것이
 * 흠입니다.** 못 푼 문항은 사람에게 갑니다 — 원래 사람이 하던 일입니다.
 */

import type { JudgeResult } from "./types";

/**
 * 판정 단계가 "정답을 알 수 없다"고 말할 때 쓰는 표시.
 *
 * 새 칸을 안 만들고 `note`에 넣습니다. 문항마다 칸을 하나 더 두면 출력
 * 토큰이 문항 수만큼 늘어나는데(§13.21에서 필드 이름이 출력의 58%였습니다),
 * 이 표시는 대개 몇 문항에만 붙습니다. **판독불가도 같은 방식**입니다.
 */
export const UNJUDGED = "정답모름";

/** 이 문항은 판정을 못 한 것인가. */
export const isUnjudged = (r: Pick<JudgeResult, "note">): boolean => (r.note ?? "").includes(UNJUDGED);

export interface Split {
  /** 판정된 문항. 오답 수와 커트라인 계산은 이것만 씁니다. */
  judged: JudgeResult[];
  /** 판정 못 한 문항 수. **못 읽은 칸과 같이 취급합니다.** */
  unjudged: number;
}

/**
 * 판정된 것과 못 한 것을 가릅니다.
 *
 * 못 한 문항을 오답으로 세면 **학생이 못 푼 것이 아니라 우리가 못 푼 것을
 * 학생이 뒤집어씁니다.** 정답으로 세면 반대로 그냥 넘어갑니다. 어느 쪽도
 * 아니고, `compare`의 `missing`과 같은 자리로 보냅니다 — "이만큼 전부
 * 틀렸다고 가정해도 결과가 그대로면 판정하고, 뒤집히면 판정하지 않는다."
 */
export function splitUnjudged(results: JudgeResult[]): Split {
  const judged: JudgeResult[] = [];
  let unjudged = 0;
  for (const r of results) {
    if (isUnjudged(r)) unjudged++;
    else judged.push(r);
  }
  return { judged, unjudged };
}

/** 사람에게 보일 한 줄. 몇 번 문항인지까지 적습니다 — 찾아가야 하니까. */
export function unjudgedWarning(results: JudgeResult[]): string | null {
  const nos = results.filter(isUnjudged).map((r) => r.no);
  if (!nos.length) return null;
  return (
    `${nos.length}문항은 정답을 알 수 없어 판정하지 않았습니다 (${nos.join(", ")}번). ` +
    "지문을 봐야 정답이 나오는 유형입니다 — 그 문항은 사람이 채점하십시오."
  );
}

/**
 * 저장된 문항 행 기준으로 "아직 판정이 없는가".
 *
 * **사람이 ○/✗를 눌렀으면 더 이상 모름이 아닙니다.** 그 순간부터는 보통
 * 문항처럼 세어야 하고, 안 그러면 검수를 마쳐도 판정이 영영 안 나옵니다.
 */
export const isOpen = (row: { note: string; final_correct?: boolean | null }): boolean =>
  isUnjudged(row) && (row.final_correct ?? null) === null;

// ---------------------------------------------------------------------------
// 분석 — **무엇이 판정 불가로 뜨는가**
// ---------------------------------------------------------------------------

/**
 * 2026-08-12. "대부분의 시험이 판정할 수 없는 유형으로 뜬다"는 보고를 받고
 * 만들었습니다.
 *
 * 가려야 할 것이 둘입니다. 둘은 **고치는 방법이 정반대**입니다.
 *
 *   ① 진짜 못 푸는 유형(순서배열·문장삽입)이 실제로 많다
 *      → 정답을 시험마다 한 번 사람이 정해 주면 됩니다.
 *   ② 풀 수 있는 문항까지 모델이 "모름"으로 넘긴다
 *      → 제가 넣은 규칙이 너무 넓은 것입니다. 좁히면 바로 회복됩니다.
 *
 * 숫자만으로는 못 가릅니다. 그래서 **표본(제시어·학생 답)을 같이 냅니다** —
 * 사람이 한눈에 "이건 당연히 풀 수 있는 건데"를 알아볼 수 있게.
 */

export interface UnjudgedExam {
  title: string;
  sheets: number;
  items: number;
  unjudged: number;
  /** 이 시험에서 판정 못 한 문항 비율. */
  rate: number;
  /** 실제로 어떤 문항인지. **숫자보다 이게 답을 정합니다.** */
  samples: { no: string; prompt: string; written: string }[];
}

export interface UnjudgedReport {
  items: number;
  unjudged: number;
  rate: number;
  /** 판정 못 한 문항이 있는 시험만, 많은 순으로. */
  exams: UnjudgedExam[];
}

const SAMPLES = 4;

export function summarizeUnjudged(
  sheets: { id: string; title: string }[],
  rows: { sheet_id: string; no: string; prompt: string; written: string; note: string; final_correct?: boolean | null }[],
): UnjudgedReport {
  const titleOf = new Map(sheets.map((s) => [s.id, (s.title || "").trim() || "(제목 못 읽음)"]));
  const byTitle = new Map<string, UnjudgedExam & { ids: Set<string> }>();
  let items = 0;
  let unjudged = 0;

  for (const r of rows) {
    const title = titleOf.get(r.sheet_id);
    // 이 기간 답안지에 속하지 않는 행은 셈에서 뺍니다.
    if (title === undefined) continue;
    let e = byTitle.get(title);
    if (!e) {
      e = { title, sheets: 0, items: 0, unjudged: 0, rate: 0, samples: [], ids: new Set() };
      byTitle.set(title, e);
    }
    e.ids.add(r.sheet_id);
    e.items++;
    items++;
    // **사람이 이미 채점한 것은 빼고 셉니다** — 남은 일이 얼마인지가 알고 싶은 값입니다.
    if (isOpen(r)) {
      e.unjudged++;
      unjudged++;
      if (e.samples.length < SAMPLES) {
        e.samples.push({ no: r.no, prompt: r.prompt, written: r.written });
      }
    }
  }

  const exams = [...byTitle.values()]
    .map(({ ids, ...e }) => ({ ...e, sheets: ids.size, rate: e.items ? e.unjudged / e.items : 0 }))
    .filter((e) => e.unjudged > 0)
    .sort((a, b) => b.unjudged - a.unjudged);

  return { items, unjudged, rate: items ? unjudged / items : 0, exams };
}
