#!/usr/bin/env python3
"""
GradeSnap · 페이지 단위 채점 (템플릿 없음)

**설계 전환의 산물입니다.** 기존 파이프라인은 템플릿 좌표로 칸을 잘라 한 칸씩
읽혔습니다. 이 도구는 **답안지 사진 한 장을 통째로** 넣고 문항별 결과를 받습니다.
템플릿·마커·정합·crop이 전부 필요 없습니다. 배경은 [12. 페이지 단위 채점](../docs/12-page-level-grading.md).

세 단계로 나뉘어 있고, **각각 따로 돌릴 수 있습니다.** 섞으면 원인을 못 가립니다.

    transcribe  채점 전 사진 → 문항별 전사 (읽기만. 정오 판정 안 함)
    judge       전사 결과 → 문항별 정오 (정답표가 있으면 규칙, 없으면 AI)
    marks       채점 후 사진 → 선생님이 표시한 오답 번호

행 밀림(무응답 칸에서 한 줄 밀려 읽는 것)이 이 방식의 유일한 치명적 실패 모드입니다.
좌표 대신 **인쇄된 문항 번호와 제시어를 함께 출력**하게 해서 막습니다.
제시어가 우리가 아는 것과 다르면 그 자리에서 밀림이 드러납니다.

사용법
    export ANTHROPIC_API_KEY=...

    # 채점 전 사진을 문항별로 전사
    python3 tools/grade_page.py transcribe --image before.jpg --out t.json

    # 전사 결과를 채점 (정답표 없으면 AI가 판정)
    python3 tools/grade_page.py judge --transcript t.json --out j.json

    # 채점 후 사진에서 선생님 오답 번호 읽기
    python3 tools/grade_page.py marks --image after.jpg --out m.json

    # 큰 시험지라 글씨가 작으면 위아래로 겹쳐 나눠 보낸다 (좌표는 여전히 불필요)
    python3 tools/grade_page.py transcribe --image before.jpg --split 2

    # 같은 사진을 여러 번 읽어 비결정성을 잰다
    python3 tools/grade_page.py transcribe --image before.jpg --repeat 3

의존성: pip install anthropic pillow
"""

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mask_header import mask as mask_header

try:
    import anthropic
except ImportError:
    sys.exit("anthropic SDK가 필요합니다:  pip install anthropic")

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  pip install pillow")


DEFAULT_MODEL = "claude-opus-5"

# 1M 토큰당 달러. claude-api 스킬 기준(2026-06-24 캐시).
# sonnet-5는 2026-08-31까지 도입가 $2/$10 — 만료 후 $3/$15로 고쳐야 합니다.
PRICING = {
    "claude-opus-5":    (5.00, 25.00),
    "claude-sonnet-5":  (2.00, 10.00),
    "claude-haiku-4-5": (1.00,  5.00),
}

# 고해상도 상한. 답안 한 칸이 40~80px 높이가 되므로 여기서 더 줄이면 연필이 안 읽힙니다.
MAX_EDGE = 2576


# ── 스키마 ────────────────────────────────────────────────────────────────

TRANSCRIBE_SCHEMA = {
    "type": "object",
    "properties": {
        "sheet": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "시험지 제목 (머리말에 인쇄된 것)"},
                "teacher": {"type": "string"},
                "student": {"type": "string"},
                "cut_line": {"type": "string", "description": "커트라인 표기 그대로. 예 '-8까지 pass'"},
                "printed_total": {"type": "integer",
                                  "description": "시험지에 인쇄된 총 문항 수. 안 적혀 있으면 0"},
            },
            "required": ["title", "teacher", "student", "cut_line", "printed_total"],
            "additionalProperties": False,
        },
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "no": {"type": "string", "description": "인쇄된 문항 번호"},
                    "prompt": {"type": "string",
                               "description": "그 문항에 인쇄된 제시어를 그대로. 밀림 검증용이라 반드시 채운다."},
                    "direction": {"type": "string", "enum": ["en2ko", "ko2en", "other"]},
                    "prefix": {"type": "string",
                               "description": "답란에 첫 글자가 인쇄돼 있으면 그 글자. 없으면 빈 문자열."},
                    "written": {"type": "string",
                                "description": "학생이 손으로 쓴 것 그대로. prefix가 있으면 포함한 완성형. 무응답이면 빈 문자열."},
                    "blank": {"type": "boolean", "description": "학생이 아무것도 안 썼으면 true"},
                    "legible": {"type": "boolean", "description": "글자는 있으나 판독 불가면 false"},
                    "erased": {"type": "boolean", "description": "지우거나 뭉갠 흔적이 있으면 true"},
                    "confidence": {"type": "number"},
                },
                "required": ["no", "prompt", "direction", "prefix", "written",
                             "blank", "legible", "erased", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sheet", "items"],
    "additionalProperties": False,
}

