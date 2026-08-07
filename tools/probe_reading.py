#!/usr/bin/env python3
"""
GradeSnap · 고쳐 읽기 실험

**이 프로젝트에서 지금 가장 큰 리스크를 재는 도구입니다.**

실측에서 전사가 종이에 쓰인 것을 지키지 않는 사례가 두 건 확인됐습니다.

    종이            전사            편집거리
    expectution  →  expectation     1 (u→a)      ❌ 고쳐 읽음
    관전          →  관점            1 (ㄴ→ㅁ)     ❌ 고쳐 읽음
    refrigiator  →  refrigiator     2            ✅ 살아남음

한 글자만 고치면 실재 단어가 되는 경우에만 고쳐 읽었습니다. 픽셀을 읽는 것이
아니라 **기대하는 답으로 수렴**하고 있습니다. → [12 §12.13](../docs/12-page-level-grading.md)

이게 왜 심각한가
    `transcribe`와 `judge`를 나눈 것은 "정답을 알려주면 봐준다"를 막기 위해서였는데,
    이 손상은 judge가 돌기 전에 이미 끝나 있습니다. 호출을 나눠도 전사기가
    이미 답을 알고 있으면 소용이 없습니다.
    **확신도로도 못 잡습니다** — 고쳐 읽은 두 건이 0.90과 0.93이었고,
    정작 흔들린 칸은 0.75였습니다. 모델은 고쳐 읽으면서 확신에 차 있었습니다.

무엇을 재는가
    같은 사진·같은 문항에 **읽히는 방식만 바꿔** 넣고, 종이에 실제로 쓰인 것을
    지키는 전략이 있는지 봅니다.

    baseline   지금 쓰는 전사 프롬프트 그대로 (기준선)
    spell      한 글자씩 분해해서 적게 한다 — 단어 완성 관성을 끊는 시도
    diff       "정답과 다른 점이 있는지 글자 단위로 대조하라" — 읽기를 대조로 바꾼다
    doubt      "학생 답안에는 오타가 흔하다. 실재 단어로 보여도 의심하라"

사용법
    ANTHROPIC_API_KEY=sk-ant-... python3 tools/probe_reading.py \\
        --image <채점 전 사진> \\
        --items 19,10 \\
        --truth "19=expectution,10=refrigiator"

    `--truth`는 **사람이 사진을 눈으로 보고 확인한 것**을 적습니다.
    전사 결과를 그대로 넣으면 아무것도 검증하지 못합니다.

의존성: pip install anthropic pillow
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grade_page as G

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  pip install pillow")


SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "no": {"type": "string"},
                    "written": {"type": "string",
                                "description": "학생이 손으로 쓴 것 그대로"},
                    "letters": {"type": "array", "items": {"type": "string"},
                                "description": "한 글자씩 분해. 영어는 알파벳 하나씩, "
                                               "한글은 음절 하나씩."},
                    "note": {"type": "string", "description": "판단이 갈린 글자가 있으면 한 줄"},
                    "confidence": {"type": "number"},
                },
                "required": ["no", "written", "letters", "note", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["items"],
    "additionalProperties": False,
}

BASE = """당신은 손글씨 답안지를 **옮겨 적는** 역할입니다. 채점하지 않습니다.
학생이 쓴 그대로 옮깁니다. 철자가 틀렸으면 틀린 채로 옮깁니다.
답란 첫 글자가 인쇄돼 있으면 그 글자를 포함한 완성형을 적습니다."""

STRATEGIES = {
    "baseline": (BASE, "아래 문항의 답란에 학생이 쓴 것을 옮겨 적으십시오."),

    "spell": (BASE + """

**한 글자씩 따로 보십시오.** 단어를 먼저 알아본 뒤 철자를 채우지 마십시오.
왼쪽부터 획을 하나씩 확인하며 letters 배열을 채우고, written은 그것을 이어 붙인 것이어야
합니다. 이어 붙인 결과가 아는 단어가 아니어도 그대로 두십시오.""",
              "아래 문항의 답을 **글자 단위로** 분해해 읽으십시오."),

    "diff": (BASE + """

당신은 이 문항의 정답이 무엇인지 알고 있을 것입니다. **그 지식을 읽기에 쓰지 말고,
대조에 쓰십시오.** 학생이 쓴 것을 정답과 글자 단위로 맞춰 보고, **다른 글자가 있는지**
찾으십시오. 학생 답안에서 정답과 어긋나는 글자를 찾는 것이 당신의 일입니다.
다른 곳이 없으면 없다고 하면 됩니다. 억지로 만들지 마십시오.""",
             "아래 문항에서 학생이 쓴 것이 정답과 **어디가 다른지** 글자 단위로 대조하십시오."),

    "doubt": (BASE + """

