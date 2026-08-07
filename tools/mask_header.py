#!/usr/bin/env python3
"""
GradeSnap · 이름 자동 가리기

⚠️ **기본으로 쓰지 않습니다.** 운영 결정은 "머리말을 가리지 않고 동의를 받는다"입니다.
   → [12 §12.9](../docs/12-page-level-grading.md)

머리말에는 학생 이름만 있는 게 아니라 반·시험명·선생님·날짜·커트라인·문항 수가
같이 있습니다. 가리면 그 여섯을 조교가 손으로 넣어야 하고, 그 순간
"시험지 가져오면 찍고 끝"이라는 이 제품의 전제가 무너집니다.
하나를 가리려고 여섯을 버리는 거래라 하지 않기로 했습니다.

이 도구는 **가려야 할 상황이 생겼을 때** 씁니다 — 동의를 못 받는 반, 외부 시연,
저장소에 붙일 예시 이미지 만들기 등. `grade_page.py --mask-name`으로 켭니다.

어떻게 가리는가
    사진에는 책상 배경이 같이 찍히므로 '이미지 위쪽 N%'는 믿을 수 없습니다.
    밝기로 **종이 영역을 먼저 찾고**, 그 종이의 위쪽 N%만 덮습니다.
    종이를 못 찾으면 이미지 기준으로 넉넉히 덮습니다 — 못 가리는 것보다 낫습니다.

    답안은 본문에 있고 이름은 머리말에 있어 겹치지 않습니다.
    실제 샘플 6장 모두 그랬습니다.

**눈으로 한 번 확인하십시오.** `--preview`로 저장되는 이미지를 보고 이름이 확실히
덮였는지 보고 나서 비율을 고정하면 됩니다. 자동화의 신뢰는 한 번의 확인에서 나옵니다.

사용법
    # 한 장 — 미리보기까지
    python3 tools/mask_header.py --image before.jpg --out masked.png --preview

    # 폴더 통째로
    python3 tools/mask_header.py --dir samples/ --out-dir masked/

    # 머리말이 두꺼우면 비율을 올린다 (종이 높이 대비)
    python3 tools/mask_header.py --image before.jpg --ratio 0.25

의존성: pip install pillow
"""

import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow가 필요합니다:  pip install pillow")

# 종이 높이 대비 머리말 비율. 샘플 6장에서 머리말은 10~20%였고, 여유를 둡니다.
DEFAULT_RATIO = 0.20
# 이 밝기 이상이면 종이로 봅니다. 나무 책상·흰 책상 모두에서 종이가 더 밝았습니다.
PAPER_THRESHOLD = 165


def find_paper(img):
    """밝은 영역의 바운딩 박스 = 종이. 못 찾으면 None."""
    g = img.convert("L")
    # 축소해서 판정합니다 — 노이즈에 둔감해지고 빨라집니다.
    small = g.resize((g.width // 8 or 1, g.height // 8 or 1))
    box = small.point(lambda p: 255 if p >= PAPER_THRESHOLD else 0).getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = (v * 8 for v in box)
    # 이미지의 절반도 안 되면 종이가 아니라 반사광 같은 것으로 봅니다.
    if (x1 - x0) * (y1 - y0) < img.width * img.height * 0.25:
        return None
    return (x0, y0, min(x1, img.width), min(y1, img.height))


def mask(path, ratio=DEFAULT_RATIO):
    """머리말을 덮은 이미지와, 어떻게 판단했는지를 함께 돌려줍니다."""
    img = Image.open(path)
    if img.mode != "RGB":
        img = img.convert("RGB")

    paper = find_paper(img)
    if paper:
        x0, y0, x1, y1 = paper
        band = int((y1 - y0) * ratio)
        how = "종이 검출"
    else:
        # 종이를 못 찾았습니다. 이미지 기준으로 더 넉넉히 덮습니다.
        x0, y0, x1 = 0, 0, img.width
        band = int(img.height * (ratio + 0.08))
        how = "종이 미검출 — 넉넉히 덮음"

    out = img.copy()
    ImageDraw.Draw(out).rectangle([x0, y0, x1, y0 + band], fill=(0, 0, 0))
    return out, {"how": how, "paper": paper, "band_px": band, "size": img.size}


def main():
    ap = argparse.ArgumentParser(description="답안지 머리말(이름)을 자동으로 가린다")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--image", help="한 장")
    src.add_argument("--dir", help="폴더 통째로")
    ap.add_argument("--out", help="--image일 때 저장 경로")
    ap.add_argument("--out-dir", default="masked", help="--dir일 때 저장 폴더")
    ap.add_argument("--ratio", type=float, default=DEFAULT_RATIO,
                    help=f"종이 높이 대비 머리말 비율 (기본 {DEFAULT_RATIO})")
    ap.add_argument("--preview", action="store_true",
                    help="가려진 부분이 보이게 축소본을 따로 저장한다")
    a = ap.parse_args()

    jobs = []
    if a.image:
        jobs.append((a.image, a.out or _default_out(a.image, a.out_dir)))
    else:
        for n in sorted(os.listdir(a.dir)):
            if n.lower().endswith((".jpg", ".jpeg", ".png", ".heic", ".webp")):
                jobs.append((os.path.join(a.dir, n), _default_out(n, a.out_dir)))
        if not jobs:
            sys.exit(f"{a.dir}에 이미지가 없습니다.")

    os.makedirs(a.out_dir, exist_ok=True)
    fallback = 0
    for src_path, dst in jobs:
        out, info = mask(src_path, a.ratio)
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        out.save(dst)
        if not info["paper"]:
            fallback += 1
        print(f"{os.path.basename(src_path):<32} {info['how']:<24} "
              f"위 {info['band_px']}px 덮음 → {dst}")
        if a.preview:
            p = out.copy()
            p.thumbnail((900, 900))
            pv = os.path.splitext(dst)[0] + "_preview.png"
            p.save(pv)
            print(f"{'':<32} 미리보기 → {pv}")

    print(f"\n{len(jobs)}장 처리"
          + (f" · 종이 미검출 {fallback}장 (넉넉히 덮었으나 눈으로 확인 권장)" if fallback else ""))
    print("⚠️  처음 한 번은 **반드시 눈으로** 이름이 덮였는지 확인하십시오.")
    print("    가려진 만큼 반·시험명·커트라인·문항 수도 사라집니다.")
    print("    그만큼 조교가 손으로 넣어야 하므로, 꼭 필요한 경우에만 쓰십시오.")


def _default_out(path, out_dir):
    base = os.path.splitext(os.path.basename(path))[0]
    return os.path.join(out_dir, base + "_masked.png")


if __name__ == "__main__":
    main()