MARKS_SCHEMA = {
    "type": "object",
    "properties": {
        "convention": {
            "type": "object",
            "properties": {
                "check_mark": {"type": "string",
                               "description": "거의 모든 문항에 붙은 '채점함' 표시. 예 '문항번호에 동그라미'"},
                "wrong_mark": {"type": "string",
                               "description": "일부 문항에만 붙은 '오답' 표시. 예 'V 체크', '긴 사선'"},
                "reasoning": {"type": "string", "description": "왜 그렇게 나눴는지 한두 문장"},
            },
            "required": ["check_mark", "wrong_mark", "reasoning"],
            "additionalProperties": False,
        },
        "wrong": {"type": "array", "items": {"type": "string"},
                  "description": "오답 표시가 붙은 문항 번호"},
        "score_text": {"type": "string", "description": "선생님이 적은 점수·오답 개수 표기 그대로. 예 '-12'"},
        "pass_fail": {"type": "string", "enum": ["pass", "fail", "unmarked"]},
        "confidence": {"type": "number"},
    },
    "required": ["convention", "wrong", "score_text", "pass_fail", "confidence"],
    "additionalProperties": False,
}

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "no": {"type": "string"},
                    "correct": {"type": "boolean"},
                    "expected": {"type": "string", "description": "이 문항의 정답"},
                    "note": {"type": "string", "description": "애매하면 한 줄 이유. 명확하면 빈 문자열"},
                },
                "required": ["no", "correct", "expected", "note"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["results"],
    "additionalProperties": False,
}


# ── 프롬프트 ─────────────────────────────────────────────────────────────

TRANSCRIBE_SYSTEM = """당신은 손글씨 답안지를 **옮겨 적는** 역할입니다. 채점하지 않습니다.

가장 중요한 규칙 — **행을 밀지 마십시오.**
무응답 칸이 있으면 그 칸을 건너뛰고 다음 답을 당겨 쓰는 실수가 가장 흔합니다.
빈칸도 반드시 한 항목으로 출력하고(blank=true), 그 자리를 지키십시오.
매 항목마다 인쇄된 제시어(prompt)를 같이 적으십시오. 이것이 밀림을 잡는 장치입니다.

전사 규칙
1. 학생이 쓴 그대로 옮깁니다. 철자가 틀렸으면 틀린 채로 옮깁니다.
   'propessional'이라고 썼으면 'propessional'입니다. 'professional'로 고치면 오채점입니다.
2. 인쇄된 글자(문항 번호, 제시어, 밑줄, 표 테두리)는 written에 넣지 않습니다.
   단 답란 첫 글자가 인쇄돼 있으면 prefix에 적고, written에는 그 글자를 포함한 완성형을 적습니다.
   예: 인쇄 'a____', 학생이 'ccept' → prefix='a', written='accept'
3. 답란 밖 여백의 연습 낙서는 답이 아닙니다. 무시하십시오.
4. 지우거나 뭉갠 자국이 있으면 erased=true로 두고, **최종적으로 남긴 글자**를 옮깁니다.
5. 글자가 있는데 못 읽겠으면 legible=false로 두고 추측하지 마십시오.
   아무것도 안 쓴 칸은 blank=true, legible=true, written=""입니다.
6. 채점 표시(빨간펜)가 있으면 그건 선생님이 나중에 그린 것입니다. 학생 답이 아닙니다."""

