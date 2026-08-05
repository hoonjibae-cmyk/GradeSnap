#!/usr/bin/env python3
"""
GradeSnap · 손글씨 인식 벤치마크 (Phase 0.2)

`make_crops.py`가 만든 매니페스트(truth·grade 기입 완료)를 받아
같은 crop 세트에 여러 인식 방식을 나란히 돌리고, **필체 등급별로** 집계합니다.

핵심 가설 — "정답을 알고 읽으면 정확도가 달라진다".
그 대가로 **관대함(학생이 틀리게 썼는데 정답으로 읽어버림)** 이 생깁니다.
이 도구는 그 이득과 대가를 같은 표에서 보여주는 것이 목적입니다.

인식 방식(mode)
    blind       아무 힌트 없이 읽는다                      (기준선)
    prefix      인쇄된 첫 글자만 알려준다                   (로드맵 0.2 1순위)
    candidates  이 칸의 정답 후보를 알려준다                 (실서비스 방식)
    pool        시험지 전체 정답을 섞어서 후보로 준다         (정답 지목 없이 어휘만 제한)

사용법
    # 1) 라벨 채운 매니페스트로 실행
    python3 tools/bench_ocr.py --manifest manifest.csv --modes blind,prefix,candidates

    # 2) 대량이면 Batch API (비용 50%, 대신 응답시간 측정 불가)
    python3 tools/bench_ocr.py --manifest manifest.csv --batch

    # 3) 저장된 결과만 다시 집계
    python3 tools/bench_ocr.py --manifest manifest.csv --report-only

매니페스트 필수 열: crop, answer, candidates, truth, grade
    truth  학생이 실제로 쓴 글자 (무응답이면 빈칸)
    grade  good | fair | poor | blank
    prefix (선택) 인쇄되어 있는 첫 글자. 없으면 prefix 모드는 건너뜁니다.

의존성: pip install anthropic pillow
"""

import argparse
import base64
import csv
import io
import json
import os
import re
import statistics
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

try:
    import anthropic
except ImportError:
    sys.exit("anthropic SDK가 필요합니다:  pip install anthropic")

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  pip install pillow")


MODES = ("blind", "prefix", "candidates", "pool")
GRADES = ("good", "fair", "poor", "blank")

# 1M 토큰당 달러. claude-api 스킬 기준(2026-06-24 캐시).
# sonnet-5는 2026-08-31까지 도입가 $2/$10 — 만료 후 $3/$15로 고쳐야 합니다.
PRICING = {
    "claude-opus-5":      (5.00, 25.00),
    "claude-sonnet-5":    (2.00, 10.00),
    "claude-haiku-4-5":   (1.00,  5.00),
}

# 답안 crop은 원래 작습니다. 확대는 하지 않고, 큰 것만 줄여 비용을 억제합니다.
MAX_EDGE = 1568

SCHEMA = {
    "type": "object",
    "properties": {
        "text": {
            "type": "string",
            "description": "학생이 손으로 쓴 글자 그대로. 무응답이면 빈 문자열.",
        },
        "legible": {
            "type": "boolean",
            "description": "읽을 수 있으면 true. 글자가 있으나 판독 불가면 false.",
        },
        "confidence": {
            "type": "number",
            "description": "0.0~1.0. 읽은 결과가 맞다고 보는 정도.",
        },
    },
    "required": ["text", "legible", "confidence"],
    "additionalProperties": False,
}

