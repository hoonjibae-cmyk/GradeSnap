/**
 * "지금 접수하면 언제 나오나."
 *
 * 2026-08-10에 원장님이 정한 요구사항이 하나 생겼습니다.
 *
 * > **학생이 가기 전에 알아야 합니다.**
 *
 * 그러면 조교가 알아야 하는 것이 하나 늘어납니다 — **얼마나 기다려야 하나.**
 * 화면에 "채점 중 3"만 떠 있으면 3분인지 15분인지 모르고, 모르면 학생을
 * 잡아둘지 보낼지 정할 수가 없습니다.
 *
 * 한 장의 채점 시간 자체는 **쌓인 양과 무관합니다.** 모델 호출은 각각
 * 독립이라 옆에서 몇 장이 돌든 그 장은 그 장대로 끝납니다. 늘어나는 것은
 * **줄 서는 시간**뿐입니다.
 */

/** 동시에 돌릴 수 있는 갈래 수. 브라우저 하나당입니다 — 조교 둘이면 두 배. */
export interface Queue {
  /** 아직 시작 못 한 장 */
  queued: number;
  /** 지금 돌고 있는 장 */
  running: number;
  /** 동시에 돌릴 수 있는 수 */
  lanes: number;
  /** 한 장에 걸리는 초. 실측에서 옵니다 — 추측하지 않습니다. */
  secPerSheet: number;
}

/**
 * **마지막 장이 끝나기까지 몇 초인가.**
 *
 * 넉넉하게 잡습니다 — 지금 돌고 있는 장이 얼마나 진행됐는지는 모르므로
 * 방금 시작한 것으로 칩니다. **모자라게 말하는 것보다 낫습니다.**
 * "5분"이라고 해놓고 12분 걸리면 학생을 이미 보낸 뒤입니다.
 */
export function waitSeconds(q: Queue): number {
  const total = q.queued + q.running;
  if (total <= 0) return 0;
  const lanes = Math.max(1, q.lanes);
  return Math.ceil(total / lanes) * q.secPerSheet;
}

/** 사람이 읽는 한 줄. 초 단위는 조교에게 쓸모없습니다. */
export function describeWait(sec: number): string {
  if (sec <= 0) return "";
  if (sec < 90) return "1분 안";
  return `약 ${Math.ceil(sec / 60)}분`;
}

/**
 * 실측 한 장당 초. **중앙값**을 씁니다.
 *
 * 평균은 60문항짜리 한 장에 끌려갑니다. 조교가 알고 싶은 것은 "보통
 * 얼마나"이지 "평균이 얼마"가 아닙니다.
 *
 * 잰 게 없으면 `null` — **추측한 숫자를 화면에 띄우지 않습니다.**
 * 틀린 대기 시간은 없는 것보다 나쁩니다.
 */
export function medianSeconds(latenciesMs: number[]): number | null {
  const ok = latenciesMs.filter((n) => n > 0).sort((a, b) => a - b);
  if (!ok.length) return null;
  const mid = Math.floor(ok.length / 2);
  const ms = ok.length % 2 ? ok[mid] : (ok[mid - 1] + ok[mid]) / 2;
  return ms / 1000;
}