MARKS_SYSTEM = """채점이 끝난 답안지에서 **선생님이 오답으로 표시한 문항 번호**를 읽어내십시오.

주의 — 이 학원 선생님들은 표시를 두 종류 씁니다.
- **채점함 표시**: 거의 모든 문항에 붙습니다. 정오와 무관합니다. (문항번호 동그라미, 답 끝의 점 등)
- **오답 표시**: 일부 문항에만 붙습니다. (V 체크, 긴 사선 등)

**거의 모든 문항에 붙은 표시를 오답으로 읽으면 결과가 통째로 뒤집힙니다.**
먼저 두 종류를 구분한 뒤, 소수에만 붙은 쪽을 오답으로 보십시오.
표시가 칸 경계에 걸쳐 있으면 어느 문항인지 신중히 정하십시오.

선생님이 적은 오답 개수(`-12` 같은 표기)나 PASS/FAIL이 있으면 같이 읽어
자기 검증에 쓰십시오. 개수가 안 맞으면 다시 세십시오."""

JUDGE_SYSTEM = """단어 시험 답안의 정오를 판정합니다. 이미지는 보지 않고, 전사된 텍스트만 봅니다.

판정 규칙
1. `direction=en2ko`(영어→우리말)는 **뜻이 통하면 정답**입니다. 표기 변이를 인정합니다.
   'classify → 분류하다'와 '분류' 둘 다 정답입니다.
2. `direction=ko2en`(우리말→영어)은 **철자를 봅니다.** 아래 strict 설정을 따르십시오.
3. 무응답(blank)은 오답입니다.
4. 판독 불가(legible=false)는 정오를 판정하지 말고 correct=false, note='판독불가'로 두십시오.
5. expected에는 그 문항의 표준 정답을 적으십시오."""

STRICT_ON = "\n\n**철자 엄격**: 철자가 한 글자라도 다르면 오답입니다. 'propessional'은 오답입니다."
STRICT_OFF = ("\n\n**철자 관대**: 한두 글자 오타는 정답으로 봅니다. 이 학원 선생님들의 실제 채점이 "
              "그렇습니다. 다만 다른 단어가 된 경우(institute vs innovation)는 오답입니다.")


# ── API ──────────────────────────────────────────────────────────────────

def encode(img):
    if max(img.size) > MAX_EDGE:
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode()


def open_image(path, mask_top=False):
    """전송할 이미지를 연다. mask_top이면 **API로 나가기 전에** 이름을 덮는다.

    가리는 시점이 중요합니다. 나갔다 온 뒤에 가리는 건 아무 의미가 없습니다.
    """
    if mask_top:
        img, _ = mask_header(path)
        return img
    return Image.open(path)


def bands(path, n, overlap=0.12, mask_top=False):
    """페이지를 위아래로 겹쳐 나눕니다.

    통짜로 넣으면 답안 한 칸이 너무 작아 연필이 안 읽히는 경우를 위한 장치입니다.
    좌표는 여전히 필요 없습니다 — 단순 등분이고, 겹치는 띠를 둬서 경계에 걸친 행이
    어느 한쪽에는 온전히 들어가게 합니다.
    """
    img = open_image(path, mask_top)
    if n <= 1:
        return [img]
    W, H = img.size
    step = H / n
    pad = step * overlap
    out = []
    for i in range(n):
        top = max(0, int(i * step - pad))
        bot = min(H, int((i + 1) * step + pad))
        out.append(img.crop((0, top, W, bot)))
    return out


