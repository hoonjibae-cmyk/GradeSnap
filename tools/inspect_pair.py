#!/usr/bin/env python3
"""
GradeSnap · 벤치마크 원자료 들여다보기

`run_bench.py`가 남긴 `bench/pairNN.json`에서 **필요한 문항만** 꺼내 봅니다.
원자료에는 학생 실명이 들어 있으므로 **이름은 항상 지우고 출력합니다.**
여기 출력된 것만 공유하십시오.

사용법
    # 특정 문항 — 전사와 판정을 나란히
    python3 tools/inspect_pair.py bench/pair06.json --items 10,19

    # 첫 글자가 인쇄된 문항 전부 — '고쳐 읽기'가 일어났는지 보는 자리
    python3 tools/inspect_pair.py bench/pair06.json --prefix

    # 선생님과 어긋난 문항 전부
    python3 tools/inspect_pair.py bench/pair03.json --disagree

    # 마크 판독이 무엇을 어떻게 읽었는지
    python3 tools/inspect_pair.py bench/pair03.json --marks
"""

import argparse
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as f:
        r = json.load(f)
    if r.get("error"):
        sys.exit(f"이 쌍은 실행이 실패했습니다: {r['error'][:200]}")
    return r


def head(r):
    s = r.get("sheet") or {}
    # 학생 이름은 절대 찍지 않습니다.
    print(f"{s.get('title','?')}  ·  {s.get('teacher','?')}  ·  {s.get('cut_line','')}")
    print(f"문항 {r.get('n_items','?')}개")
    for w in r.get("warn") or []:
        print(f"⚠️  {w}")
    print()


def rows(r, items):
    judged = {j["no"]: j for j in (r.get("judged") or {}).get("results", [])}
    print("| 번호 | 제시어 | 인쇄 첫글자 | 학생이 쓴 것 | 빈칸 | 판독 | 확신 | 판정 | 기대 | 비고 |")
    print("|---|---|:--:|---|:--:|:--:|--:|:--:|---|---|")
    for it in items:
        j = judged.get(it["no"], {})
        print(f"| {it['no']} | {it.get('prompt','')} | {it.get('prefix','') or '–'} "
              f"| **{it.get('written','')}** | {'✓' if it.get('blank') else ''} "
              f"| {'' if it.get('legible', True) else '불가'} "
              f"| {it.get('confidence', 0):.2f} "
              f"| {'○' if j.get('correct') else '✗'} | {j.get('expected','')} "
              f"| {j.get('note','')} |")


def main():
    ap = argparse.ArgumentParser(description="벤치마크 원자료에서 문항을 꺼내 본다")
    ap.add_argument("path", help="bench/pairNN.json")
    ap.add_argument("--items", help="쉼표로 구분한 문항 번호. 예: 10,19")
    ap.add_argument("--prefix", action="store_true",
                    help="첫 글자가 인쇄된 문항 전부 — 고쳐 읽기 확인용")
    ap.add_argument("--disagree", action="store_true", help="선생님과 어긋난 문항 전부")
    ap.add_argument("--marks", action="store_true", help="마크 판독 결과")
    a = ap.parse_args()

    r = load(a.path)
    items = (r.get("transcript") or {}).get("items", [])
    head(r)

    if a.marks:
        m = r.get("marks") or {}
        conv = m.get("convention") or {}
        print(f"채점함 표시 : {conv.get('check_mark','')}")
        print(f"오답 표시   : {conv.get('wrong_mark','')}")
        print(f"근거        : {conv.get('reasoning','')}")
        print(f"\n읽어낸 오답 ({len(m.get('wrong') or [])}개): {', '.join(m.get('wrong') or []) or '없음'}")
        print(f"선생님 표기 : {m.get('score_text') or '없음'} · {m.get('pass_fail','')}")
        print(f"확신도      : {m.get('confidence', 0):.2f}")
        um = (r.get("compare") or {}).get("unmatched_marks") or []
        if um:
            print(f"\n⚠️  전사 문항에 붙일 수 없는 마크 {len(um)}개: {um}")
        return

    if a.items:
        want = {x.strip() for x in a.items.split(",") if x.strip()}
        sel = [i for i in items if i["no"] in want]
        missing = want - {i["no"] for i in sel}
        if missing:
            print(f"⚠️  전사에 없는 번호: {', '.join(sorted(missing))}\n")
    elif a.prefix:
        sel = [i for i in items if (i.get("prefix") or "").strip()]
        print(f"첫 글자가 인쇄된 문항 {len(sel)}개 — "
              f"학생이 쓴 것이 **철자 오류까지 그대로 남았는지** 보십시오.\n")
    elif a.disagree:
        c = r.get("compare") or {}
        want = set(c.get("ours_only") or []) | set(c.get("theirs_only") or [])
        sel = [i for i in items if i["no"] in want]
        print(f"우리만 오답 {c.get('ours_only')} · 놓친 오답 {c.get('theirs_only')}\n")
    else:
        sys.exit("--items / --prefix / --disagree / --marks 중 하나를 고르십시오.")

    if not sel:
        print("해당하는 문항이 없습니다.")
        return
    rows(r, sel)
    print("\n※ 학생 이름은 출력하지 않습니다. 여기 나온 표만 공유하십시오.")


if __name__ == "__main__":
    main()
