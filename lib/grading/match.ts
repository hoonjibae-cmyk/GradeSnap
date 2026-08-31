/**
 * **어느 정답지가 이 답안지의 것인가** — 보조 경로(docs/13 §13.45).
 *
 * 지금까지는 제목이 **글자 하나까지 같아야** 정답지가 붙었습니다(`keySlug`).
 * 정답지를 사람이 찍어 올리던 동안에는 그럭저럭 버텼습니다. 화면에 제목
 * 칸이 있었고, 안 맞으면 사람이 고쳐 적었으니까요.
 *
 * 구글 폴더에서 정답지를 가져오기 시작하면 그 손이 없어집니다. 제목은
 * **선생님이 인쇄한 머리글**에서 오고, 답안지 제목은 **AI가 사진에서 읽은
 * 글자**에서 옵니다. 둘이 늘 같을 수는 없습니다 —
 *
 *   `M4 워드마스터 중등실력 "Unit 33-34`   (정답지 PDF 머리글)
 *   `M4 워드마스터 중등실력 Unit 33-34`    (답안지 사진에서 읽은 것)
 *
 * 따옴표 하나 때문에 등록해 둔 정답지가 조용히 무시되고, 그 반 전체가
 * "정답 모름"으로 넘어갑니다. 사람은 이유를 모릅니다.
 *
 * ---
 *
 * ## 세 겹입니다
 *
 *   1. **제목**       정규화한 제목이 똑같다. 지금까지의 그 경로입니다.
 *   2. **제목 근사**  글자가 거의 같고 **숫자가 어긋나지 않는다**.
 *   3. **문항**       제목은 못 맞췄지만 **제시어가 겹친다**.
 *
 * ## 🔴 무엇을 막으려고 만든 장치인가
 *
 * 이 파일에서 위험한 것은 "못 찾는 것"이 아닙니다. 못 찾으면 지금까지처럼
 * 사람이 직접 채점하면 됩니다. **위험한 것은 엉뚱한 정답지를 찾는 것입니다.**
 * 그러면 반 전체가 남의 정답으로 채점되고, 화면에는 아무 경고도 안 뜹니다.
 *
 * 시험 제목은 보통 **숫자 하나만 다릅니다.**
 *
 *   `0804 워드마스터 Unit 33-34`
 *   `0804 워드마스터 Unit 35-36`
 *
 * 글자로만 보면 90% 같습니다. 그래서 세 가지를 겁니다.
 *
 *   - **숫자를 점수에 넣습니다.** 글자 55% + 숫자 45%. 위 두 제목은 글자가
 *     아무리 닮아도 숫자가 1/5만 겹쳐 문턱을 못 넘습니다.
 *   - **숫자가 하나도 안 겹치면 즉시 탈락**입니다. 점수와 무관합니다.
 *   - **2등과 충분히 벌어져야 합니다.** 둘이 비슷하면 **아무것도 안 고릅니다** —
 *     대신 그 후보들을 이름으로 돌려줘, 화면이 "이 둘 중 어느 것인지 모르겠다"
 *     고 말할 수 있게 합니다. 사람이 제목을 고치면 끝나는 일입니다.
 *
 * 그리고 1번이 아닌 경로로 붙은 정답지는 **화면에 그렇게 적습니다**
 * (`pipeline.ts`). 조용히 맞히는 것보다 시끄럽게 맞히는 편이 낫습니다.
 */

import { norm } from "./text";

export type MatchHow = "제목" | "제목 근사" | "문항";

/** 등록된 정답지 한 장. `prompt`는 있을 수도 없을 수도 있습니다. */
export interface KeyCandidate {
  slug: string;
  title: string;
  items: { no: string; expected: string; prompt?: string }[];
}

/** 맞춰 볼 답안지. 전사 결과에서 필요한 것만 뽑은 모양입니다. */
export interface SheetShape {
  title: string;
  items: { no: string; prompt: string }[];
}

export interface KeyMatch {
  key: KeyCandidate;
  how: MatchHow;
  /** 0~1. 1은 제목이 똑같다는 뜻입니다. */
  score: number;
  /** 2등 점수. **왜 이걸 골랐는지의 근거**라서 같이 나릅니다. */
  runnerUp: number;
  /** 사람이 읽을 한 줄. 화면에 그대로 씁니다. */
  why: string;
}

