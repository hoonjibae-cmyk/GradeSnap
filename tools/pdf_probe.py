#!/usr/bin/env python3
"""
GradeSnap · PDF 등록 가능성 진단 도구 (Phase 0 프로토타입)

시험지 PDF가 자동 등록 가능한지, 어떤 경로로 처리해야 하는지 진단합니다.
정답지 PDF를 함께 주면 정답 자동 추출까지 시도합니다.

사용법:
    python3 tools/pdf_probe.py 시험지.pdf
    python3 tools/pdf_probe.py 시험지.pdf --answers 정답지.pdf
    python3 tools/pdf_probe.py 시험지.pdf --answers 정답지.pdf --json out.json

의존성: pip install pymupdf
"""

import argparse
import json
import re
import sys
from collections import Counter

try:
    import fitz  # pymupdf
except ImportError:
    sys.exit("pymupdf가 필요합니다:  pip install pymupdf")


# ── 패턴 ────────────────────────────────────────────────────────────────
UNDERSCORE = re.compile(r"_{3,}")
# 문항 번호: "12." "12)" — 앞에 다른 글자가 붙지 않은 순수 번호 토큰만
QNUM = re.compile(r"^(\d{1,3})[.)]$")
# 정답지에서 정답 뽑기: "1. 정답: ②", "(3) 정답: imaginary"
ANSWER_LINE = re.compile(r"[(\[]?(\d{1,3})[)\].]?\s*정답\s*[:：]\s*(.+?)\s*$")
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"

# 헤더/꼬리말로 간주해 문항 검출에서 제외할 세로 영역 비율
HEADER_ZONE = 0.10
FOOTER_ZONE = 0.97


# ── PDF 성격 판정 ───────────────────────────────────────────────────────
def _is_mojibake(text):
    """추출은 되는데 글자가 깨진 경우(ToUnicode CMap 누락) 판별.

    브라우저 인쇄로 만든 PDF에서 폰트가 서브셋 임베드되면 화면은 정상이지만
    텍스트 추출 시 '!' '#' 같은 쓰레기가 나온다.
    """
    sample = "".join(text.split())[:600]
    if len(sample) < 40:
        return False
    readable = sum(1 for c in sample
                   if c.isalnum() or "가" <= c <= "힣")
    return readable / len(sample) < 0.45


def classify_page(page):
    """페이지가 텍스트 레이어를 갖는지, 벡터 아웃라인인지, 스캔 이미지인지."""
    text = page.get_text().strip()
    text_len = len(text)
    n_draw = len(page.get_drawings())
    n_img = len(page.get_images())

    if text_len > 200:
        if _is_mojibake(text):
            return "mojibake"    # 텍스트는 있으나 디코딩 불가 → OCR 필요
        return "text"            # 텍스트 레이어 살아 있음 → 최상
    if n_draw > 300:
        return "outlined"        # 글자가 벡터 경로로 변환됨 → OCR 필요
    if n_img and text_len < 50:
        return "scanned"         # 스캔/이미지 → OCR 필요
    return "sparse"


# ── 답안 영역 검출 ──────────────────────────────────────────────────────
def find_underscore_regions(page):
    """'______' 같은 언더스코어 문자로 그려진 답안란."""
    W, H = page.rect.width, page.rect.height
    out = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        if not UNDERSCORE.search(word):
            continue
        if y0 / H < HEADER_ZONE or y0 / H > FOOTER_ZONE:
            continue                      # 이름란·재시험일 등 헤더 제외
        if (x1 - x0) / W < 0.04:
            continue                      # 너무 짧은 것은 답안란이 아님
        out.append({
            "kind": "underscore",
            "bbox": _norm(x0, y0, x1, y1, W, H),
            "chars": len(word),
        })
    return out


def find_ruled_lines(page, min_w=0.05, max_h=2.5):
    """실제 선(벡터)으로 그려진 답안 밑줄."""
    W, H = page.rect.width, page.rect.height
    out = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.height > max_h:              # 가로선만
            continue
        if r.width / W < min_w:
            continue
        if r.y0 / H < HEADER_ZONE or r.y0 / H > FOOTER_ZONE:
            continue
        out.append({
            "kind": "rule",
            # 선 위쪽으로 글씨가 올라오므로 위로 높이를 확보
            "bbox": _norm(r.x0, r.y0 - 14, r.x1, r.y0 + 2, W, H),
        })
    return _dedupe(out)


def find_choice_marks(page):
    """①②③④ 선택지 — 4지선다 문항의 마킹 대상."""
    W, H = page.rect.width, page.rect.height
    out = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        if word and word[0] in CIRCLED:
            out.append({
                "kind": "choice",
                "bbox": _norm(x0, y0, x1, y1, W, H),
                "index": CIRCLED.index(word[0]) + 1,
            })
    return out


