#!/usr/bin/env python3
"""문법 백지 TEST 전용 — 시험지 PDF에 흰색으로 숨겨진 정답을 추출한다.

이 세트의 시험지는 정답을 흰색(#ffffff) 글자로 인쇄해 화면에서 안 보이게 만들었다.
따라서 **시험지 하나만으로** 정답 텍스트와 답안 영역 좌표를 동시에 얻을 수 있다.
정답지 PDF가 필요 없다.
"""
import sys, os, re, json
import fitz

WHITE = 0xFFFFFF
NOISE = re.compile(r"^[\s\.\,\)\(\]\[\:\;\-–—~∙*※→…/]+$")

def extract(path, merge_gap=1.0):
    """흰색 span을 빈칸(칸) 단위로 뽑는다.

    이 학원은 컷트라인을 '-12칸'처럼 **빈칸 개수**로 매기므로,
    빈칸 하나가 곧 채점 단위다. 줄 단위로 묶지 않는다.

    다만 한 빈칸의 정답이 폰트 전환 등으로 여러 span에 쪼개지는 경우가 있어,
    간격이 `merge_gap`(pt) 미만으로 붙어 있으면 하나로 합친다.
    그 이상 떨어져 있으면 별개 빈칸으로 본다 — 과도한 병합은
    서로 다른 빈칸을 합쳐버리므로 보수적으로 잡는다.
    """
    doc = fitz.open(path)
    out = []
    for pno, page in enumerate(doc, 1):
        W, H = page.rect.width, page.rect.height
        for blk in page.get_text("dict")["blocks"]:
            for line in blk.get("lines", []):
                whites = []
                for s in line["spans"]:
                    c = s["color"]
                    if min((c >> 16) & 255, (c >> 8) & 255, c & 255) < 0xF0:
                        continue                    # 흰색(또는 거의 흰색)만
                    t = s["text"].strip()
                    if not t or NOISE.match(t):
                        continue
                    whites.append((t, s["bbox"]))

                for text, bb in _merge_adjacent(whites, merge_gap):
                    x0, y0, x1, y1 = bb
                    out.append({
                        "answer": text, "page": pno,
                        "bbox": {"x": round(x0/W, 4), "y": round(y0/H, 4),
                                 "w": round((x1-x0)/W, 4), "h": round((y1-y0)/H, 4)},
                    })
    return out, len(doc)


def _merge_adjacent(spans, gap):
    merged = []
    for text, bb in spans:
        if merged:
            pt, pb = merged[-1]
            if bb[0] - pb[2] < gap:
                merged[-1] = (pt + text,
                              (pb[0], min(pb[1], bb[1]), bb[2], max(pb[3], bb[3])))
                continue
        merged.append((text, bb))
    return [(t.strip(), b) for t, b in merged if t.strip() and not NOISE.match(t.strip())]

if __name__ == "__main__":
    ap = sys.argv[1]
    res, pages = extract(ap)
    print(f"{os.path.basename(ap)} · {pages}p · 숨은 정답 {len(res)}개")
    for i, r in enumerate(res, 1):
        b = r["bbox"]
        print(f"{i:>3}. p{r['page']} ({b['x']:.3f},{b['y']:.3f}) {r['answer']!r}")