export interface MatchOutcome {
  match: KeyMatch | null;
  /**
   * 비슷해서 **못 고른** 후보들. 비어 있지 않으면 정답지가 있기는 한데
   * 어느 것인지 못 정했다는 뜻입니다 — 사람에게 그렇게 말해야 합니다.
   */
  ambiguous: { title: string; score: number }[];
}

// ---------------------------------------------------------------------------
// 문턱값. 전부 여기 모아 둡니다 — 바꿀 때 코드를 뒤지지 않게.
// ---------------------------------------------------------------------------

/** 제목 근사가 성립하는 최소 점수. */
const TITLE_MIN = 0.6;
/** 제목 근사에서 2등과 벌어져야 하는 최소 간격. */
const TITLE_MARGIN = 0.1;
/** 문항 겹침이 성립하는 최소 비율. */
const ITEM_MIN = 0.7;
/** 문항 겹침에서 2등과 벌어져야 하는 최소 간격. */
const ITEM_MARGIN = 0.15;
/**
 * 문항 겹침에 필요한 **절대 개수**.
 *
 * 비율만 보면 3문항짜리 쪽지시험이 우연히 100%로 붙습니다. 제시어가 다섯 개
 * 넘게 같으면 그건 우연이 아닙니다.
 */
const ITEM_MIN_COUNT = 5;

// ---------------------------------------------------------------------------
// 재료
// ---------------------------------------------------------------------------

/** 글자 2연쇄. 한국어는 낱말 자르기가 어려워 글자로 봅니다. */
export function bigrams(s: string): Set<string> {
  // 공백을 지웁니다 — 'unit 33'과 'unit33'은 같은 시험입니다.
  const t = norm(s).replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  if (!out.size && t) out.add(t);
  return out;
}

export function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return (2 * hit) / (a.size + b.size);
}

/**
 * 제목에 박힌 숫자들. **시험을 가르는 것은 대개 이것뿐입니다.**
 *
 * `Unit 33-34` → [33, 34]. `M4 ... 0804` → [4, 804, ...].
 * 앞의 0은 떼고 봅니다 — `0804`와 `804`는 같은 날입니다.
 *
 * **다섯 자리 넘는 숫자는 버립니다.** 단원도 과도 날짜도 그렇게 길지
 * 않습니다 — `08040805워드마스터unit33-34`처럼 구분 기호 없이 붙여 쓴
 * 파일 이름에서만 나오는 덩어리이고, 시험을 가르는 데 아무 도움이 안
 * 되면서 겹치는 숫자의 비율만 깎아 멀쩡한 정답지를 떨어뜨립니다.
 */
const MAX_DIGITS = 4;

