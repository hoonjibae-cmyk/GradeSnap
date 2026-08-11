/**
 * 같은 시험을 30번 새로 읽지 않습니다 — **시험 참조**.
 *
 * 한 반 30명이 같은 시험을 봅니다. 그런데 지금까지 학생마다
 *
 *   - 판정 모델이 **정답(expected)을 30번 새로 만들어냈고**
 *   - 그래서 같은 답을 쓴 두 학생이 **다른 판정을 받을 수 있었습니다**
 *     (김예지 재실행에서 판정이 흔들리는 것을 실측으로 봤습니다 — docs/13 §13.21)
 *
 * 첫 학생의 결과를 그 시험의 참조로 남기면, 다음 학생부터는
 *
 *   ① 정답이 **반 전체에 하나**입니다 — 공정성이자 일관성입니다
 *   ② 전사된 제시어를 참조와 대조합니다 — **밀림 검출이 독립된 기준을 갖습니다**
 *      (`checkDrift`의 `key` 매개변수가 애초에 이걸 위해 있었습니다)
 *   ③ 정답과 정확히 같은 답·빈칸·판독불가는 코드가 판정합니다 —
 *      모델은 애매한 것만 봅니다. 판정 출력이 그만큼 줄어듭니다 (§13.27)
 *
 * 🔴 **참조가 틀리면 반 전체로 번집니다.** 그래서
 *   - 참조는 **깨끗한 답안지에서만** 만듭니다 (밀림 경보 0 · 누락 0 · 정답 전부 채워짐)
 *   - 먼저 저장된 참조를 유지합니다 — 나중 것으로 덮지 않습니다
 *   - 전 장 사람 검수가 그대로 안전망입니다. 검수를 줄이는 근거가 아닙니다
 */

import { norm } from "./text";
import type { Direction, Item, JudgeResult, Transcript, Warning } from "./types";

export interface RefItem {
  no: string;
  prompt: string;
  direction: Direction;
  expected: string;
}

export interface ExamRef {
  fingerprint: string;
  title: string;
  items: RefItem[];
}

/**
 * "같은 시험인가"의 기준.
 *
 * **제목 + 문항 번호 전부**입니다. 번호까지 넣었으므로 참조가 맞았다는 것은
 * 곧 번호 집합이 같다는 뜻이고, 그래서 참조 적용 코드에 "이 번호가 참조에
 * 없으면"이라는 경우가 없습니다.
 *
 * 제목이 안 읽힌 답안지는 `null` — 번호만으로 맞추면 "1~10번 단어시험"이
 * 전부 한 시험이 됩니다. 참조가 없으면 지금까지처럼 전체 경로로 갈 뿐이라
 * 잃는 것은 절감뿐입니다. **틀린 참조보다 없는 참조가 낫습니다.**
 */
export function refFingerprint(t: Transcript): string | null {
  const title = norm(t.sheet?.title);
  if (!title) return null;
  const nos = (t.items ?? []).map((i) => String(i.no).trim());
  if (!nos.length) return null;
  return `${title}|${nos.join(",")}`;
}

/** `checkDrift`의 `key` 모양으로. 제시어 대조가 참조 기준으로 이뤄집니다. */
export function refKey(ref: ExamRef): { no: string; prompt: string }[] {
  return ref.items.map((i) => ({ no: i.no, prompt: i.prompt }));
}

export interface Applied {
  /** 코드가 이미 판정한 것. 모델에 안 보냅니다. */
  pre: JudgeResult[];
  /** 모델이 봐야 하는 것 — 정답과 다르게 쓴 답. */
  todo: Item[];
  /** 번호 → 참조 정답. 모델 출력에 expected가 없으므로 여기서 채웁니다. */
  expectedByNo: Map<string, string>;
}

/**
 * 참조를 대고 문항을 가릅니다.
 *
 * 코드가 판정하는 세 가지는 **판정 프롬프트에 이미 적혀 있는 규칙**입니다
 * (무응답=오답, 판독불가=오답, 그리고 정답과 같으면 정답). 규칙이 결정적이면
 * 모델보다 코드가 맞습니다 — 모델은 가끔 규칙을 어기고, 코드는 안 어깁니다.
 *
 * **정답 일치 판정은 정답 쪽으로만 기웁니다.** 참조 정답과 다르다고 오답
 * 처리하지 않습니다 — en2ko는 같은 뜻의 다른 표기가 정답이고(§12.6),
 * 철자 관대 채점도 있습니다. 다른 것은 전부 모델이 봅니다.
 */
export function applyReference(items: Item[], ref: ExamRef): Applied {
  const byNo = new Map(ref.items.map((i) => [i.no, i]));
  const pre: JudgeResult[] = [];
  const todo: Item[] = [];
  const expectedByNo = new Map<string, string>();

  for (const it of items) {
    const r = byNo.get(it.no);
    const expected = r?.expected ?? "";
    expectedByNo.set(it.no, expected);

    if (!it.legible) {
      pre.push({ no: it.no, correct: false, expected, note: "판독불가" });
      continue;
    }
    if (it.blank) {
      pre.push({ no: it.no, correct: false, expected, note: "무응답" });
      continue;
    }
    /*
      제시어가 참조와 다르면 자동 정답 처리를 하지 않습니다. 그 칸은 밀렸을
      수 있고, 밀린 칸의 "정답 일치"는 **옆 문항의 답이 우연히 맞은 것**일 수
      있습니다. `checkDrift`가 같은 대조로 경보를 띄워 사람에게 보냅니다 —
      여기서는 판정을 모델로 넘길 뿐입니다.
    */
    const promptMatches = !r?.prompt || !it.prompt || norm(r.prompt) === norm(it.prompt);
    if (promptMatches && expected && norm(it.written) === norm(expected)) {
      pre.push({ no: it.no, correct: true, expected, note: "" });
      continue;
    }
    todo.push(it);
  }
  return { pre, todo, expectedByNo };
}

/**
 * 이 답안지의 결과로 참조를 만들 수 있는가. 못 만들면 `null`.
 *
 * 조건이 하나라도 깨지면 만들지 않습니다 — 다음 깨끗한 답안지가 만들면
 * 됩니다. **급할 것이 없고, 틀린 참조는 반 전체로 번집니다.**
 */
export function buildReference(
  t: Transcript,
  results: JudgeResult[],
  warnings: Warning[],
  missing: number,
): ExamRef | null {
  const fingerprint = refFingerprint(t);
  if (!fingerprint) return null;
  if (missing > 0) return null;
  if (warnings.some((w) => w.level === "drift" || w.level === "incomplete")) return null;

  const byNo = new Map(results.map((r) => [r.no, r]));
  const items: RefItem[] = [];
  for (const it of t.items) {
    const r = byNo.get(it.no);
    // 정답이 비면 참조 자격이 없습니다. 빈 정답은 자동 판정을 전부 모델로
    // 흘려보내니 해는 없지만, 그런 참조를 저장하면 자리만 차지합니다.
    if (!r?.expected?.trim()) return null;
    if (!(it.prompt ?? "").trim()) return null;
    items.push({ no: it.no, prompt: it.prompt, direction: it.direction, expected: r.expected });
  }
  if (!items.length) return null;
  return { fingerprint, title: t.sheet.title, items };
}