SYSTEM = """당신은 손글씨 답안을 **옮겨 적는** 역할입니다. 채점하지 않습니다.

규칙
1. 학생이 쓴 그대로 옮깁니다. 철자가 틀렸으면 틀린 채로 옮깁니다.
2. 정답을 알려주더라도 그것에 맞춰 고치지 마십시오. 학생이 'hesitage'라고 썼으면
   정답이 'heritage'여도 'hesitage'입니다. 임의로 고치는 것은 오채점입니다.
3. 인쇄된 글자(첫 글자 안내, 밑줄, 문항 번호, 격자선)는 답에 포함하지 않습니다.
   단, 첫 글자가 인쇄되어 있으면 그 글자를 포함한 완성된 단어를 적습니다.
4. 글자가 있는데 무엇인지 못 읽겠으면 legible=false로 두고, 추측하지 마십시오.
   빈칸(아무것도 안 씀)은 legible=true, text=""입니다.
5. 지우고 다시 쓴 흔적이 있으면 **최종적으로 남긴 글자**를 옮깁니다."""


# ── 매니페스트 ────────────────────────────────────────────────────────────

def load_manifest(path, limit=None):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    labeled, skipped, pending = [], 0, 0
    for i, r in enumerate(rows):
        g = (r.get("grade") or "").strip().lower()
        if g not in GRADES:
            skipped += 1
            continue
        if g != "blank" and not (r.get("truth") or "").strip():
            # fill_truth.py가 '사람이 적어야 할 오답 칸'으로 비워 둔 행.
            # 빈 문자열을 무응답으로 취급하면 오인식률이 통째로 거짓말이 됩니다.
            pending += 1
            continue
        r["_id"] = f"r{i:04d}"
        r["grade"] = g
        r["truth"] = (r.get("truth") or "").strip()
        r["truth_source"] = (r.get("truth_source") or "typed").strip()
        labeled.append(r)

    if skipped:
        print(f"⚠️  grade 미기입 {skipped}행은 제외했습니다 (라벨 없는 행은 측정 불가).")
    if pending:
        print(f"⚠️  truth 미기입 {pending}행은 제외했습니다 — **대부분 오답 칸입니다.**\n"
              f"    오답을 빼고 재면 관대함이 안 보입니다. "
              f"`fill_truth.py --todo`로 채운 뒤 다시 돌리십시오.")
    return labeled[:limit] if limit else labeled


def accepted_set(row):
    """정답으로 인정되는 표기들. candidates 열이 canonical|accepted 형식."""
    raw = row.get("candidates") or row.get("answer") or ""
    return {c.strip() for c in raw.split("|") if c.strip()}


# ── 프롬프트 ─────────────────────────────────────────────────────────────

def build_prompt(row, mode, pool):
    lang = "한글" if _has_hangul(row.get("answer", "")) else "영어"
    lines = [f"답안 칸 하나를 잘라낸 이미지입니다. {lang} 손글씨를 옮겨 적으십시오."]

    if mode == "prefix":
        p = (row.get("prefix") or "").strip()
        lines.append(f"이 칸은 첫 글자 '{p}'가 인쇄되어 있습니다. "
                     f"'{p}'로 시작하는 완성된 단어를 적으십시오.")
    elif mode == "candidates":
        cands = sorted(accepted_set(row))
        lines.append("참고로 이 칸의 정답은 다음과 같습니다: " + ", ".join(cands))
        lines.append("정답과 다르게 썼다면 **다르게 쓴 그대로** 옮기십시오. "
                     "정답에 맞춰 고치면 안 됩니다.")
    elif mode == "pool":
        lines.append("이 시험지에 나오는 정답 목록입니다(이 칸의 정답이 무엇인지는 "
                     "알려주지 않습니다): " + ", ".join(pool))
        lines.append("목록에 없는 글자를 썼을 수도 있습니다. 쓴 그대로 옮기십시오.")

    return "\n".join(lines)


def _has_hangul(s):
    return any("가" <= c <= "힣" for c in s)


def encode_image(path):
    img = Image.open(path)
    if max(img.size) > MAX_EDGE:
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode()


def build_params(row, mode, pool, model, thinking):
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                     "data": encode_image(row["crop"])}},
        {"type": "text", "text": build_prompt(row, mode, pool)},
    ]
    params = {
        "model": model,
        "max_tokens": 2000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": content}],
        "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}},
    }
    if not thinking:
        # 전사 작업에 사고 과정은 비용·지연만 늘립니다. effort는 high 이하여야 disabled가 허용됩니다.
        params["thinking"] = {"type": "disabled"}
        params["output_config"]["effort"] = "low"
    return params