def find_question_numbers(page):
    """인쇄된 문항 번호와 위치. 인쇄 활자이므로 신뢰도가 높다."""
    W, H = page.rect.width, page.rect.height
    out = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        m = QNUM.match(word)
        if not m:
            continue
        if y0 / H < HEADER_ZONE or y0 / H > FOOTER_ZONE:
            continue
        out.append({"number": int(m.group(1)),
                    "bbox": _norm(x0, y0, x1, y1, W, H)})
    return out


def _norm(x0, y0, x1, y1, W, H):
    return {"x": round(x0 / W, 4), "y": round(y0 / H, 4),
            "w": round((x1 - x0) / W, 4), "h": round((y1 - y0) / H, 4)}


def _dedupe(regions, tol=0.004):
    """겹치는 선(테두리 이중선 등) 정리."""
    kept = []
    for r in sorted(regions, key=lambda r: (r["bbox"]["y"], r["bbox"]["x"])):
        if any(abs(r["bbox"]["y"] - k["bbox"]["y"]) < tol
               and abs(r["bbox"]["x"] - k["bbox"]["x"]) < tol for k in kept):
            continue
        kept.append(r)
    return kept


# ── 문항 번호 ↔ 답안 영역 매칭 ──────────────────────────────────────────
def match(numbers, regions):
    """각 답안 영역을 '같은 줄에서 왼쪽에 있는 가장 가까운 번호'에 붙인다."""
    numbers = sorted(numbers, key=lambda n: (n["bbox"]["y"], n["bbox"]["x"]))
    matched, orphan = [], []
    for reg in regions:
        ry, rx = reg["bbox"]["y"], reg["bbox"]["x"]
        cands = [n for n in numbers
                 if abs(n["bbox"]["y"] - ry) < 0.02 and n["bbox"]["x"] <= rx + 0.01]
        if not cands:   # 번호가 윗줄에 있는 경우(답안이 다음 줄로 내려간 배치)
            cands = [n for n in numbers if 0 < ry - n["bbox"]["y"] < 0.045]
        if cands:
            best = max(cands, key=lambda n: (n["bbox"]["y"], n["bbox"]["x"]))
            matched.append({**reg, "question": best["number"]})
        else:
            orphan.append(reg)
    return matched, orphan


# ── 정답지 파싱 ─────────────────────────────────────────────────────────
def parse_answer_pdf(path):
    """정답지에서 번호별 정답을 뽑는다. 세 형식을 모두 시도한다."""
    doc = fitz.open(path)
    full = "\n".join(p.get_text() for p in doc)

    # 형식 1) "1. 정답: ②" / "(3) 정답: imaginary"  — 해설지형
    explained = []
    for line in full.split("\n"):
        m = ANSWER_LINE.search(line.strip())
        if m:
            explained.append((int(m.group(1)), m.group(2).strip()))

    # 형식 2) "1.\n traffic\n (왕래하는) 차량, 교통(량)" — 시험지와 같은 레이아웃 병렬형
    parallel = []
    lines = [l.strip() for l in full.split("\n")]
    for i, l in enumerate(lines):
        m = QNUM.match(l)
        if m and i + 2 < len(lines):
            prompt, ans = lines[i + 1], lines[i + 2]
            if prompt and ans and not QNUM.match(ans):
                parallel.append((int(m.group(1)), prompt, ans))

    return {"explained": explained, "parallel": parallel,
            "has_text_layer": len(full.strip()) > 200}


# ── 진단 ────────────────────────────────────────────────────────────────
def probe(exam_path, answer_path=None):
    doc = fitz.open(exam_path)
    report = {"file": exam_path, "pages": len(doc), "page_reports": []}

    kinds = Counter()
    all_matched, all_orphan, all_numbers, all_choices = [], [], [], []

    for pno, page in enumerate(doc, 1):
        kind = classify_page(page)
        kinds[kind] += 1

        nums = find_question_numbers(page) if kind == "text" else []
        regions = (find_underscore_regions(page) + find_ruled_lines(page)) if kind == "text" else []
        choices = find_choice_marks(page) if kind == "text" else []
        matched, orphan = match(nums, regions)

        all_numbers += nums
        all_matched += [{**m, "page": pno} for m in matched]
        all_orphan += [{**o, "page": pno} for o in orphan]
        all_choices += [{**c, "page": pno} for c in choices]

        report["page_reports"].append({
            "page": pno, "kind": kind, "numbers": len(nums),
            "regions": len(regions), "matched": len(matched),
            "orphan": len(orphan), "choices": len(choices),
        })

    report["layer"] = kinds.most_common(1)[0][0]
    report["question_numbers"] = sorted({n["number"] for n in all_numbers})
    report["answer_regions"] = all_matched
    report["orphan_regions"] = all_orphan
    report["choice_marks"] = len(all_choices)

    if answer_path:
        report["answer_key"] = parse_answer_pdf(answer_path)

    return report


