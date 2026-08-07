#!/usr/bin/env python3
"""
⏸ 보류 — 좌표·crop 기반 설계의 도구입니다.
   docs/12-page-level-grading.md 로 설계가 바뀌면서 쓰지 않습니다.
   지우지 않고 남겨 둡니다. 되돌릴 경우를 대비한 기록입니다.

문법 백지 TEST 전수 진단 — 숨은 정답 / 정답지 차분 중 나은 쪽을 택한다."""
import os, re, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fitz
from extract_hidden import extract as extract_hidden
from pdf_diff_key import extract_words, diff_answers

CH = re.compile(r"[Cc]h\s*\.?\s*_?\s*(\d{1,2})")
root = sys.argv[1]
rows = []

for lvl in sorted(os.listdir(root)):
    base = os.path.join(root, lvl, "pdf")
    ex_dir, key_dir = os.path.join(base, "시험지"), os.path.join(base, "정답지")
    if not os.path.isdir(ex_dir): continue
    keys = {}
    if os.path.isdir(key_dir):
        for f in os.listdir(key_dir):
            m = CH.search(f)
            if m and f.lower().endswith(".pdf"): keys.setdefault(int(m.group(1)), os.path.join(key_dir, f))

    for f in sorted(os.listdir(ex_dir), key=lambda x: (int(CH.search(x).group(1)) if CH.search(x) else 99)):
        if not f.lower().endswith(".pdf"): continue
        m = CH.search(f)
        ch = int(m.group(1)) if m else 0
        ep = os.path.join(ex_dir, f)
        n_hid = n_diff = 0
        try:
            n_hid = len(extract_hidden(ep)[0])
        except Exception: pass
        kp = keys.get(ch)
        if kp:
            try: n_diff = len(diff_answers(extract_words(ep), extract_words(kp)))
            except Exception: pass

        n, method = (n_hid, "숨은정답") if n_hid >= n_diff else (n_diff, "정답지차분")
        if n >= 25:   v, mins = "완전자동", 2
        elif n >= 10: v, mins = "대부분자동", 5
        elif n >= 1:  v, mins = "일부만", 12
        else:         v, mins, method = "수동", 20, "—"
        rows.append({"level": lvl, "ch": ch, "file": f, "hidden": n_hid,
                     "diff": n_diff, "n": n, "method": method, "verdict": v, "min": mins})

print(f"{'레벨':<11}{'ch':>3}{'숨은':>6}{'차분':>6}{'채택':>6} {'방식':<12}{'판정':<12}{'예상':>5}  파일")
print("-"*96)
for r in rows:
    print(f"{r['level']:<11}{r['ch']:>3}{r['hidden']:>6}{r['diff']:>6}{r['n']:>6} "
          f"{r['method']:<12}{r['verdict']:<12}{r['min']:>3}분  {r['file'][:30]}")

from collections import Counter
print("\n"+"="*96)
print("판정:", dict(Counter(r["verdict"] for r in rows)))
print("방식:", dict(Counter(r["method"] for r in rows)))
by = {}
for r in rows: by.setdefault(r["level"], []).append(r)
print(f"\n{'레벨':<11}{'유닛':>5}{'완전자동':>8}{'대부분':>7}{'일부':>6}{'수동':>6}{'정답합':>8}{'예상(분)':>9}")
for lv, rs in by.items():
    c = Counter(x["verdict"] for x in rs)
    print(f"{lv:<11}{len(rs):>5}{c['완전자동']:>8}{c['대부분자동']:>7}{c['일부만']:>6}{c['수동']:>6}"
          f"{sum(x['n'] for x in rs):>8}{sum(x['min'] for x in rs):>9}")
tot, ans = sum(r["min"] for r in rows), sum(r["n"] for r in rows)
print(f"\n총 {len(rows)}유닛 · 정답 {ans}개 · 예상 {tot}분 ({tot/60:.1f}시간)")
json.dump(rows, open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"out_combined.json"),"w"), ensure_ascii=False, indent=1)