def parse_reply(msg):
    text = next((b.text for b in msg.content if b.type == "text"), "")
    try:
        d = json.loads(text)
    except json.JSONDecodeError:
        return {"text": "", "legible": False, "confidence": 0.0, "parse_error": text[:200]}
    return {"text": str(d.get("text", "")), "legible": bool(d.get("legible", False)),
            "confidence": float(d.get("confidence", 0.0))}


# ── 실행 ─────────────────────────────────────────────────────────────────

def run_sync(client, rows, mode, pool, model, thinking, workers):
    def one(row):
        params = build_params(row, mode, pool, model, thinking)
        t0 = time.perf_counter()
        try:
            msg = client.messages.create(**params)
        except Exception as e:                       # noqa: BLE001 — 한 건 실패로 전체를 멈추지 않는다
            return {"id": row["_id"], "mode": mode, "error": str(e)[:300],
                    "text": "", "legible": False, "confidence": 0.0,
                    "latency_ms": 0, "in_tok": 0, "out_tok": 0}
        out = parse_reply(msg)
        out.update(id=row["_id"], mode=mode,
                   latency_ms=round((time.perf_counter() - t0) * 1000),
                   in_tok=msg.usage.input_tokens, out_tok=msg.usage.output_tokens)
        return out

    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(one, rows))
    return results


def run_batch(client, rows, mode, pool, model, thinking):
    """Batch API — 비용 50%. 대신 응답시간은 측정 대상에서 빠집니다."""
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    reqs = [Request(custom_id=f"{mode}__{r['_id']}",
                    params=MessageCreateParamsNonStreaming(
                        **build_params(r, mode, pool, model, thinking)))
            for r in rows]
    batch = client.messages.batches.create(requests=reqs)
    print(f"  batch {batch.id} 제출 ({len(reqs)}건) — 완료까지 보통 1시간 이내")

    while True:
        b = client.messages.batches.retrieve(batch.id)
        if b.processing_status == "ended":
            break
        print(f"  …{b.request_counts.processing}건 처리 중", end="\r", flush=True)
        time.sleep(30)

    results = []
    for res in client.messages.batches.results(batch.id):
        rid = res.custom_id.split("__", 1)[1]
        if res.result.type != "succeeded":
            results.append({"id": rid, "mode": mode, "error": res.result.type,
                            "text": "", "legible": False, "confidence": 0.0,
                            "latency_ms": None, "in_tok": 0, "out_tok": 0})
            continue
        msg = res.result.message
        out = parse_reply(msg)
        out.update(id=rid, mode=mode, latency_ms=None,
                   in_tok=msg.usage.input_tokens, out_tok=msg.usage.output_tokens,
                   batched=True)
        results.append(out)
    return results


# ── 채점 비교 ────────────────────────────────────────────────────────────

def norm(s):
    """표기 비교용 정규화 — 공백·대소문자·유니코드 형태만 통일합니다.

    철자는 절대 건드리지 않습니다. 여기서 관대해지면 벤치마크가 거짓말을 합니다.
    """
    s = unicodedata.normalize("NFKC", (s or "")).strip().lower()
    return re.sub(r"[\s\u200b]+", " ", s)


