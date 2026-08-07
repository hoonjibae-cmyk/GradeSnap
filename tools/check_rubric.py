#!/usr/bin/env python3
"""
GradeSnap · 채점 규칙 회귀 테스트

**사진도 전사도 필요 없습니다.** 텍스트만으로 판정 단계를 검사합니다.
채점 규칙(품사·철자 엄격도)을 손볼 때마다 여기서 먼저 확인하십시오.

왜 필요한가
    실측에서 `intention(명사) → 의도하다`가 정답 처리됐습니다. 원인은 모델이 아니라
    판정 프롬프트였습니다 — "classify → 분류하다와 분류 둘 다 정답"이라는 예시가
    **"품사가 달라도 뜻이 통하면 정답"으로 일반화**된 것입니다.
    → [12 §12.12](../docs/12-page-level-grading.md)

    규칙을 고칠 때 위험한 건 **과하게 조이는 것**입니다. `classify → 분류`까지
    오답이 되면 정상 답안이 오답으로 잡혀 선생님 채점과 더 멀어집니다.
    그래서 "오답이어야 하는 것"과 "정답이어야 하는 것"을 같이 넣어 둡니다.

사용법
    ANTHROPIC_API_KEY=sk-ant-... python3 tools/check_rubric.py

    # 철자 엄격 모드도 함께 (철자 사례만 뒤집혀야 정상)
    ANTHROPIC_API_KEY=sk-ant-... python3 tools/check_rubric.py --both
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grade_page as G

# (문항번호, 제시어, 방향, 인쇄첫글자, 학생이 쓴 것, 관대할 때, 엄격할 때, 왜)
#   기대값 True=정답 False=오답 None=판단 보류(사람이 볼 것)
CASES = [
    # ── 품사 — 엄격도와 무관하게 항상 오답이어야 합니다
    ("17", "intention", "en2ko", "", "의도하다", False, False,
     "명사를 동사로 옮김. 실측에서 정답 처리돼 놓친 오답이 된 사례"),
    ("47", "inhabit", "en2ko", "", "거주", False, False,
     "동사를 명사로 옮김 — 위와 반대 방향"),

    # ── 표기 변이 — 과하게 조이면 여기가 무너집니다
    ("1", "classify", "en2ko", "", "분류하다", True, True, "동사의 표준 대응"),
    ("1", "classify", "en2ko", "", "분류", True, True,
     "같은 동사의 명사형 표기. **이게 오답이 되면 규칙을 과하게 조인 것**"),
    ("4", "viewpoint", "en2ko", "", "관점", True, True,
     "그냥 맞는 답. (실측에서 이 문항이 어긋난 원인은 판정이 아니라 전사였습니다 — "
     "종이에는 '관전'이 쓰여 있었고 전사가 '관점'으로 고쳐 읽었습니다. "
     "이 회귀 테스트로는 그 부류를 못 잡습니다. 12 §12.13)"),

    # ── 뜻이 다름 — 항상 오답
    ("9", "morale", "en2ko", "", "치명적인", False, False, "사기/의욕이라야 함"),
    ("47", "혁신, 획기적인 것", "ko2en", "", "institute", False, False,
     "innovation이라야 함. 다른 단어를 씀"),

    # ── 철자 — 엄격도에 따라 뒤집혀야 합니다
    ("10", "냉장고", "ko2en", "r", "refrigiator", True, False,
     "한 글자 오류. 이 학원 선생님은 정답 처리했음(12 §12.6)"),
    ("38", "전문적인, 전문직의", "ko2en", "p", "propessional", True, False,
     "한 글자 오류"),

    # ── 무응답
    ("16", "expand", "en2ko", "", "", False, False, "무응답은 오답"),
]


def run(client, model, strict):
    items = [{"no": f"{i}", "prompt": p, "direction": d, "prefix": pre,
              "written": w, "blank": not w, "legible": True, "erased": False,
              "confidence": 0.9}
             for i, (_, p, d, pre, w, _, _, _) in enumerate(CASES, 1)]
    data, u = G.judge(client, model, {"sheet": {}, "items": items}, None, strict)
    got = {r["no"]: r for r in data["results"]}

    label = "철자 엄격" if strict else "철자 관대(기본)"
    print(f"\n## {label}")
    print("| 제시어 | 학생이 쓴 것 | 기대 | 실제 | | 왜 |")
    print("|---|---|:--:|:--:|:--:|---|")
    fails = 0
    for i, (_, p, d, pre, w, lax, strict_exp, why) in enumerate(CASES, 1):
        want = strict_exp if strict else lax
        r = got.get(str(i), {})
        actual = r.get("correct")
        ok = want is None or actual == want
        fails += 0 if ok else 1
        mark = lambda v: "–" if v is None else ("정답" if v else "오답")
        print(f"| {p} | {w or '(무응답)'} | {mark(want)} | {mark(actual)} "
              f"| {'✅' if ok else '❌'} | {why} |")
    print(f"\n{len(CASES) - fails}/{len(CASES)} 통과 · ${G.cost_usd([u], model):.4f}")
    return fails


def main():
    ap = argparse.ArgumentParser(description="채점 규칙이 의도대로 도는지 검사")
    ap.add_argument("--model", default=G.DEFAULT_MODEL)
    ap.add_argument("--both", action="store_true", help="관대·엄격 두 모드 다")
    ap.add_argument("--strict", action="store_true", help="엄격 모드만")
    a = ap.parse_args()

    client = G.client_or_die()
    modes = [False, True] if a.both else [a.strict]
    fails = sum(run(client, a.model, m) for m in modes)

    print()
    if fails:
        print(f"❌ {fails}건이 기대와 다릅니다. 판정 프롬프트(JUDGE_SYSTEM)를 손봐야 합니다.")
        print("   특히 '분류'가 오답으로 나왔다면 **규칙을 과하게 조인 것**입니다 —")
        print("   정상 답안이 오답이 되면 '우리만 오답'이 늘어 선생님 채점과 더 멀어집니다.")
    else:
        print("✅ 전부 기대대로입니다.")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
