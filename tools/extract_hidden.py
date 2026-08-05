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

def extract(path, near_white=0xF0F0F0):
    doc = fitz.open(path)
    out = []
    for pno, page in enumerate(doc, 1):
        W, H = page.rect.width, page.rect.height
        for blk in page.get_text("dict")["blocks"]:
            for line in blk.get("lines", []):
                for s in line["spans"]:
                    c = s["color"]
                    r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255
                    if min(r, g, b) < 0xF0:      # 흰색(또는 거의 흰색)만
                        continue
                    t = s["text"].strip()
                    if not t or NOISE.match(t):
                        continue
                    x0, y0, x1, y1 = s["bbox"]
                    out.append({
                        "answer": t, "page": pno,
                        "bbox": {"x": round(x0/W, 4), "y": round(y0/H, 4),
                                 "w": round((x1-x0)/W, 4), "h": round((y1-y0)/H, 4)},
                    })
    return out, len(doc)

if __name__ == "__main__":
    ap = sys.argv[1]
    res, pages = extract(ap)
    print(f"{os.path.basename(ap)} · {pages}p · 숨은 정답 {len(res)}개")
    for i, r in enumerate(res, 1):
        b = r["bbox"]
        print(f"{i:>3}. p{r['page']} ({b['x']:.3f},{b['y']:.3f}) {r['answer']!r}")
