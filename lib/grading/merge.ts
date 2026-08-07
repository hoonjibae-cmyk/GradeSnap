import { byNumber, numKey } from "./text";
import type { Item, Sheet, Transcript } from "./types";

/**
 * 한 학생의 답안지가 여러 장일 때 하나로 합칩니다.
 *
 * **양면 인쇄 시험지가 실제로 있습니다.** 앞면만 찍으면 60문항 중 47문항만
 * 채점되고, 안 찍힌 13문항을 통째로 틀린 학생도 통과로 나갑니다.
 *
 * 페이지 순서를 사람이 맞출 필요는 없습니다 — 문항 번호로 정렬합니다.
 * 같은 번호가 두 장에 겹쳐 나오면(경계에 걸쳐 찍은 경우) 확신도가 높은 쪽을 남깁니다.
 */
export function mergeTranscripts(parts: Transcript[]): Transcript {
  if (parts.length === 0) throw new Error("합칠 전사 결과가 없습니다.");
  if (parts.length === 1) return parts[0];

  const byNo = new Map<string, Item>();
  for (const p of parts) {
    for (const it of p.items) {
      const prev = byNo.get(it.no);
      if (!prev || it.confidence > prev.confidence) byNo.set(it.no, it);
    }
  }
  const items = [...byNo.values()].sort((a, b) => byNumber(a.no, b.no));

  return { sheet: mergeSheet(parts.map((p) => p.sheet)), items };
}

/**
 * 머리말은 보통 첫 장에만 있습니다. 장마다 읽힌 값 중 **채워진 것**을 고르되,
 * 문항 수는 **가장 큰 값**을 씁니다 — 뒷장에 "47~60" 같은 부분 표기가 있어도
 * 전체 문항 수를 낮춰 잡으면 누락 검사가 통째로 무력해지기 때문입니다.
 */
function mergeSheet(sheets: Sheet[]): Sheet {
  const pick = (k: "title" | "teacher" | "student" | "cutLine") =>
    sheets.map((s) => (s?.[k] ?? "").trim()).find(Boolean) ?? "";
  return {
    title: pick("title"),
    teacher: pick("teacher"),
    student: pick("student"),
    cutLine: pick("cutLine"),
    printedTotal: Math.max(0, ...sheets.map((s) => s?.printedTotal ?? 0)),
  };
}

/** 합친 뒤에도 몇 번까지 있는지 — 화면에 "N번까지 찍힘"을 보여주기 위함. */
export function lastNumber(items: Item[]): number {
  const nums = items.map((i) => numKey(i.no)).filter((n) => n < Number.MAX_SAFE_INTEGER);
  return nums.length ? Math.max(...nums) : 0;
}
