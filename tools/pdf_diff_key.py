#!/usr/bin/env python3
"""
GradeSnap · 시험지↔정답지 차분 추출기 (Phase 0 프로토타입)

레이아웃이 동일하고 정답만 채워진 정답지가 있을 때,
두 PDF의 텍스트를 비교해 **정답과 답안 영역 좌표를 동시에** 추출합니다.

[04 §2.5](../docs/04-data-model.md)의 **② 고정 세트** 분류 전용 경로입니다.
문법 백지 TEST가 정확히 이 구조입니다.

사용법:
    python3 tools/pdf_diff_key.py 시험지.pdf 정답지.pdf
    python3 tools/pdf_diff_key.py 시험지.pdf 정답지.pdf --json template.json

의존성: pip install pymupdf
"""

import argparse
import difflib
import json
import re
import sys

try:
    import fitz
except ImportError:
    sys.exit("pymupdf가 필요합니다:  pip install pymupdf")


def extract_words(path):
    """페이지별 단어 토큰과 정규화 bbox."""
    doc = fitz.open(path)
    out = []
    for pno, page in enumerate(doc, 1):
        W, H = page.rect.width, page.rect.height
        for x0, y0, x1, y1, word, *_ in page.get_text("words"):
            out.append({
                "page": pno,
                "text": word,
                "bbox": {"x": round(x0 / W, 4), "y": round(y0 / H, 4),
                         "w": round((x1 - x0) / W, 4), "h": round((y1 - y0) / H, 4)},
            })
    return out


def page_sizes(path):
    doc = fitz.open(path)
    return [{"page": i, "width_pt": round(p.rect.width, 1),
             "height_pt": round(p.rect.height, 1)}
            for i, p in enumerate(doc, 1)]


def diff_answers(exam_words, key_words):
    """정답지에만 있는 토큰 구간을 정답으로 추출한다.

    단어 단위로 비교한다. 문자 단위 diff는 공통 글자를 깎아내
    'while' → 'hile' 같은 손상이 생기므로 쓰지 않는다.
    """
    sm = difflib.SequenceMatcher(
        None, [w["text"] for w in exam_words], [w["text"] for w in key_words],
        autojunk=False)

    found = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or j1 == j2:
            continue
        removed, added = exam_words[i1:i2], key_words[j1:j2]
        if not added:
            continue

        # 시험지 쪽이 언더스코어 빈칸이면 좌표로 1:1 대응시킨다.
        # '____' 하나에 정답 하나가 들어간 구조이므로 이쪽이 훨씬 정확하다.
        blanks = [w for w in removed if UNDERSCORE.search(w["text"])]
        if blanks:
            paired = _pair_by_position(blanks, added)
            if paired:
                found += paired
                continue

        # 그 외에는 줄(=y좌표) 단위로 쪼개서 담는다
        for group in _split_by_line(added):
            gtext = " ".join(a["text"] for a in group).strip()
            if not gtext or _is_noise(gtext):
                continue
            found.append({
                "answer": gtext,
                "page": group[0]["page"],
                "bbox": _union(group),
                "removed": " ".join(w["text"] for w in removed).strip(),
            })
    return found


UNDERSCORE = re.compile(r"_{2,}")


def _pair_by_position(blanks, added, tol=0.02):
    """빈칸 하나하나에, 정답지에서 같은 자리에 있는 토큰을 붙인다."""
    out = []
    used = set()
    for b in blanks:
        bx, by = b["bbox"]["x"], b["bbox"]["y"]
        cands = [(k, a) for k, a in enumerate(added)
                 if k not in used and a["page"] == b["page"]
                 and abs(a["bbox"]["y"] - by) < tol]
        if not cands:
            continue
        # 같은 줄에서 x가 가장 가까운 토큰
        k, a = min(cands, key=lambda ka: abs(ka[1]["bbox"]["x"] - bx))
        if _is_noise(a["text"]):
            continue
        used.add(k)
        out.append({
            "answer": a["text"].strip(),
            "page": a["page"],
            "bbox": a["bbox"],
            "removed": b["text"],
            "from_blank": True,
        })
    return out


def _split_by_line(tokens, tol=0.008):
    groups, cur = [], []
    for t in tokens:
        if cur and (t["page"] != cur[-1]["page"]
                    or abs(t["bbox"]["y"] - cur[-1]["bbox"]["y"]) > tol):
            groups.append(cur); cur = []
        cur.append(t)
    if cur:
        groups.append(cur)
    return groups