def print_report(r):
    print(f"\n{'='*66}")
    print(f"  {r['file'].split('/')[-1]}")
    print(f"{'='*66}")

    layer_msg = {
        "text":     "✅ 텍스트 레이어 있음 — OCR 없이 좌표 추출 가능",
        "outlined": "⚠️  글자가 벡터 경로로 변환됨 — 렌더 후 OCR 필요",
        "mojibake": "⚠️  텍스트는 있으나 폰트 인코딩이 깨짐 — 렌더 후 OCR 필요",
        "scanned":  "⚠️  스캔/이미지 PDF — 렌더 후 OCR 필요",
        "sparse":   "⚠️  내용이 희박함 — 확인 필요",
    }
    print(f"페이지 {r['pages']}장 · {layer_msg[r['layer']]}")

    if r["layer"] != "text":
        print("\n→ 이 PDF는 자동 추출 경로 B(OCR)로 처리해야 합니다.")
        return

    print(f"\n{'p':>3} {'종류':<9} {'번호':>4} {'답안란':>6} {'매칭':>5} {'미매칭':>6} {'선택지':>6}")
    for p in r["page_reports"]:
        print(f"{p['page']:>3} {p['kind']:<9} {p['numbers']:>4} {p['regions']:>6} "
              f"{p['matched']:>5} {p['orphan']:>6} {p['choices']:>6}")

    n_matched, n_orphan = len(r["answer_regions"]), len(r["orphan_regions"])
    covered = {m["question"] for m in r["answer_regions"]}
    all_q = set(r["question_numbers"])
    missing = sorted(all_q - covered)

    # 의미 있는 지표는 "검출 영역 중 몇 %가 매칭됐나"가 아니라
    # "인쇄된 문항 중 몇 %에 답안 영역이 붙었나"이다.
    # 표 테두리 등이 답안란으로 오검출되는 것은 매칭 단계에서 자연히 걸러진다.
    cov = (len(covered) / len(all_q) * 100) if all_q else 0
    print(f"\n문항 {len(all_q)}개 인쇄 · 답안 영역 연결 {len(covered)}개 "
          f"(**문항 커버리지 {cov:.0f}%**)")
    print(f"답안란 후보 {n_matched + n_orphan}개 검출 "
          f"(문항에 붙지 않은 {n_orphan}개는 표 테두리 등으로 추정)")
    if r["choice_marks"]:
        print(f"선택지 마크 {r['choice_marks']}개 — 4지선다 문항 존재")

    if covered:
        qs = sorted(covered)
        print(f"연결된 문항: {qs[:20]}{' ...' if len(qs) > 20 else ''}")
    if missing:
        print(f"⚠️  답안 영역을 못 찾은 문항: {missing[:20]}"
              f"{' ...' if len(missing) > 20 else ''}  → 이것만 수동 지정하면 됩니다")

    ak = r.get("answer_key")
    if ak:
        print(f"\n[정답지]")
        if not ak["has_text_layer"]:
            print("  ⚠️  텍스트 레이어 없음 — OCR 필요")
        if ak["explained"]:
            print(f"  해설지형 정답 {len(ak['explained'])}개:")
            for n, a in ak["explained"][:8]:
                print(f"     {n:>3}번 → {a[:46]}")
            if len(ak["explained"]) > 8:
                print(f"     ... 외 {len(ak['explained']) - 8}개")
        if ak["parallel"]:
            print(f"  병렬형(시험지와 같은 배열) 정답 {len(ak['parallel'])}개:")
            for n, p_, a in ak["parallel"][:8]:
                print(f"     {n:>3}번  {p_[:18]:<18} → {a[:34]}")
            if len(ak["parallel"]) > 8:
                print(f"     ... 외 {len(ak['parallel']) - 8}개")
        if not ak["explained"] and not ak["parallel"]:
            print("  ❌ 알려진 형식으로 파싱하지 못했습니다 — 파서 추가 필요")


def main():
    ap = argparse.ArgumentParser(description="GradeSnap PDF 등록 가능성 진단")
    ap.add_argument("exam", help="시험지 PDF")
    ap.add_argument("--answers", help="정답지 PDF (선택)")
    ap.add_argument("--json", help="결과를 JSON으로 저장")
    a = ap.parse_args()

    r = probe(a.exam, a.answers)
    print_report(r)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False, indent=2)
        print(f"\nJSON 저장: {a.json}")


if __name__ == "__main__":
    main()
