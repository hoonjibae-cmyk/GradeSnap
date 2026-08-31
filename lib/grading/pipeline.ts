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
import type { MatchHow, SheetShape } from "./match";
import { applyReference, buildReference, refFingerprint, refKey, type ExamRef } from "./reference";
import { judge, judgeWithKey } from "./stages";
import { isUnjudged, splitUnjudged, unjudgedWarning } from "./unjudged";
import type { CallOptions, ModelClient } from "./provider";
import type { JudgeResult, Transcript, Usage, Warning } from "./types";

/** 정답지를 찾아본 결과. **못 찾은 이유까지 나릅니다.** */
export interface KeyLookup {
  ref: ExamRef | null;
  /** 어느 경로로 찾았는가. 제목이 똑같은 것이 아니면 화면에 적습니다. */
  how?: MatchHow;
  why?: string;
  /** 비슷해서 **못 고른** 후보들. 있으면 사람이 제목만 고치면 되는 상황입니다. */
  ambiguous: { title: string; score: number }[];
}

/** 참조 저장소. 실제로는 `exam_refs` 표이고, 테스트에서는 Map입니다. */
export interface RefStore {
  get(fingerprint: string): Promise<ExamRef | null>;
  /**
   * **사람이 등록한 정답지**(docs/13 §13.42).
   *
   * 프로그램이 스스로 만든 참조보다 **먼저** 봅니다 — 근거가 편의를
   * 이깁니다. 그리고 절감 스위치(`useRefs`)와 무관하게 늘 봅니다. 이건
   * 값을 아끼는 장치가 아니라 **정답을 어디서 얻느냐**의 문제입니다.
   *
   * 제목이 글자까지 같아야 붙던 것을 §13.45에서 세 겹으로 넓혔습니다
   * (`match.ts`). 그래서 제목만이 아니라 **답안지 모양 전체**를 받습니다.
   */
  findKey?(sheet: SheetShape): Promise<KeyLookup>;
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

  /*
    🔴 **정답지가 먼저입니다.**

    순서배열·문장삽입처럼 정답이 지문에 달린 문항은 답란만 봐서는 알 수
    없습니다(§13.40). 사람이 시험마다 한 번 등록해 두면 그때부터 채점됩니다.
    절감 스위치와 무관하게 늘 찾습니다 — 이건 값이 아니라 근거입니다.
  */
  const lookup = refs.findKey
    ? await refs.findKey({
        title: transcript.sheet?.title ?? "",
        items: (transcript.items ?? []).map((i) => ({ no: i.no, prompt: i.prompt })),
      })
    : null;
  const keyed = lookup?.ref ?? null;
  const fingerprint = useRefs ? refFingerprint(transcript) : null;
  const ref = keyed ?? (fingerprint ? await refs.get(fingerprint) : null);

  /*
    참조가 있으면 제시어 대조가 **독립된 기준**을 갖습니다. 참조가 없을 때의
    밀림 검출은 답안지 자기 자신만 보고 판단합니다.

    다만 **정답지에는 제시어가 없습니다.** 빈 제시어로 대조하면 모든 문항이
    밀린 것처럼 보입니다 — 있는 것만 씁니다.
  */
  const key = ref && ref.items.some((i) => i.prompt) ? refKey(ref) : undefined;
  const warnings = [...checkDrift(transcript, key, pages), ...keyNotes(lookup)];
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
 * 정답지를 **어떻게** 찾았는지(또는 왜 못 찾았는지) 화면에 적습니다.
 *
 * 제목이 글자까지 같아서 붙은 것은 아무 말도 안 합니다 — 그게 정상입니다.
 * 나머지 둘은 반드시 말합니다.
 *
 *   - **다른 경로로 붙었다.** 조용히 맞히는 것보다 시끄럽게 맞히는 편이
 *     낫습니다. 잘못 붙었으면 반 전체가 남의 정답으로 채점되는데, 그걸
 *     알아챌 수 있는 사람은 답안지를 보고 있는 조교뿐입니다.
 *   - **비슷한 것이 여럿이라 못 골랐다.** 이건 **고칠 수 있는 상황**입니다.
 *     이름을 대 주면 사람이 제목 한 줄만 맞춰 다시 등록하면 끝납니다.
 *     이름을 안 대면 "정답 모름"만 뜨고 아무도 이유를 모릅니다.
 *
 * 둘 다 `info`입니다 — 참인 안내일 뿐, PASS/FAIL을 막을 일은 아닙니다.
 * 막아 버리면 이 기능은 켜 놓으나 마나가 됩니다.
 */
function keyNotes(lookup: KeyLookup | null): Warning[] {
  if (!lookup) return [];
  if (lookup.ref) {
    if (!lookup.how || lookup.how === "제목") return [];
    return [
      {
        level: "info",
        text: `🔶 정답지를 「${lookup.how}」로 붙였습니다 — ${lookup.why ?? ""} 다른 시험의 정답지가 아닌지 확인하십시오.`,
      },
    ];
  }
  if (!lookup.ambiguous.length) return [];
  const names = lookup.ambiguous.map((a) => `「${a.title}」`).join(", ");
  return [
    {
      level: "info",
      text:
        `정답지 ${names}가 비슷해 어느 것인지 정하지 못했습니다. ` +
        "엉뚱한 정답으로 채점하지 않으려고 하나도 안 썼습니다 — 정답지 화면에서 시험 제목을 답안지와 같게 고쳐 등록하면 채점됩니다.",
    },
  ];
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
