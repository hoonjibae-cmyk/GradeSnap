#!/usr/bin/env python3
"""문법 백지 TEST 세트 → exam_template JSON 일괄 생성.

빈칸(칸) 하나를 문항 하나로 만든다. 이 학원의 컷트라인이 '-12칸'처럼
빈칸 개수 기준이므로 채점 단위가 곧 빈칸이다.
"""
import os, re, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_hidden import extract as extract_hidden
from pdf_diff_key import extract_words, diff_answers
import fitz

CH = re.compile(r"[Cc]h\s*\.?\s*_?\s*(\d{1,2})")
TITLE = re.compile(r"[Cc]h\s*\.?\s*_?\s*\d{1,2}\.?\s*(.*?)(?:\s*시험지)?\.pdf$")


def slug(level, ch):
    lv = level.replace(" ", "").replace("Level", "L")
    return f"BJ-{lv}-CH{ch:02d}"


def build(exam_path, key_path, level, ch, title):
    hidden, pages = extract_hidden(exam_path)
    diff = []
    if key_path:
        try:
            diff = diff_answers(extract_words(exam_path), extract_words(key_path))
        except Exception:
            pass
    items, method = (hidden, "hidden_white") if len(hidden) >= len(diff) else (diff, "answer_diff")

    doc = fitz.open(exam_path)
    return {
        "code": slug(level, ch),
        "name": f"문법백지TEST {level} Ch{ch}. {title}",
        "version": 1,
        "class": "fixed_set",
        "source_pdf": os.path.basename(exam_path),
        "extraction": {"method": method,
                       "hidden_count": len(hidden), "diff_count": len(diff)},
        "pass_rule": {"type": "max_wrong", "value": None,
                      "note": "시험지에 인쇄된 '커트 라인 -N칸' 값을 입력하세요"},
        "pages": [{"page_no": i, "width_pt": round(p.rect.width, 1),
                   "height_pt": round(p.rect.height, 1)} for i, p in enumerate(doc, 1)],
        "questions": [
            {"number": str(i), "type": "short_answer", "points": 1,
             "page_no": a["page"], "grading_unit": "question",
             "regions": [{"label": "blank", "kind": "handwriting", "bbox": a["bbox"]}],
             "key": {"canonical": a["answer"], "accepted": [],
                     "match_options": {"ignore_space": True, "allow_typo_distance": 0}}}
            for i, a in enumerate(items, 1)
        ],
    }


root, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
made, total_q = [], 0

for level in sorted(os.listdir(root)):
    base = os.path.join(root, level, "pdf")
    ex_dir, key_dir = os.path.join(base, "시험지"), os.path.join(base, "정답지")
    if not os.path.isdir(ex_dir):
        continue
    keys = {}
    if os.path.isdir(key_dir):
        for f in os.listdir(key_dir):
            m = CH.search(f)
            if m and f.lower().endswith(".pdf"):
                keys.setdefault(int(m.group(1)), os.path.join(key_dir, f))

    for f in sorted(os.listdir(ex_dir)):
        if not f.lower().endswith(".pdf"):
            continue
        m = CH.search(f)
        if not m:
            continue
        ch = int(m.group(1))
        tm = TITLE.search(f)
        title = (tm.group(1).strip() if tm else "").strip(". ")
        t = build(os.path.join(ex_dir, f), keys.get(ch), level, ch, title)
        with open(os.path.join(outdir, t["code"] + ".json"), "w", encoding="utf-8") as fh:
            json.dump(t, fh, ensure_ascii=False, indent=1)
        made.append(t); total_q += len(t["questions"])

print(f"{'code':<16}{'문항':>5}{'방식':>14}  이름")
print("-" * 78)
for t in made:
    print(f"{t['code']:<16}{len(t['questions']):>5}{t['extraction']['method']:>14}  {t['name'][:40]}")
print("-" * 78)
low = [t for t in made if len(t["questions"]) < 10]
print(f"템플릿 {len(made)}개 · 문항 {total_q}개 · 저장 위치 {outdir}")
if low:
    print(f"\n⚠️ 문항 10개 미만 — 수동 확인 필요 ({len(low)}개):")
    for t in low:
        print(f"   {t['code']:<16}{len(t['questions']):>4}문항  {t['name'][:44]}")