**학생 답안에는 오타가 흔합니다.** 이 시험은 철자를 묻는 시험이고, 한 글자 틀린 답이
자주 나옵니다. 읽은 결과가 매끄러운 실재 단어로 나왔다면, **그게 정말 종이에 있는
모양인지 한 번 더 확인하십시오.** 특히 모음 한 글자, 받침 하나가 다른 경우가 많습니다.
당신이 아는 단어로 수렴하지 말고 종이에 있는 획을 보십시오.""",
              "아래 문항의 답을 옮겨 적으십시오. 실재 단어로 보이더라도 의심하십시오."),
}


def probe(client, model, path, nos, strategy, effort, thinking):
    system, lead = STRATEGIES[strategy]
    text = (f"{lead}\n\n대상 문항: {', '.join(nos)}번. 이 문항들만 보고, 나머지는 무시하십시오.")
    return G.call(client, model, system, text, [Image.open(path)], SCHEMA, effort, thinking)


def main():
    ap = argparse.ArgumentParser(description="전사가 원문을 지키는 전략을 찾는다")
    ap.add_argument("--image", required=True, help="채점 전 사진")
    ap.add_argument("--items", required=True, help="문항 번호. 예: 19,10")
    ap.add_argument("--truth", required=True,
                    help="**사람이 사진을 보고 확인한** 실제 글자. 예: '19=expectution,10=refrigiator'")
    ap.add_argument("--strategies", default=",".join(STRATEGIES))
    ap.add_argument("--repeat", type=int, default=1, help="전략마다 N번 — 우연을 걸러낸다")
    ap.add_argument("--model", default=G.DEFAULT_MODEL)
    ap.add_argument("--effort", default="high",
                    choices=["low", "medium", "high", "xhigh", "max"])
    ap.add_argument("--no-thinking", action="store_true")
    a = ap.parse_args()

    truth = {}
    for part in a.truth.split(","):
        if "=" not in part:
            sys.exit(f"--truth 형식은 '번호=글자'입니다: {part!r}")
        k, v = part.split("=", 1)
        truth[k.strip()] = v.strip()
    nos = [x.strip() for x in a.items.split(",") if x.strip()]
    missing = [n for n in nos if n not in truth]
    if missing:
        sys.exit(f"--truth에 없는 문항: {', '.join(missing)}")

    strats = [x.strip() for x in a.strategies.split(",") if x.strip()]
    bad = [x for x in strats if x not in STRATEGIES]
    if bad:
        sys.exit(f"알 수 없는 전략: {bad}. 가능: {', '.join(STRATEGIES)}")

    client = G.client_or_die()
    print(f"사진 {os.path.basename(a.image)} · 문항 {', '.join(nos)} · 전략 {len(strats)}가지"
          + (f" × {a.repeat}회" if a.repeat > 1 else ""))
    print("종이에 쓰인 것: " + ", ".join(f"{k}={v!r}" for k, v in truth.items()))

    usages, score = [], {}
    print(f"\n| 전략 | 회차 | 문항 | 종이 | 전사 | | 확신 | 비고 |")
    print("|---|--:|---|---|---|:--:|--:|---|")
    for st in strats:
        for rep in range(1, a.repeat + 1):
            try:
                data, u = probe(client, a.model, a.image, nos, st, a.effort, not a.no_thinking)
            except Exception as e:                   # noqa: BLE001
                print(f"| {st} | {rep} | — | — | ❌ {type(e).__name__} | | | {str(e)[:60]} |")
                continue
            usages.append(u)
            got = {i["no"]: i for i in data["items"]}
            for n in nos:
                it = got.get(n)
                if not it:
                    print(f"| {st} | {rep} | {n} | {truth[n]} | (없음) | ❌ | | 전사에 없음 |")
                    score.setdefault(st, []).append(False)
                    continue
                ok = G._norm(it["written"]) == G._norm(truth[n])
                score.setdefault(st, []).append(ok)
                print(f"| {st} | {rep} | {n} | {truth[n]} | **{it['written']}** "
                      f"| {'✅' if ok else '❌'} | {it['confidence']:.2f} | {it['note'][:40]} |")

    print(f"\n## 전략별 원문 보존율")
    print("| 전략 | 지킴 / 전체 |")
    print("|---|---:|")
    for st in strats:
        r = score.get(st, [])
        print(f"| {st} | {sum(r)}/{len(r)} |")
    print(f"\n${G.cost_usd(usages, a.model):.4f}")
    print("\n※ baseline이 못 지키고 다른 전략이 지키면, **읽히는 방식으로 고칠 수 있다**는 뜻입니다.")
    print("   전부 못 지키면 프롬프트로는 안 되고, 칸을 잘라 따로 읽히는 등 다른 수를 봐야 합니다.")


if __name__ == "__main__":
    main()
