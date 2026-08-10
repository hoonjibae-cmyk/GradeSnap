/**
 * 채점 파이프라인이 주고받는 값들.
 *
 * `tools/grade_page.py`를 옮긴 것입니다. 그 파이썬은 실제 답안지 7쌍으로
 * 검증됐으므로(docs/12 §12.12) 여기서는 **재설계하지 않고 그대로 옮깁니다.**
 * 동작을 바꾸고 싶으면 파이썬 쪽에서 먼저 재봐야 합니다.
 */

/** 출제 방향. 한 시험지에 둘이 섞여 있는 경우가 흔합니다. */
export type Direction = "en2ko" | "ko2en" | "other";

/** 시험지 머리말에서 읽어낸 것. 조교가 입력할 항목을 0으로 만드는 근거입니다. */
export interface Sheet {
  title: string;
  teacher: string;
  student: string;
  /** 인쇄된 표기 그대로. 예: "-8 까지 pass", "( -10%까지 PASS )" */
  cutLine: string;
  /** 시험지에 인쇄된 총 문항 수. 안 적혀 있으면 0 */
  printedTotal: number;
}

/** 전사된 문항 하나. */
export interface Item {
  no: string;
  /** 그 문항에 인쇄된 제시어. **밀림 검증의 기준이라 반드시 채웁니다.** */
  prompt: string;
  direction: Direction;
  /** 답란에 첫 글자가 인쇄돼 있으면 그 글자 */
  prefix: string;
  /** 학생이 손으로 쓴 것 그대로. 철자가 틀렸으면 틀린 채로. */
  written: string;
  blank: boolean;
  legible: boolean;
  erased: boolean;
  /**
   * 압축 출력에서는 **안 받습니다**(docs/13 §13.21).
   *
   * 문항마다 18자를 쓰는데 쓰는 곳은 한 군데(양면이 겹쳤을 때 어느 쪽을
   * 남길지)뿐이고, [12 §12.13](../../docs/12-page-level-grading.md)에서
   * **고쳐 읽기를 못 잡는다는 것이 확인된** 값입니다. 모델은 고쳐 읽으면서
   * 0.90·0.93으로 확신에 차 있었습니다.
   */
  confidence?: number;
}

export interface Transcript {
  sheet: Sheet;
  items: Item[];
}

/**
 * 검증 경보. 세 단계이고 **뜻이 서로 다릅니다.**
 *
 * - `drift`      행이 밀렸을 수 있다. 판정 기준(밀림 경보 0장)에 반영합니다.
 * - `incomplete` 시험지의 일부만 찍혔다. **PASS/FAIL을 내면 안 됩니다.**
 *                안 찍힌 문항을 통째로 틀렸어도 PASS로 나가기 때문입니다.
 * - `info`       "절이 나뉜 시험지" 같은 참인 안내. 판정에 넣지 않습니다.
 *
 * 셋을 뭉뚱그리면 "뒷면을 안 찍었다"와 "행이 밀렸다"가 같은 문구로 나옵니다.
 * 조교가 해야 할 일이 완전히 다른데도요.
 */
export interface Warning {
  level: "drift" | "incomplete" | "info";
  text: string;
}

export interface MarkReading {
  convention: { checkMark: string; wrongMark: string; reasoning: string };
  /** 오답 표시가 붙은 문항 번호 */
  wrong: string[];
  /** 선생님이 적은 표기 그대로. 예: "-12" */
  scoreText: string;
  passFail: "pass" | "fail" | "unmarked";
  confidence: number;
}

export interface JudgeResult {
  no: string;
  correct: boolean;
  expected: string;
  note: string;
}

export type Verdict = "pass" | "fail";

export interface Comparison {
  /** 인쇄된 문항 수보다 덜 읽힌 칸 수. 0이면 온전합니다. */
  missing: number;
  /**
   * 못 읽은 칸을 **전부 틀렸다고 쳐도** 결정이 안 바뀌면 true.
   *
   * 덜 읽혔다고 무조건 판정을 막으면 과합니다 — 48칸 중 46칸을 읽고 오답 3개,
   * 허용 6개라면 못 읽은 2칸이 다 틀려도 5개라 여전히 통과입니다.
   * 반대로 60칸 중 47칸이면 못 읽은 13칸이 결정을 뒤집으므로 막아야 합니다.
   */
  robustToMissing: boolean;
  /** 허용 오답 개수. 머리말에서 못 읽으면 null */
  cut: number | null;
  ourVerdict: Verdict | null;
  theirVerdict: Verdict | null;
  verdictMatch: boolean | null;
  /** 커트라인 ±N 안에 있어 문항 오차 하나가 결정을 뒤집을 수 있는 상태 */
  nearBoundary: boolean;
  /** 우리 오답 개수 - 허용 개수. 음수면 통과 쪽 */
  margin: number | null;
  n: number;
  agree: number;
  rate: number;
  /** 우리가 더 엄격 — 대부분 선생님의 철자 관대 채점 */
  oursOnly: string[];
  /** 진짜 놓친 오답 */
  theirsOnly: string[];
  oursWrong: string[];
  theirsWrong: string[];
  /** 전사 문항에 붙일 수 없는 마크. **정렬 실패이지 채점 실패가 아닙니다.** */
  unmatchedMarks: string[];
}

export interface Usage {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  /**
   * 사고 강도. **어떤 설정으로 채점됐는지가 나중에 필요합니다** —
   * 기본값을 바꾼 뒤 결과가 나빠지면 언제부터인지 알아야 되돌립니다.
   * 옛 기록에는 없으므로 선택입니다.
   */
  effort?: string;
}