def call(client, model, system, user_text, images, schema, effort="high", thinking=True):
    content = [{"type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": encode(im)}}
               for im in images]
    content.append({"type": "text", "text": user_text})

    params = {
        "model": model,
        "max_tokens": 16000,
        "system": system,
        "messages": [{"role": "user", "content": content}],
        "output_config": {"effort": effort,
                          "format": {"type": "json_schema", "schema": schema}},
    }
    # 밀림 검증과 채점 마크 구분은 따져 봐야 하는 일이라 기본은 사고 과정을 켭니다.
    # 다만 **사고 토큰이 출력 토큰으로 과금**되어 장당 비용의 최대 변수입니다.
    # 껐을 때 품질이 얼마나 떨어지는지 재서 정할 값이라 스위치로 둡니다.
    if not thinking:
        params["thinking"] = {"type": "disabled"}

    t0 = time.perf_counter()
    msg = client.messages.create(**params)
    text = next(b.text for b in msg.content if b.type == "text")
    return json.loads(text), {
        "latency_ms": round((time.perf_counter() - t0) * 1000),
        "in_tok": msg.usage.input_tokens,
        "out_tok": msg.usage.output_tokens,
        "model": model,
    }


def cost_usd(usages, model):
    pin, pout = PRICING.get(model, (0.0, 0.0))
    i = sum(u["in_tok"] for u in usages)
    o = sum(u["out_tok"] for u in usages)
    return (i * pin + o * pout) / 1_000_000


# ── 단계 ─────────────────────────────────────────────────────────────────

def transcribe(client, model, path, split=1, effort="high", thinking=True,
               mask_top=False):
    parts = bands(path, split, mask_top=mask_top)
    if split == 1:
        data, u = call(client, model, TRANSCRIBE_SYSTEM,
                       "이 답안지의 모든 문항을 전사하십시오. 빈칸도 빠짐없이 포함하십시오.",
                       parts, TRANSCRIBE_SCHEMA, effort, thinking)
        return data, [u]

    # 나눠 보낸 뒤 번호로 합칩니다. 겹치는 띠에서 같은 문항이 두 번 나오면
    # 확신도가 높은 쪽을 남깁니다.
    sheet, merged, usages = None, {}, []
    for i, part in enumerate(parts, 1):
        data, u = call(client, model, TRANSCRIBE_SYSTEM,
                       f"답안지를 위에서부터 {len(parts)}등분한 것 중 {i}번째 조각입니다. "
                       f"이 조각에 **온전히 보이는** 문항만 전사하십시오. "
                       f"잘려서 일부만 보이는 문항은 빼십시오.",
                       [part], TRANSCRIBE_SCHEMA, effort, thinking)
        usages.append(u)
        sheet = sheet or data["sheet"]
        for it in data["items"]:
            prev = merged.get(it["no"])
            if prev is None or it["confidence"] > prev["confidence"]:
                merged[it["no"]] = it
    items = sorted(merged.values(), key=lambda x: _numkey(x["no"]))
    return {"sheet": sheet, "items": items}, usages


def _numkey(s):
    m = re.match(r"\d+", (s or "").strip())
    return (int(m.group()) if m else 10**9, s)


def read_marks(client, model, path, effort="high", thinking=True, mask_top=False):
    return call(client, model, MARKS_SYSTEM,
                "이 답안지에서 선생님이 오답으로 표시한 문항 번호를 모두 찾으십시오.",
                [open_image(path, mask_top)], MARKS_SCHEMA, effort, thinking)


def judge(client, model, transcript, key=None, strict=False, effort="high", thinking=True):
    items = transcript["items"]
    payload = [{"no": i["no"], "prompt": i["prompt"], "direction": i["direction"],
                "written": i["written"], "blank": i["blank"], "legible": i["legible"]}
               for i in items]
    text = ("아래는 한 답안지를 전사한 결과입니다. 문항마다 정오를 판정하십시오.\n\n"
            + json.dumps(payload, ensure_ascii=False, indent=1))
    if key:
        text += ("\n\n아래가 정답표입니다. 이것을 기준으로 판정하십시오.\n"
                 + json.dumps(key, ensure_ascii=False, indent=1))
    system = JUDGE_SYSTEM + (STRICT_ON if strict else STRICT_OFF)
    return call(client, model, system, text, [], JUDGE_SCHEMA, effort, thinking)


# ── 검증 ─────────────────────────────────────────────────────────────────

