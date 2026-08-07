#!/usr/bin/env python3
"""
⏸ 보류 — 좌표·crop 기반 설계의 도구입니다.
   docs/12-page-level-grading.md 로 설계가 바뀌면서 쓰지 않습니다.
   지우지 않고 남겨 둡니다. 되돌릴 경우를 대비한 기록입니다.

GradeSnap · 답안 영역 crop 생성기 (Phase 0)

템플릿 JSON + 답안지 이미지 → 문항별 crop 이미지 + 벤치마크 매니페스트.

인식 벤치마크의 입력을 만드는 도구입니다. 정합(마커 기반 homography)은
아직 구현 전이므로, 지금은 **이미 정면으로 반듯하게 찍힌 이미지**를 전제로
템플릿 좌표를 그대로 적용합니다. Phase 0 벤치마크에는 이 정도로 충분합니다.

사용법:
    python3 tools/make_crops.py \
        --template templates/BJ-L2-CH08.json \
        --image samples/BJ-L2-CH08_홍길동_p1.jpg \
        --page 1 \
        --out crops/ \
        --student 홍길동

의존성: pip install pillow
"""

import argparse
import csv
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  pip install pillow")

# crop 시 답안 영역 둘레로 넓히는 여백 (영역 크기 대비 비율).
# 학생 글씨가 칸을 살짝 넘어가는 경우가 흔해 여유를 준다.
PAD_X, PAD_Y = 0.02, 0.35


def crop_regions(template, image_path, page_no, out_dir, student=""):
    img = Image.open(image_path)
    W, H = img.size
    os.makedirs(out_dir, exist_ok=True)

    rows = []
    for q in template["questions"]:
        if q.get("page_no", 1) != page_no:
            continue
        for r in q["regions"]:
            b = r["bbox"]
            x0 = (b["x"] - b["w"] * PAD_X) * W
            y0 = (b["y"] - b["h"] * PAD_Y) * H
            x1 = (b["x"] + b["w"] * (1 + PAD_X)) * W
            y1 = (b["y"] + b["h"] * (1 + PAD_Y)) * H
            box = (max(0, int(x0)), max(0, int(y0)),
                   min(W, int(x1)), min(H, int(y1)))
            if box[2] - box[0] < 4 or box[3] - box[1] < 4:
                continue

            name = f"{template['code']}_p{page_no}_q{q['number']}_{r['label']}.png"
            path = os.path.join(out_dir, name)
            img.crop(box).save(path)

            key = q.get("key", {})
            accepted = key.get("accepted") or []
            rows.append({
                "crop": path,
                "template": template["code"],
                "student": student,
                "question": q["number"],
                "region": r["label"],
                "type": q.get("type", "short_answer"),
                # 정답은 템플릿에서 가져와 채워둔다 — 정답표 재입력 불필요
                "answer": key.get("canonical", ""),
                "candidates": "|".join([key.get("canonical", "")] + accepted).strip("|"),
                # 아래 두 칸은 사람이 채운다
                "truth": "",          # 학생이 실제로 쓴 글자 (정답 라벨)
                "grade": "",          # 필체 등급: good | fair | poor | blank
            })
    return rows


def main():
    ap = argparse.ArgumentParser(description="템플릿 좌표로 답안 영역을 잘라낸다")
    ap.add_argument("--template", required=True, help="exam_template JSON")
    ap.add_argument("--image", required=True, help="답안지 이미지 (정면 촬영본)")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--out", default="crops", help="crop 저장 디렉터리")
    ap.add_argument("--student", default="", help="학생 식별자 (선택)")
    ap.add_argument("--manifest", default="manifest.csv",
                    help="벤치마크 매니페스트 CSV (없으면 새로 만들고, 있으면 이어 붙임)")
    a = ap.parse_args()

    with open(a.template, encoding="utf-8") as f:
        template = json.load(f)

    rows = crop_regions(template, a.image, a.page, a.out, a.student)
    if not rows:
        print(f"⚠️  p{a.page}에 해당하는 답안 영역이 없습니다.")
        return

    exists = os.path.exists(a.manifest)
    with open(a.manifest, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        if not exists:
            w.writeheader()
        w.writerows(rows)

    print(f"crop {len(rows)}개 저장 → {a.out}/")
    print(f"매니페스트 → {a.manifest}")
    print()
    print("다음: 매니페스트의 truth / grade 두 열을 채우세요.")
    print("  truth  학생이 실제로 쓴 글자 (빈칸이면 그대로 비워둠)")
    print("  grade  good=또렷함  fair=보통  poor=악필  blank=무응답")


if __name__ == "__main__":
    main()
