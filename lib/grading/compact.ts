/**
 * 출력 토큰 줄이기 — **뜻은 그대로, 글자만 줄입니다.**
 *
 * 비용의 70%가 출력입니다([12 §12.2](../../docs/12-page-level-grading.md)).
 * 그런데 문항 하나가 뱉는 JSON을 세어 보면
 *
 * ```
 * {"no":"31","prompt":"자주 일어나는","direction":"ko2en","prefix":"f",
 *  "written":"frequent","blank":false,"legible":true,"erased":false,"confidence":0.95}
 *                                                             146자 중 85자(58%)가 필드 이름
 * ```
 *
 * **필드 이름은 아무 정보도 안 나릅니다.** 50문항이면 그것만 4,000자를
 * 다시 사는 셈입니다. 뜻은 스키마의 `description`이 이미 나르고 있고,
 * 구조화 출력이 모양을 강제하므로 이름은 짧아도 됩니다.
 *
 * 🔴 **다만 이건 재봐야 하는 변경입니다.** 모델이 글을 쓰면서 생각하는
 * 부분이 있어, 이름이 짧아지면 읽기가 나빠질 **수도** 있습니다. 그래서
 * `/bench`에 축을 하나 더 두고 모델을 재던 방식 그대로 잽니다 —
 * 잡음 바닥과 구별되지 않으면 그때 기본값을 옮깁니다.
 *
 * 스키마를 두 벌 적지 않습니다. **한 벌에서 이름만 바꿔 만듭니다** —
 * 두 벌이면 언젠가 갈리고, 갈리면 비교가 조건이 다른 것을 재게 됩니다.
 */

/**
 * 문항 하나의 필드 이름 → 짧은 이름.
 *
 * 머리말(`sheet`)은 답안지당 한 번뿐이라 안 건드립니다. 아끼는 것은 없고
 * 틀릴 자리만 늘어납니다. **50번 반복되는 것만 줄입니다.**
 */
export const ITEM_KEYS = {
  no: "n",
  prompt: "p",
  direction: "d",
  prefix: "x",
  written: "w",
  blank: "b",
  legible: "l",
  erased: "e",
} as const;

/** 판정 결과도 문항마다 하나씩 나옵니다. */
export const RESULT_KEYS = {
  no: "n",
  correct: "c",
  expected: "x",
  note: "m",
} as const;

export type KeyMap = Record<string, string>;

/**
 * 스키마의 `properties` 이름을 바꿉니다. `required` 순서와 설명은 그대로입니다.
 *
 * `drop`에 적은 필드는 아예 뺍니다.
 */
export function renameProps(schema: unknown, map: KeyMap, drop: string[] = []): Record<string, unknown> {
  const s = schema as { properties: Record<string, unknown>; required: string[] };
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.properties)) {
    if (drop.includes(k)) continue;
    properties[map[k] ?? k] = v;
  }
  return {
    ...(schema as object),
    properties,
    required: s.required.filter((k) => !drop.includes(k)).map((k) => map[k] ?? k),
  };
}

/** 짧은 이름으로 돌아온 객체를 원래 이름으로 되돌립니다. 없는 칸은 없는 채로. */
export function expand<T>(row: Record<string, unknown>, map: KeyMap): T {
  const out: Record<string, unknown> = {};
  for (const [full, short] of Object.entries(map)) {
    if (short in row) out[full] = row[short];
  }
  return out as T;
}

/**
 * 전사 스키마의 압축판.
 *
 * `confidence`를 뺍니다. 문항마다 18자를 쓰는데 **쓰는 곳이 한 군데뿐**이고
 * (양면 사진이 겹쳤을 때 어느 쪽을 남길지), 그마저 [12 §12.13](../../docs/12-page-level-grading.md)에서
 * **고쳐 읽기를 못 잡는다는 것이 확인된** 값입니다. 모델은 고쳐 읽으면서
 * 0.90·0.93으로 확신에 차 있었습니다. 값을 치르고 살 이유가 없습니다.
 */
export function compactTranscribeSchema(full: unknown): Record<string, unknown> {
  const s = full as { properties: { items: { items: unknown } } };
  return {
    ...(full as object),
    properties: {
      ...(full as { properties: object }).properties,
      items: {
        ...(s.properties.items as object),
        items: renameProps(s.properties.items.items, ITEM_KEYS, ["confidence"]),
      },
    },
  };
}

export function compactJudgeSchema(full: unknown): Record<string, unknown> {
  const s = full as { properties: { results: { items: unknown } } };
  return {
    ...(full as object),
    properties: {
      results: {
        ...(s.properties.results as object),
        items: renameProps(s.properties.results.items, RESULT_KEYS),
      },
    },
  };
}
