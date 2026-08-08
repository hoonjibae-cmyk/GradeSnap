import type { SheetRow, WrongItemRow } from "@/lib/db/schema";

/**
 * 명단을 만드는 규칙과, 그것을 붙여넣을 수 있는 글로 바꾸는 일.
 *
 * 화면에서 떼어놓은 이유는 **여기가 틀리면 학생이 잘못 남기 때문**입니다.
 * 특히 "아직 확정 안 된 것"을 어느 칸에 넣느냐가 그렇습니다.
 */

export interface Split {
  /** 확정된 FAIL. **이 사람들만 재시험입니다.** */
  retest: SheetRow[];
  /** 확정된 PASS */
  passed: SheetRow[];
  /**
   * 아직 확정 안 된 것 — 채점 중이든, 검수 대기든, 실패든.
   *
   * **통과로도 재시험으로도 세지 않습니다.** 여기 사람이 남아 있으면
   * 명단은 아직 완성이 아니고, 화면이 그렇게 말해야 합니다.
   */
  pending: SheetRow[];
}

export function splitRoster(sheets: SheetRow[]): Split {
  const retest: SheetRow[] = [];
  const passed: SheetRow[] = [];
  const pending: SheetRow[] = [];
  for (const s of sheets) {
    if (s.status !== "confirmed") pending.push(s);
    else if (s.final_verdict === "fail") retest.push(s);
    else if (s.final_verdict === "pass") passed.push(s);
    else pending.push(s); // 확정인데 판정이 없다 — 있을 수 없지만 통과로 세지 않습니다.
  }
  return { retest, passed, pending };
}

/** 반별로 묶습니다. 반을 안 적은 것은 하나로 모읍니다. */
export function byClass(sheets: SheetRow[]): [string, SheetRow[]][] {
  const m = new Map<string, SheetRow[]>();
  for (const s of sheets) {
    const k = s.class_name.trim() || "반 없음";
    (m.get(k) ?? m.set(k, []).get(k)!).push(s);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "ko"));
}

const name = (s: SheetRow) => s.student_name.trim() || "(이름 못 읽음)";

/** 칠판에 적거나 메신저에 붙일 재시험 명단. */
export function retestText(day: string, retest: SheetRow[], pending: number): string {
  const lines = [`${day} 재시험 명단 (${retest.length}명)`];
  for (const [cls, rows] of byClass(retest)) {
    lines.push("", cls, rows.map(name).join(", "));
  }
  if (!retest.length) lines.push("", "없음");
  // 덜 끝난 게 있으면 **명단 안에** 적습니다. 붙여넣고 나면 화면 경고는 안 따라갑니다.
  if (pending) lines.push("", `※ 아직 확정되지 않은 답안지 ${pending}장이 있습니다. 명단이 늘어날 수 있습니다.`);
  return lines.join("\n");
}

/** 학생별 오답 목록. 오답노트·재시험지의 재료입니다. */
export function wrongText(day: string, items: WrongItemRow[]): string {
  const bySheet = new Map<string, WrongItemRow[]>();
  for (const it of items) (bySheet.get(it.sheet_id) ?? bySheet.set(it.sheet_id, []).get(it.sheet_id)!).push(it);

  const lines = [`${day} 오답 목록`];
  for (const rows of bySheet.values()) {
    const h = rows[0];
    lines.push("", `${h.student_name || "(이름 못 읽음)"}${h.title ? ` — ${h.title}` : ""} (${rows.length}개)`);
    for (const r of rows) {
      // 제시어 → 학생이 쓴 것 → 정답. 무응답도 적습니다. 빈칸으로 두면 왜 틀렸는지 안 보입니다.
      lines.push(`  ${r.no}. ${r.prompt} → ${r.written.trim() || "(무응답)"}${r.expected ? ` (정답: ${r.expected})` : ""}`);
    }
  }
  if (bySheet.size === 0) lines.push("", "없음");
  return lines.join("\n");
}