def _union(tokens):
    x0 = min(t["bbox"]["x"] for t in tokens)
    y0 = min(t["bbox"]["y"] for t in tokens)
    x1 = max(t["bbox"]["x"] + t["bbox"]["w"] for t in tokens)
    y1 = max(t["bbox"]["y"] + t["bbox"]["h"] for t in tokens)
    return {"x": round(x0, 4), "y": round(y0, 4),
            "w": round(x1 - x0, 4), "h": round(y1 - y0, 4)}


NOISE = re.compile(r"^[\s\.\,\)\(\]\[\:\;\-–—~∙*※→…]+$")


def _is_noise(s):
    """구두점·기호만 남은 조각은 정답이 아니다."""
    return bool(NOISE.match(s)) or len(s.strip()) < 1


def build_template(exam_path, key_path, answers):
    """추출 결과를 exam_template JSON 초안으로 만든다."""
    return {
        "source": {"exam_pdf": exam_path, "answer_pdf": key_path},
        "pages": page_sizes(exam_path),
        "questions": [
            {
                "number": str(i),
                "type": "short_answer",
                "points": 1,
                "page_no": a["page"],
                "regions": [{"label": "answer", "kind": "handwriting",
                             "bbox": a["bbox"]}],
                "key": {"canonical": a["answer"], "accepted": []},
            }
            for i, a in enumerate(answers, 1)
        ],
    }


def main():
    ap = argparse.ArgumentParser(description="시험지↔정답지 차분으로 정답·좌표 추출")
    ap.add_argument("exam", help="시험지 PDF (빈칸 상태)")
    ap.add_argument("key", help="정답지 PDF (같은 레이아웃 + 정답)")
    ap.add_argument("--json", help="exam_template JSON 초안 저장")
    ap.add_argument("--quiet", action="store_true", help="목록 출력 생략")
    a = ap.parse_args()

    ex, key = extract_words(a.exam), extract_words(a.key)
    ed, kd = fitz.open(a.exam), fitz.open(a.key)
    ex_pages, key_pages = len(ed), len(kd)

    print(f"시험지 {ex_pages}p / {len(ex)}토큰 · 정답지 {key_pages}p / {len(key)}토큰")
    if ex_pages != key_pages:
        print(f"⚠️  페이지 수가 다릅니다 ({ex_pages} vs {key_pages}). "
              "정답이 들어가며 줄바꿈이 밀린 경우이며, 매칭 정확도가 떨어질 수 있습니다.")

    # 이미지 기반 PDF 판별 — 이미지 수가 텍스트 토큰 수를 넘으면 내용이 그림 안에 있다
    heavy = False
    for tag, doc, toks in (("시험지", ed, ex), ("정답지", kd, key)):
        n_img = sum(len(p.get_images()) for p in doc)
        if n_img > max(len(toks), 30):
            print(f"❌ {tag}는 내용이 이미지로 들어 있습니다 "
                  f"(이미지 {n_img}개 vs 텍스트 토큰 {len(toks)}개). "
                  "차분 추출 불가 — OCR 경로로 처리해야 합니다.")
            heavy = True
        elif n_img > len(toks) * 0.15:
            print(f"⚠️  {tag}에 이미지가 {n_img}개 섞여 있습니다. "
                  "일부 정답이 그림 안에 있어 추출에서 빠질 수 있습니다.")

    answers = diff_answers(ex, key)

    # 정답지가 실제로 채워져 있는지 검증
    delta = len(key) - len(ex)
    if not heavy and delta < 5:
        print(f"⚠️  정답지의 토큰이 시험지보다 {delta}개밖에 많지 않습니다. "
              "**정답지가 채워지지 않았을 가능성**을 먼저 확인하세요 "
              "(빈칸만 있는 시험지 사본일 수 있습니다).")

    if not a.quiet:
        print("=" * 72)
        for i, r in enumerate(answers, 1):
            b = r["bbox"]
            print(f"{i:>3}. p{r['page']} ({b['x']:.3f},{b['y']:.3f}) {r['answer']!r}")
        print("=" * 72)

    print(f"정답 {len(answers)}개 추출")
    if answers:
        by_page = {}
        for r in answers:
            by_page[r["page"]] = by_page.get(r["page"], 0) + 1
        print("페이지별: " + ", ".join(f"p{p}={c}" for p, c in sorted(by_page.items())))

    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(build_template(a.exam, a.key, answers), f,
                      ensure_ascii=False, indent=2)
        print(f"템플릿 초안 저장: {a.json}")


if __name__ == "__main__":
    main()
