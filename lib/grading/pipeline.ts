/**
 * 전사된 답안지 하나를 **판정까지** 끌고 가는 흐름.
 *
 * 라우트에 두지 않고 여기 둔 이유가 있습니다. 시험 참조(§13.27)는
 * 라이브러리도 마이그레이션도 설정 스위치도 다 만들어 놓고 **부르는 곳을
 * 안 붙였습니다.** 조각마다 테스트가 있었고 전부 통과했는데, 실제 채점은
 * 그 조각을 한 번도 안 지나갔습니다(§13.34).
 *
 * 조각이 아니라 **흐름**을 테스트할 자리가 없으면 같은 일이 또 납니다.
 * 그래서 흐름을 라우트 밖으로 꺼냈습니다 — 여기서 DB도 HTTP도 안 씁니다.
 */

import { checkDrift, missingCount } from "./drift";
import { applyReference, buildReference, refFingerprint, refKey, type ExamRef } from "./reference";
import { judge, judgeWithKey } from "./stages";
import { isUnjudged, splitUnjudged, unjudgedWarning } from "./unjudged";
import type { CallOptions, ModelClient } from "./provider";
import type { JudgeResult, Transcript, Usage, Warning } from "./types";

/** 참조 저장소. 실제로는 `exam_refs` 표이고, 테스트에서는 Map입니다. */
export interface RefStore {
  get(fingerprint: string): Promise<ExamRef | null>;
  save(ref: ExamRef, sourceSheet: string): Promise<void>;
}

export interface JudgeSheetInput {
  transcript: Transcript;
  /** 올린 사진 장수. 밀림과 "덜 찍힘"을 가려 말하는 데 씁니다. */
  pages: number;
  strictSpelling: boolean;
  /** 관리 화면의 스위치. 꺼져 있으면 참조를 **읽지도 만들지도** 않습니다. */
  useRefs: boolean;
  sheetId: string;
  opts?: CallOptions;
}

export interface JudgedSheet {
  results: JudgeResult[];
  warnings: Warning[];
  missing: number;
  /** 판정 단계에서 쓴 토큰. 전사 것은 부르는 쪽이 이미 들고 있습니다. */
  usage: Usage[];
  /** 참조를 대고 판정했는가. */
  usedRef: boolean;
  /** 모델에 실제로 보낸 문항 수. **0이면 판정 호출을 아예 안 했습니다.** */
  judgedByModel: number;
  /** 이 답안지로 참조를 새로 만들었는가. */
  savedRef: boolean;
  /**
   * **정답을 알 수 없어 판정하지 못한 문항 수**(§13.40).
   *
   * 오답이 아닙니다. 못 읽은 칸(`missing`)과 같은 자리로 보내야 합니다 —
   * 이만큼 전부 틀렸다고 가정해도 결과가 그대로면 판정하고, 뒤집히면
   * 판정하지 않습니다.
   */
  unjudged: number;
}

export async function judgeSheet(
  client: ModelClient,
  input: JudgeSheetInput,
  refs: RefStore,
): Promise<JudgedSheet> {
  const { transcript, pages, strictSpelling, useRefs, sheetId, opts } = input;

  const fingerprint = useRefs ? refFingerprint(transcript) : null;
  const ref = fingerprint ? await refs.get(fingerprint) : null;

  /*
    참조가 있으면 제시어 대조가 **독립된 기준**을 갖습니다. 참조가 없을 때의
    밀림 검출은 답안지 자기 자신만 보고 판단합니다.
  */
  const warnings = checkDrift(transcript, ref ? refKey(ref) : undefined, pages);
  const missing = missingCount(transcript);
  const usage: Usage[] = [];

  if (ref) {
    // 빈칸·판독불가·정답과 똑같이 쓴 답은 코드가 끝냅니다. 규칙이 결정적인
    // 것을 모델에 물으면 가끔 다르게 답합니다.
    const { pre, todo, expectedByNo } = applyReference(transcript.items, ref);
    if (!todo.length) {
      // 볼 것이 하나도 없는 답안지 — **판정 호출을 안 합니다.**
      return { ...withUnjudged(pre, warnings), missing, usage, usedRef: true, judgedByModel: 0, savedRef: false };
    }
    const r = await judgeWithKey(client, todo, expectedByNo, strictSpelling, opts);
    usage.push(r.usage);
    return {
      ...withUnjudged([...pre, ...r.results], warnings),
      missing,
      usage,
      usedRef: true,
      judgedByModel: todo.length,
      savedRef: false,
    };
  }

  const r = await judge(client, transcript, strictSpelling, opts);
  usage.push(r.usage);

  /*
    이 답안지가 그 시험의 첫 **깨끗한** 장이면 참조로 남깁니다. 조건이 하나라도
    깨지면 안 만듭니다 — 다음 장이 만들면 되고, 틀린 참조는 반 전체로 번집니다.

    저장이 실패해도 채점은 그대로 나갑니다. 참조는 다음 장이 만들면 되는
    것이지, 이 학생의 결과를 버릴 이유가 아닙니다.
  */
  let savedRef = false;
  /*
    🔴 **판정 못 한 문항이 있으면 참조를 안 만듭니다.**

    참조는 그 시험의 정답 기준이 됩니다. 정답을 모르는 문항이 섞인 채로
    저장하면 **반 전체가 빈 정답 또는 지어낸 정답으로 채점됩니다.** 참조가
    없으면 매번 전체 경로로 갈 뿐이라 잃는 것은 절감뿐입니다.
  */
  const anyUnjudged = r.results.some(isUnjudged);
  if (useRefs && !anyUnjudged) {
    const built = buildReference(transcript, r.results, warnings, missing);
    if (built) {
      try {
        await refs.save(built, sheetId);
        savedRef = true;
      } catch (e) {
        console.error("[exam_refs] 저장", e instanceof Error ? e.message : String(e));
      }
    }
  }

  return {
    ...withUnjudged(r.results, warnings),
    missing,
    usage,
    usedRef: false,
    judgedByModel: transcript.items.length,
    savedRef,
  };
}

/**
 * 판정 못 한 문항을 세고, **사람이 보라고 경고를 답니다.**
 *
 * 경고를 안 달면 화면에는 "오답 3개"만 뜨고 판정이 왜 없는지 아무도
 * 모릅니다. 못 푼 것 자체보다 **말 안 하는 것**이 문제입니다.
 */
function withUnjudged(results: JudgeResult[], warnings: Warning[]) {
  const { unjudged } = splitUnjudged(results);
  const text = unjudgedWarning(results);
  return {
    results,
    unjudged,
    warnings: text ? [...warnings, { level: "incomplete" as const, text }] : warnings,
  };
}