export function numbers(s: string): Set<number> {
  const out = new Set<number>();
  for (const m of norm(s).matchAll(/\d+/g)) {
    if (m[0].length > MAX_DIGITS) continue;
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / (a.size + b.size - hit);
}

/**
 * 제목 두 개가 얼마나 같은가. 0~1.
 *
 * 숫자가 양쪽에 다 있는데 **하나도 안 겹치면 0**입니다. `Unit 33-34`와
 * `Unit 35-36`은 글자가 아무리 닮아도 다른 시험입니다.
 */
export function titleScore(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const letters = dice(bigrams(na), bigrams(nb));
  const da = numbers(na);
  const db = numbers(nb);

  // 한쪽에 숫자가 없으면 숫자로 가를 근거가 없습니다. 글자만 봅니다.
  if (!da.size || !db.size) return letters;

  const shared = [...da].some((x) => db.has(x));
  if (!shared) return 0; // 🔴 즉시 탈락

  return 0.55 * letters + 0.45 * jaccard(da, db);
}

/** 제시어가 몇 개나 같은가. `{ ratio, count }`. */
export function itemScore(sheet: SheetShape, key: KeyCandidate): { ratio: number; count: number } {
  const a = new Set(sheet.items.map((i) => norm(i.prompt)).filter(Boolean));
  const b = new Set(key.items.map((i) => norm(i.prompt ?? "")).filter(Boolean));
  if (!a.size || !b.size) return { ratio: 0, count: 0 };
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return { ratio: hit / Math.min(a.size, b.size), count: hit };
}

// ---------------------------------------------------------------------------
// 본체
// ---------------------------------------------------------------------------

interface Scored {
  key: KeyCandidate;
  title: number;
  item: number;
  itemCount: number;
}

/**
 * 이 답안지에 맞는 정답지를 고릅니다. **확신이 없으면 안 고릅니다.**
 *
 * 못 고르는 것은 실패가 아닙니다 — 지금까지처럼 사람이 채점할 뿐입니다.
 * 잘못 고르는 것이 실패입니다.
 */
export function matchAnswerKey(sheet: SheetShape, keys: KeyCandidate[]): MatchOutcome {
  const none: MatchOutcome = { match: null, ambiguous: [] };
  if (!keys.length) return none;

  const slug = norm(sheet.title);

  // ① 제목이 똑같다. 여기서 끝나는 것이 대부분입니다.
  if (slug) {
    const exact = keys.find((k) => k.slug === slug || norm(k.title) === slug);
    if (exact) {
      return {
        match: { key: exact, how: "제목", score: 1, runnerUp: 0, why: `제목이 「${exact.title}」과 같습니다.` },
        ambiguous: [],
      };
    }
  }

  const scored: Scored[] = keys.map((k) => {
    const it = itemScore(sheet, k);
    return { key: k, title: titleScore(sheet.title, k.title), item: it.ratio, itemCount: it.count };
  });

  // ② 제목 근사.
  const byTitle = [...scored].sort((x, y) => y.title - x.title);
  const t1 = byTitle[0];
  const t2 = byTitle[1];
  const titleOk =
    !!t1 && t1.title >= TITLE_MIN && (!t2 || t1.title - t2.title >= TITLE_MARGIN);

  // ③ 문항 겹침.
  const byItem = [...scored].sort((x, y) => y.item - x.item);
  const i1 = byItem[0];
  const i2 = byItem[1];
  const itemOk =
    !!i1 &&
    i1.item >= ITEM_MIN &&
    i1.itemCount >= ITEM_MIN_COUNT &&
    (!i2 || i1.item - i2.item >= ITEM_MARGIN);

  /*
    🔴 **두 경로가 서로 다른 정답지를 가리키면 아무것도 안 고릅니다.**

    제목은 A를, 제시어는 B를 가리키는 상황은 둘 중 하나가 틀렸다는 뜻입니다.
    어느 쪽이 틀렸는지 여기서는 알 수 없고, 반반 확률로 반 전체를 남의
    정답으로 채점하느니 사람에게 넘깁니다.
  */
  if (titleOk && itemOk && t1.key.slug !== i1.key.slug) {
    return {
      match: null,
      ambiguous: [
        { title: t1.key.title, score: round(t1.title) },
        { title: i1.key.title, score: round(i1.item) },
      ],
    };
  }

  // 제시어가 겹치는 것이 더 센 증거입니다 — 제목은 사진에서 읽은 글자 몇 자,
  // 제시어는 문항 수십 개입니다.
  if (itemOk) {
    return {
      match: {
        key: i1.key,
        how: "문항",
        score: round(i1.item),
        runnerUp: round(i2?.item ?? 0),
        why: `제목은 못 맞췄지만 제시어 ${i1.itemCount}개가 「${i1.key.title}」과 같습니다.`,
      },
      ambiguous: [],
    };
  }

  if (titleOk) {
    return {
      match: {
        key: t1.key,
        how: "제목 근사",
        score: round(t1.title),
        runnerUp: round(t2?.title ?? 0),
        why: `제목이 「${t1.key.title}」과 비슷합니다 (${Math.round(t1.title * 100)}%).`,
      },
      ambiguous: [],
    };
  }

  /*
    못 골랐습니다. 그런데 **아깝게 못 고른 것**과 **아예 없는 것**은 사람이
    할 일이 다릅니다. 앞의 경우는 제목 한 줄만 고치면 끝납니다. 그래서
    문턱 근처까지 온 후보를 이름으로 돌려줍니다.
  */
  const near = byTitle
    .filter((s) => s.title >= TITLE_MIN)
    .slice(0, 3)
    .map((s) => ({ title: s.key.title, score: round(s.title) }));
  return { match: null, ambiguous: near };
}

const round = (n: number) => Math.round(n * 100) / 100;
