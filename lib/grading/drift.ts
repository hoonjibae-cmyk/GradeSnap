import { hasHangul, norm, numKey } from "./text";
import type { Item, Transcript, Warning } from "./types";

/**
 * 행 밀림 검증 — **이 방식의 유일한 치명적 실패 모드입니다.**
 *
 * 무응답 칸을 건너뛰고 다음 답을 당겨 읽으면 아래가 전부 어긋나고,
 * 조용히 그럴듯한 점수가 나옵니다. 좌표가 없으므로 **인쇄된 글자**로 검증합니다.
 *
 * 다섯 가지 중 앞의 넷은 사람 입력이 전혀 필요 없습니다.
 * `tools/grade_page.py`의 `check_drift`를 옮긴 것입니다.
 */
export function checkDrift(t: Transcript, key?: { no: string; prompt: string }[]): Warning[] {
  const warn: Warning[] = [];
  const drift = (text: string) => warn.push({ level: "drift", text });
  // 시험지 구조에 대한 사실 안내. 밀림이 아니므로 판정에 넣지 않습니다.
  const info = (text: string) => warn.push({ level: "info", text });

  const items = t.items ?? [];

  // 번호는 **인쇄된 문자열 그대로** 비교합니다. 숫자만 뽑아 비교하면
  // 절이 나뉜 시험지에서 '1'과 '1)'이 같은 번호가 돼 없는 중복을 만듭니다.
  const nos = items.map((i) => String(i.no).trim());
  const dup = [...new Set(nos.filter((x, _, a) => a.filter((y) => y === x).length > 1))].sort();
  if (dup.length) {
    drift(`문항 번호가 중복됩니다: ${dup.slice(0, 10).join(", ")}${dup.length > 10 ? " …" : ""}`);
  }

  // 번호가 도로 작아지면 새 절이 시작된 것으로 봅니다.
  const secs = sections(nos.map(numKey));
  if (secs.length > 1) {
    info(`번호 묶음이 ${secs.length}개입니다 — 절이 나뉜 시험지로 보고 연속성은 묶음 안에서만 검사합니다.`);
  }
  secs.forEach((seq, k) => {
    const real = seq.filter((n) => n < Number.MAX_SAFE_INTEGER);
    if (!real.length) return;
    const present = new Set(real);
    const missing: number[] = [];
    for (let n = Math.min(...real); n <= Math.max(...real); n++) if (!present.has(n)) missing.push(n);
    if (missing.length) {
      drift(
        `${k + 1}번째 묶음의 번호가 비었습니다: ${missing.slice(0, 15).join(", ")}` +
          (missing.length > 15 ? " …" : ""),
      );
    }
  });

  const total = t.sheet?.printedTotal || 0;
  if (total && total !== items.length) {
    drift(`인쇄된 문항 수 ${total} ≠ 전사 ${items.length} — 밀렸거나 빠졌습니다.`);
  }

  if (key?.length) {
    const known = new Map(key.map((k) => [String(k.no), k.prompt ?? ""]));
    const bad = items
      .filter((i) => known.get(i.no) && norm(known.get(i.no)) !== norm(i.prompt))
      .map((i) => i.no);
    if (bad.length) {
      drift(`제시어가 정답표와 다릅니다(밀림 의심): ${bad.slice(0, 15).join(", ")}${bad.length > 15 ? " …" : ""}`);
    }
  }

  const empty = items.filter((i) => !(i.prompt ?? "").trim()).length;
  if (empty) info(`제시어가 비어 있는 문항 ${empty}개 — 밀림 검증이 그만큼 약해집니다.`);

  for (const text of [...checkPrefix(items), ...checkLanguage(items)]) drift(text);
  return warn;
}

/** 번호가 줄어드는 지점에서 끊어 절 목록을 만듭니다. */
function sections(nums: number[]): number[][] {
  const secs: number[][] = [];
  let cur: number[] = [];
  for (const n of nums) {
    if (cur.length && n <= cur[cur.length - 1]) {
      secs.push(cur);
      cur = [];
    }
    cur.push(n);
  }
  if (cur.length) secs.push(cur);
  return secs;
}

/**
 * 첫 글자가 인쇄된 문항은 학생 답이 그 글자로 시작해야 합니다.
 *
 * 사람 입력도 정답표도 필요 없습니다. 답이 한 줄 밀리면 38번의 prefix 'p' 자리에
 * 39번 답 'victim'이 들어와 즉시 어긋납니다.
 */
function checkPrefix(items: Item[]): string[] {
  const bad = items
    .filter((i) => {
      const p = (i.prefix ?? "").trim();
      const w = (i.written ?? "").trim();
      return p && w && !w.toLowerCase().startsWith(p.toLowerCase());
    })
    .map((i) => i.no);
  if (!bad.length) return [];
  return [`인쇄된 첫 글자와 답이 안 맞습니다(밀림 의심): ${bad.slice(0, 15).join(", ")}${bad.length > 15 ? " …" : ""}`];
}

/**
 * 출제 방향과 답의 언어가 맞아야 합니다.
 *
 * 한 시험지에 '영어→한글'과 '한글→영어'가 섞여 있는 경우가 많은데,
 * 그 경계를 넘어 밀리면 ko2en 칸에 한글 답이 들어옵니다.
 */
function checkLanguage(items: Item[]): string[] {
  const bad: string[] = [];
  for (const i of items) {
    const w = (i.written ?? "").trim();
    if (w.length < 2) continue;
    const han = hasHangul(w);
    if (i.direction === "ko2en" && han) bad.push(`${i.no}(한글)`);
    else if (i.direction === "en2ko" && !han && /^[\x00-\x7F]*$/.test(w)) bad.push(`${i.no}(영문)`);
  }
  if (!bad.length) return [];
  return [`출제 방향과 답의 언어가 다릅니다(밀림 의심): ${bad.slice(0, 15).join(", ")}${bad.length > 15 ? " …" : ""}`];
}

/** 구조 안내(info)는 밀림이 아닙니다. 판정에는 drift만 넣습니다. */
export function hasDrift(warn: Warning[] | null | undefined): boolean {
  return (warn ?? []).some((w) => w.level === "drift");
}
