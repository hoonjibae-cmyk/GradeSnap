#!/usr/bin/env python3
"""
GradeSnap · 벤치마크 라벨 채우기 (Phase 0.2)

벤치마크의 진짜 비용은 API가 아니라 **라벨링**입니다.
답안지 30장 × 50문항 = 1,500칸. 이걸 다 손으로 옮겨 적으면 벤치마크는 안 돌아갑니다.

두 가지를 이용해 타이핑을 10분의 1로 줄입니다.

1. **선생님이 이미 오답 번호를 적어 둡니다.** 오답이 아닌 칸은 학생이 정답을 썼다는
   뜻이므로 `truth = 정답`으로 자동 채웁니다. 타이핑은 오답 칸만 하면 됩니다.
2. **필체 등급은 학생의 성질이지 문항의 성질이 아닙니다.** 답안지 한 장을 보고
   한 번만 등급을 매기면 그 학생의 모든 행에 적용됩니다.

자동으로 채운 라벨은 `truth_source=assumed`로 표시됩니다.
`bench_ocr.py`가 이 행의 불일치를 따로 세어 주므로, 인식기와 어긋난 것만
나중에 실물과 대조하면 됩니다. (선생님이 정답표에 없는 표기를 맞다고 처리했을 수 있습니다.)

사용법
    # 홍길동 답안지: 필체 보통, 오답은 3·7·12~14·30번, 무응답은 41·42번
    python3 tools/fill_truth.py --manifest manifest.csv \
        --student 홍길동 --grade fair --wrong 3,7,12-14,30 --blank 41,42

    # 채운 뒤 남은 할 일 확인
    python3 tools/fill_truth.py --manifest manifest.csv --todo
"""

import argparse
import csv
import sys

GRADES = ("good", "fair", "poor")
COLUMNS = ("truth", "grade", "truth_source")


def parse_numbers(spec):
    """'3,7,12-14' → {'3','7','12','13','14'}. 문항 번호는 문자열로 다룹니다."""
    out = set()
    for part in (spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            try:
                out |= {str(n) for n in range(int(a), int(b) + 1)}
            except ValueError:
                sys.exit(f"범위를 숫자로 읽을 수 없습니다: {part!r}")
        else:
            out.add(part)
    return out


def load(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        rows, fields = list(r), list(r.fieldnames or [])
    for c in COLUMNS:
        if c not in fields:
            fields.append(c)
    for row in rows:
        for c in COLUMNS:
            row.setdefault(c, "")
    return rows, fields


def save(path, rows, fields):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def canonical(row):
    """정답표의 대표 표기. candidates 열이 canonical|accepted 형식입니다."""
    return (row.get("answer") or (row.get("candidates") or "").split("|")[0]).strip()


def fill(rows, student, grade, wrong, blanks, overwrite):
    target = [r for r in rows if (r.get("student") or "").strip() == student]
    if not target:
        sys.exit(f"'{student}' 학생의 행이 매니페스트에 없습니다.")

    stat = {"정답자동": 0, "오답대기": 0, "무응답": 0, "건너뜀": 0}
    for r in target:
        if r.get("truth_source") == "typed" and not overwrite:
            stat["건너뜀"] += 1                      # 사람이 이미 손으로 적은 것은 건드리지 않는다
            continue
        q = (r.get("question") or "").strip()
        if q in blanks:
            r.update(truth="", grade="blank", truth_source="assumed")
            stat["무응답"] += 1
        elif q in wrong:
            r.update(truth="", grade=grade, truth_source="")   # 사람이 채울 자리
            stat["오답대기"] += 1
        else:
            r.update(truth=canonical(r), grade=grade, truth_source="assumed")
            stat["정답자동"] += 1
    return stat


def todo(rows):
    pend = [r for r in rows if not (r.get("truth") or "").strip()
            and (r.get("grade") or "").strip() not in ("blank", "")]
    unlabeled = [r for r in rows if not (r.get("grade") or "").strip()]
    print(f"손으로 채울 오답 칸 {len(pend)}개 · 아직 손도 안 댄 행 {len(unlabeled)}개")
    for r in pend[:40]:
        print(f"  {r.get('student','?'):<8} {r.get('question','?'):>4}번  "
              f"정답={canonical(r)!r}  crop={r.get('crop','')}")
    if len(pend) > 40:
        print(f"  … 외 {len(pend)-40}개")
    if pend:
        print("\ntruth 열에 **학생이 실제로 쓴 글자**를 적으십시오. "
              "정답이 아니라 학생이 쓴 그대로입니다.")


def main():
    ap = argparse.ArgumentParser(description="선생님 채점 결과로 벤치마크 라벨을 채운다")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--student", help="라벨을 채울 학생")
    ap.add_argument("--grade", choices=GRADES, help="이 학생의 필체 등급 (답안지 보고 한 번만)")
    ap.add_argument("--wrong", default="", help="오답 문항 번호. 예: 3,7,12-14")
    ap.add_argument("--blank", default="", help="무응답 문항 번호")
    ap.add_argument("--overwrite", action="store_true",
                    help="사람이 손으로 적은 truth까지 덮어쓴다")
    ap.add_argument("--todo", action="store_true", help="남은 할 일만 보여준다")
    a = ap.parse_args()

    rows, fields = load(a.manifest)

    if a.todo:
        todo(rows)
        return
    if not (a.student and a.grade):
        sys.exit("--student 와 --grade 가 필요합니다 (또는 --todo).")

    stat = fill(rows, a.student, a.grade, parse_numbers(a.wrong),
                parse_numbers(a.blank), a.overwrite)
    save(a.manifest, rows, fields)

    print(f"{a.student} · 필체 {a.grade} → " +
          " ".join(f"{k} {v}" for k, v in stat.items() if v))
    if stat["오답대기"]:
        print(f"\n오답 {stat['오답대기']}칸은 학생이 쓴 글자를 직접 적어야 합니다. "
              f"목록: python3 tools/fill_truth.py --manifest {a.manifest} --todo")


if __name__ == "__main__":
    main()