def check_drift(transcript, key=None):
    """행 밀림을 잡는다 — 이 방식의 유일한 치명적 실패 모드다.

    좌표가 없으므로 세 가지로 교차 확인합니다.
      · 번호가 1..N으로 빠짐없이 이어지는가
      · 인쇄된 총 문항 수와 전사한 개수가 맞는가
      · (정답표가 있으면) 각 번호의 제시어가 우리가 아는 것과 같은가
    """
    items, sheet = transcript["items"], transcript["sheet"]
    warn = []

    nums = [_numkey(i["no"])[0] for i in items]
    if len(set(nums)) != len(nums):
        warn.append("문항 번호가 중복됩니다 — 조각 병합이 잘못됐을 수 있습니다.")
    seq = [n for n in nums if n < 10**9]
    if seq:
        missing = sorted(set(range(min(seq), max(seq) + 1)) - set(seq))
        if missing:
            warn.append(f"번호가 비었습니다: {missing[:15]}"
                        + (" …" if len(missing) > 15 else ""))

    total = sheet.get("printed_total") or 0
    if total and total != len(items):
        warn.append(f"인쇄된 문항 수 {total} ≠ 전사 {len(items)} — 밀렸거나 빠졌습니다.")

    if key:
        known = {str(k["no"]): (k.get("prompt") or "") for k in key}
        bad = [i["no"] for i in items
               if known.get(i["no"]) and _norm(known[i["no"]]) != _norm(i["prompt"])]
        if bad:
            warn.append(f"제시어가 정답표와 다릅니다(밀림 의심): {bad[:15]}"
                        + (" …" if len(bad) > 15 else ""))

    empty = sum(1 for i in items if not (i.get("prompt") or "").strip())
    if empty:
        warn.append(f"제시어가 비어 있는 문항 {empty}개 — 밀림 검증이 그만큼 약해집니다.")

    warn += _check_prefix(items)
    warn += _check_language(items)
    return warn


def _check_prefix(items):
    """첫 글자가 인쇄된 문항은 학생 답이 그 글자로 시작해야 합니다.

    사람 입력도 정답표도 필요 없는 검증입니다. 답이 한 줄 밀리면
    38번의 prefix 'p' 자리에 39번 답 'victim'이 들어와 즉시 어긋납니다.
    """
    bad = [i["no"] for i in items
           if (i.get("prefix") or "").strip() and (i.get("written") or "").strip()
           and not i["written"].strip().lower().startswith(i["prefix"].strip().lower())]
    if not bad:
        return []
    return [f"인쇄된 첫 글자와 답이 안 맞습니다(밀림 의심): {', '.join(bad[:15])}"
            + (" …" if len(bad) > 15 else "")]


def _check_language(items):
    """출제 방향과 답의 언어가 맞아야 합니다.

    한 시험지에 '영어→한글'과 '한글→영어'가 섞여 있는 경우가 많은데,
    그 경계를 넘어 밀리면 ko2en 칸에 한글 답이 들어옵니다. 이것도 공짜 검증입니다.
    """
    bad = []
    for i in items:
        w = (i.get("written") or "").strip()
        if not w or len(w) < 2:
            continue
        han = _has_hangul(w)
        if i.get("direction") == "ko2en" and han:
            bad.append(f"{i['no']}(한글)")
        elif i.get("direction") == "en2ko" and not han and w.isascii():
            bad.append(f"{i['no']}(영문)")
    if not bad:
        return []
    return [f"출제 방향과 답의 언어가 다릅니다(밀림 의심): {', '.join(bad[:15])}"
            + (" …" if len(bad) > 15 else "")]


def _has_hangul(s):
    return any("가" <= c <= "힣" for c in s)


def _norm(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or "")).lower()


def compare(judged, marks):
    """우리 채점과 선생님 채점을 맞춰 봅니다. 이게 벤치마크의 핵심 지표입니다."""
    ours = {r["no"] for r in judged["results"] if not r["correct"]}
    theirs = set(marks["wrong"])
    allq = {r["no"] for r in judged["results"]} | theirs
    agree = len(allq) - len(ours ^ theirs)
    return {
        "n": len(allq),
        "agree": agree,
        "rate": agree / len(allq) if allq else 0.0,
        "ours_only": sorted(ours - theirs, key=_numkey),    # 우리가 더 엄격
        "theirs_only": sorted(theirs - ours, key=_numkey),  # 우리가 놓쳤거나 더 관대
        "ours_wrong": sorted(ours, key=_numkey),
        "theirs_wrong": sorted(theirs, key=_numkey),
    }


