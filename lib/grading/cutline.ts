import type { Verdict } from "./types";

/**
 * 머리말의 커트라인 표기 → 허용 오답 개수. 못 읽으면 null.
 *
 * 실제 시험지에 인쇄된 여섯 종류로 확인했습니다:
 *   "-8 까지 pass" · "( -10%까지 PASS )" · "커트라인 -7개"
 *   "/20(컷 -5)" · "어법&구문 -3 까지 PASS" · "-12칸"
 *
 * **조교가 입력할 항목이 아닙니다.** 시험지에 이미 인쇄돼 있습니다.
 */
export function parseCut(text: string | null | undefined, nItems: number): number | null {
  if (!text || !nItems) return null;
  const m = /-\s*(\d+(?:\.\d+)?)\s*(%|퍼센트)?/.exec(String(text));
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] ? Math.floor((nItems * v) / 100) : Math.floor(v);
}

/** 오답 개수 → PASS/FAIL. 커트라인을 못 읽으면 null. */
export function verdict(nWrong: number, cut: number | null): Verdict | null {
  if (cut === null) return null;
  return nWrong <= cut ? "pass" : "fail";
}