def score(rows, results):
    by_id = {r["_id"]: r for r in rows}
    scored = []
    for res in results:
        row = by_id[res["id"]]
        truth, pred = norm(row["truth"]), norm(res["text"])
        ok_set = {norm(c) for c in accepted_set(row)}

        # 사람이 본 정오 vs 인식 결과로 매긴 정오. 이 둘이 갈리면 오채점입니다.
        truth_correct = bool(truth) and truth in ok_set
        pred_correct = bool(pred) and pred in ok_set

        scored.append({
            **res,
            "grade": row["grade"],
            "truth": row["truth"],
            # fill_truth.py가 '선생님이 정답 처리했으니 정답을 썼겠지'로 채운 라벨.
            # 인식기와 어긋나면 라벨 쪽이 틀렸을 수도 있어 따로 셉니다.
            "assumed": row.get("truth_source") == "assumed",
            "exact": truth == pred,
            "truth_correct": truth_correct,
            "pred_correct": pred_correct,
            "unreadable": not res.get("legible", False),
            # 오인식 = 읽었다고 하면서 다르게 읽은 것. 판독불가는 여기 안 들어갑니다.
            "misread": res.get("legible", False) and truth != pred,
            "lenient": (not truth_correct) and pred_correct,   # 틀린 답을 맞다고 → 치명적
            "harsh": truth_correct and (not pred_correct),     # 맞은 답을 틀리다고
            "error": res.get("error"),
        })
    return scored


def cost_usd(scored, model, batched=False):
    pin, pout = PRICING.get(model, (0.0, 0.0))
    i = sum(s["in_tok"] for s in scored)
    o = sum(s["out_tok"] for s in scored)
    c = (i * pin + o * pout) / 1_000_000
    return c * 0.5 if batched else c


# ── 리포트 ───────────────────────────────────────────────────────────────

def pct(n, d):
    return "—" if not d else f"{100*n/d:5.1f}%"


def mode_order(all_scored):
    """실행한 순서대로 보여줍니다 — blind가 기준선이라 먼저 나와야 읽힙니다."""
    seen = []
    for s in all_scored:
        if s["mode"] not in seen:
            seen.append(s["mode"])
    return seen


def report(all_scored, model, batched):
    for mode in mode_order(all_scored):
        rows = [s for s in all_scored if s["mode"] == mode]
        print(f"\n### {mode}  ({len(rows)}건)")
        print("| 필체 | 건수 | 정확도 | 판독불가 | **오인식** | 관대오류 | 엄격오류 | 응답시간 |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|")

        for g in GRADES + ("전체",):
            sub = rows if g == "전체" else [s for s in rows if s["grade"] == g]
            if not sub:
                continue
            lat = [s["latency_ms"] for s in sub if s.get("latency_ms")]
            n = len(sub)
            print(f"| {g} | {n} | {pct(sum(s['exact'] for s in sub), n)} "
                  f"| {pct(sum(s['unreadable'] for s in sub), n)} "
                  f"| **{pct(sum(s['misread'] for s in sub), n)}** "
                  f"| {pct(sum(s['lenient'] for s in sub), n)} "
                  f"| {pct(sum(s['harsh'] for s in sub), n)} "
                  f"| {f'{statistics.median(lat)/1000:.1f}s' if lat else '—'} |")

        susp = [s for s in rows if s["assumed"] and not s["exact"]]
        if susp:
            print(f"\n※ 자동으로 채운 라벨 중 {len(susp)}건이 인식 결과와 어긋납니다. "
                  f"인식 오류일 수도, 라벨 오류일 수도 있으니 이 {len(susp)}건만 실물과 대조하십시오.")

        c = cost_usd(rows, model, batched)
        errs = sum(1 for s in rows if s.get("error"))
        print(f"\n비용 ${c:.3f} · 건당 ${c/max(len(rows),1):.5f}"
              + (" (batch 50% 적용)" if batched else "")
              + (f" · API 실패 {errs}건" if errs else ""))

        gate(rows)


def gate(rows):
    """Phase 1 착수 기준 — 영단어 정확도 95% 이상 & 오인식률 1% 미만."""
    real = [s for s in rows if s["grade"] != "blank"]
    if not real:
        return
    acc = sum(s["exact"] for s in real) / len(real)
    mis = sum(s["misread"] for s in real) / len(real)
    ok = acc >= 0.95 and mis < 0.01
    print(f"Phase 1 기준: 정확도 {acc*100:.1f}% (≥95%) · 오인식률 {mis*100:.2f}% (<1%) "
          f"→ {'통과' if ok else '미달'}")