# ── 출력 ─────────────────────────────────────────────────────────────────

def print_transcript(t, warn, usages, model):
    s = t["sheet"]
    print(f"\n{s['title']}  ·  {s['teacher']}  ·  {s['student']}  ·  {s['cut_line']}")
    print(f"문항 {len(t['items'])}개"
          + (f" (인쇄 표기 {s['printed_total']})" if s.get("printed_total") else ""))
    blanks = [i["no"] for i in t["items"] if i["blank"]]
    illeg = [i["no"] for i in t["items"] if not i["legible"]]
    if blanks:
        print(f"무응답: {', '.join(blanks)}")
    if illeg:
        print(f"판독불가: {', '.join(illeg)}")
    for w in warn:
        print(f"⚠️  {w}")
    c = cost_usd(usages, model)
    lat = sum(u["latency_ms"] for u in usages)
    tok = sum(u["out_tok"] for u in usages)
    print(f"\n호출 {len(usages)}회 · {lat/1000:.1f}s · ${c:.4f} · 출력 {tok:,}토큰")
    print(f"   (2,200장/월이면 ${c*2200:,.0f}, 6,600장/월이면 ${c*6600:,.0f})")


def print_compare(cmp_, marks):
    print(f"\n## 선생님 채점과 대조")
    print(f"규칙 판독 — 채점함 표시: {marks['convention']['check_mark']} / "
          f"오답 표시: {marks['convention']['wrong_mark']}")
    print(f"선생님 표기: {marks['score_text'] or '없음'} · {marks['pass_fail']}")
    print(f"\n일치 {cmp_['agree']}/{cmp_['n']} = **{cmp_['rate']*100:.1f}%**")
    print(f"  우리 오답 : {', '.join(cmp_['ours_wrong']) or '없음'}")
    print(f"  선생님 오답: {', '.join(cmp_['theirs_wrong']) or '없음'}")
    if cmp_["ours_only"]:
        print(f"  🔸 우리만 오답 (더 엄격): {', '.join(cmp_['ours_only'])}")
    if cmp_["theirs_only"]:
        print(f"  🔺 선생님만 오답 (우리가 놓침): {', '.join(cmp_['theirs_only'])}")


def dump(path, obj):
    if not path:
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print(f"→ {path}")


# ── main ─────────────────────────────────────────────────────────────────

def client_or_die():
    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")):
        sys.exit("ANTHROPIC_API_KEY가 필요합니다.")
    return anthropic.Anthropic()


def main():
    ap = argparse.ArgumentParser(description="답안지 사진 한 장을 통째로 채점한다")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--effort", default="high", choices=["low", "medium", "high", "xhigh", "max"])
    ap.add_argument("--no-thinking", action="store_true",
                    help="사고 과정을 끈다. 출력 토큰이 크게 줄어 장당 비용이 몇 배 싸진다")
    sub = ap.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("transcribe", help="채점 전 사진 → 문항별 전사")
    t.add_argument("--image", required=True)
    t.add_argument("--split", type=int, default=1, help="글씨가 작으면 2~4로 나눠 보낸다")
    t.add_argument("--repeat", type=int, default=1, help="같은 사진을 N번 읽어 비결정성을 잰다")
    t.add_argument("--key", help="정답표 JSON — 있으면 제시어 대조로 밀림을 잡는다")
    t.add_argument("--mask-name", action="store_true",
                   help="머리말을 덮고 보낸다. 반·시험·커트라인·문항 수까지 같이 사라지므로 "
                        "조교가 그만큼 손으로 넣어야 한다. 기본은 끔")
    t.add_argument("--out")

    m = sub.add_parser("marks", help="채점 후 사진 → 선생님 오답 번호")
    m.add_argument("--image", required=True)
    m.add_argument("--mask-name", action="store_true")
    m.add_argument("--out")

    j = sub.add_parser("judge", help="전사 결과 → 문항별 정오")
    j.add_argument("--transcript", required=True)
    j.add_argument("--key", help="정답표 JSON. 없으면 AI가 판정한다")
    j.add_argument("--strict", action="store_true", help="철자를 엄격히 본다")
    j.add_argument("--marks", help="채점 후 사진에서 뽑은 marks JSON — 주면 대조까지 한다")
    j.add_argument("--out")

    a = ap.parse_args()
    client = client_or_die()
    think = not a.no_thinking
    key = json.load(open(a.key, encoding="utf-8")) if getattr(a, "key", None) else None

    if a.cmd == "transcribe":
        runs = []
        for r in range(a.repeat):
            data, usages = transcribe(client, a.model, a.image, a.split, a.effort, think,
                                      a.mask_name)
            warn = check_drift(data, key)
            if a.repeat > 1:
                print(f"\n───── 실행 {r+1}/{a.repeat} ─────")
            print_transcript(data, warn, usages, a.model)
            runs.append(data)
        if a.repeat > 1:
            report_variance(runs)
        dump(a.out, runs[0] if a.repeat == 1 else {"runs": runs})

    elif a.cmd == "marks":
        data, u = read_marks(client, a.model, a.image, a.effort, think, a.mask_name)
        print(f"\n채점함 표시: {data['convention']['check_mark']}")
        print(f"오답 표시  : {data['convention']['wrong_mark']}")
        print(f"근거: {data['convention']['reasoning']}")
        print(f"\n오답 {len(data['wrong'])}개: {', '.join(data['wrong']) or '없음'}")
        print(f"선생님 표기: {data['score_text'] or '없음'} · {data['pass_fail']}")
        print(f"\n${cost_usd([u], a.model):.4f}")
        dump(a.out, data)

    elif a.cmd == "judge":
        transcript = json.load(open(a.transcript, encoding="utf-8"))
        data, u = judge(client, a.model, transcript, key, a.strict, a.effort, think)
        wrong = [r for r in data["results"] if not r["correct"]]
        print(f"\n오답 {len(wrong)}/{len(data['results'])}")
        for r in wrong:
            w = next((i for i in transcript["items"] if i["no"] == r["no"]), {})
            print(f"  {r['no']:>3}. {r['expected']!r} ← {w.get('written','')!r}"
                  + (f"  ({r['note']})" if r["note"] else ""))
        print(f"\n${cost_usd([u], a.model):.4f}")
        if a.marks:
            marks = json.load(open(a.marks, encoding="utf-8"))
            print_compare(compare(data, marks), marks)
        dump(a.out, data)


def report_variance(runs):
    """같은 사진을 여러 번 읽었을 때 결과가 흔들리는 정도.

    규칙 기반과 달리 AI 채점은 결정적이지 않습니다. 얼마나 안 결정적인지를
    숫자로 알아야 재채점 정책을 정할 수 있습니다.
    """
    base = {i["no"]: _norm(i["written"]) for i in runs[0]["items"]}
    print(f"\n## 비결정성 ({len(runs)}회)")
    print("| 실행 | 문항 수 | 1회차와 다른 칸 |")
    print("|---|---:|---:|")
    for k, r in enumerate(runs, 1):
        cur = {i["no"]: _norm(i["written"]) for i in r["items"]}
        diff = sum(1 for n in set(base) | set(cur) if base.get(n) != cur.get(n))
        print(f"| {k} | {len(r['items'])} | {diff if k > 1 else '—'} |")
    unstable = [n for n in base
                if len({_norm(next((i["written"] for i in r["items"] if i["no"] == n), ""))
                        for r in runs}) > 1]
    if unstable:
        print(f"\n흔들린 문항: {', '.join(sorted(unstable, key=_numkey))}")
        print("→ 이 칸들은 확신도와 무관하게 검수로 보내는 것이 안전합니다.")


if __name__ == "__main__":
    main()