def leniency_report(all_scored):
    """정답과 다르게 쓴 답안만 모아, 인식기가 정답으로 '고쳐 읽는지' 봅니다."""
    print("\n## 관대함 테스트 (로드맵 0.4)")
    print("학생이 정답과 다르게 쓴 답안에서, 인식기가 정답으로 읽어버린 비율입니다.")
    print("이 비율이 높으면 '정답을 알려주고 읽히는' 방식을 그대로 쓸 수 없습니다.")
    print("\n| 방식 | 오답 건수 | 정답으로 읽음 | 예시 (실제 → 인식) |")
    print("|---|---:|---:|---|")
    for mode in mode_order(all_scored):
        # 학생이 무언가 썼는데 정답이 아닌 건들. 무응답(빈칸)은 제외합니다.
        tgt = [s for s in all_scored
               if s["mode"] == mode and s["truth"] and not s["truth_correct"]]
        snapped = [s for s in tgt if s["pred_correct"]]
        eg = ", ".join(f"{s['truth']}→{s['text']}" for s in snapped[:3]) or "—"
        print(f"| {mode} | {len(tgt)} | {len(snapped)} ({pct(len(snapped), len(tgt)).strip()}) | {eg} |")


# ── main ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="손글씨 인식 벤치마크")
    ap.add_argument("--manifest", required=True, help="truth·grade를 채운 매니페스트 CSV")
    ap.add_argument("--modes", default="blind,candidates",
                    help=f"쉼표 구분. 가능: {','.join(MODES)}")
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--batch", action="store_true", help="Batch API 사용 (비용 50%%)")
    ap.add_argument("--thinking", action="store_true", help="사고 과정 켜기 (기본: 끔)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, help="앞에서 N건만")
    ap.add_argument("--out", default="bench_results.json")
    ap.add_argument("--report-only", action="store_true", help="--out 파일만 다시 집계")
    a = ap.parse_args()

    rows = load_manifest(a.manifest, a.limit)
    if not rows:
        sys.exit("라벨(grade)이 채워진 행이 없습니다. 매니페스트를 먼저 채우십시오.")

    if a.report_only:
        with open(a.out, encoding="utf-8") as f:
            saved = json.load(f)
        report(saved["scored"], saved["model"], saved["batched"])
        leniency_report(saved["scored"])
        return

    modes = [m.strip() for m in a.modes.split(",") if m.strip()]
    bad = [m for m in modes if m not in MODES]
    if bad:
        sys.exit(f"알 수 없는 mode: {bad}. 가능: {', '.join(MODES)}")
    if "prefix" in modes and not any((r.get("prefix") or "").strip() for r in rows):
        print("⚠️  prefix 열이 비어 있어 prefix 모드를 건너뜁니다.")
        modes.remove("prefix")

    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")):
        sys.exit("ANTHROPIC_API_KEY가 필요합니다.")
    client = anthropic.Anthropic()

    pool = sorted({c for r in rows for c in accepted_set(r)})
    print(f"crop {len(rows)}건 · 방식 {len(modes)}가지 · 모델 {a.model}")
    print(f"필체 분포: " + " ".join(
        f"{g}={sum(1 for r in rows if r['grade']==g)}" for g in GRADES))

    all_scored = []
    for mode in modes:
        print(f"\n▶ {mode} 실행 중…")
        results = (run_batch(client, rows, mode, pool, a.model, a.thinking) if a.batch
                   else run_sync(client, rows, mode, pool, a.model, a.thinking, a.workers))
        all_scored += score(rows, results)

    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"model": a.model, "batched": a.batch, "scored": all_scored},
                  f, ensure_ascii=False, indent=1)

    report(all_scored, a.model, a.batch)
    leniency_report(all_scored)
    print(f"\n원자료 → {a.out}")


if __name__ == "__main__":
    main()
