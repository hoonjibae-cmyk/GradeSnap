#!/usr/bin/env python3
"""
GradeSnap · 벤치마크 일괄 실행 (Phase 0)

채점 전/후 사진이 든 폴더 하나를 주면 전부 돌려 표를 냅니다.
재는 것은 하나입니다 — **선생님 채점과 몇 % 일치하는가.**
배경은 [12 §12.8](../docs/12-page-level-grading.md).

사진 짝짓기
    파일명을 정렬해 두 장씩 묶습니다 (IMG_2165/IMG_2166 처럼 연번으로 찍힌 것을 전제).
    둘 중 어느 쪽이 '채점 후'인지는 **빨간펜 양으로 판별**합니다.
    사람이 파일명을 고칠 필요가 없습니다.

사용법
    export ANTHROPIC_API_KEY=...
    python3 tools/run_bench.py --dir samples/ --out bench/

    # 짝짓기만 확인하고 API는 안 부름 (돈 쓰기 전에 먼저 이걸 돌리십시오)
    python3 tools/run_bench.py --dir samples/ --dry-run

    # 한 쌍만
    python3 tools/run_bench.py --before a.jpg --after b.jpg

의존성: pip install anthropic pillow
"""

import argparse
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grade_page as G

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  pip install pillow")

IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".heic")


def red_ratio(path):
    """빨간펜이 차지하는 비율. 채점 후 사진이 채점 전보다 반드시 높습니다."""
    im = Image.open(path).convert("RGB")
    im.thumbnail((400, 400))
    b = im.tobytes()
    red = sum(1 for i in range(0, len(b), 3)
              if b[i] > 110 and b[i] > b[i+1] * 1.45 and b[i] > b[i+2] * 1.45)
    return red / max(len(b) // 3, 1)


def pair_up(paths):
    """정렬 후 두 장씩 묶고, 빨간펜이 많은 쪽을 '채점 후'로 놓습니다."""
    pairs, leftover = [], None
    if len(paths) % 2:
        leftover = paths[-1]
        paths = paths[:-1]
    for a, b in zip(paths[::2], paths[1::2]):
        ra, rb = red_ratio(a), red_ratio(b)
        before, after = (a, b) if ra <= rb else (b, a)
        pairs.append({"before": before, "after": after,
                      "red": (round(min(ra, rb), 4), round(max(ra, rb), 4))})
    return pairs, leftover


def run_pair(client, args, pair):
    """한 쌍 처리. 실패해도 나머지 쌍은 계속 돌립니다."""
    think = not args.no_thinking
    t, usages = G.transcribe(client, args.model, pair["before"], args.split,
                             args.effort, think)
    warn = G.check_drift(t)
    m, um = G.read_marks(client, args.model, pair["after"], args.effort, think)
    j, uj = G.judge(client, args.model, t, None, args.strict, args.effort, think)
    cmp_ = G.compare(j, m)
    return {
        "pair": pair, "sheet": t["sheet"], "n_items": len(t["items"]),
        "warn": warn, "marks": m, "compare": cmp_,
        "cost": G.cost_usd(usages + [um, uj], args.model),
        "transcript": t, "judged": j,
    }


def summarize(results):
    print("\n" + "=" * 78)
    print("## 결과 — 선생님 채점과의 일치율")
    print("| # | 시험지 | 문항 | 일치율 | 우리만 오답 | **놓친 오답** | 밀림 | 비용 |")
    print("|---|---|---:|---:|---:|---:|:--:|---:|")
    tot_n = tot_agree = tot_missed = tot_strict = drifted = 0
    cost = 0.0
    for i, r in enumerate(results, 1):
        if r.get("error"):
            print(f"| {i} | (실패) | — | — | — | — | — | — |")
            continue
        c, s = r["compare"], r["sheet"]
        title = (s.get("title") or "?")[:26]
        tot_n += c["n"]; tot_agree += c["agree"]
        tot_missed += len(c["theirs_only"]); tot_strict += len(c["ours_only"])
        drifted += 1 if r["warn"] else 0
        cost += r["cost"]
        print(f"| {i} | {title} | {c['n']} | {c['rate']*100:.1f}% "
              f"| {len(c['ours_only'])} | **{len(c['theirs_only'])}** "
              f"| {'⚠️' if r['warn'] else '–'} | ${r['cost']:.3f} |")

    if not tot_n:
        print("\n집계할 결과가 없습니다.")
        return
    rate = tot_agree / tot_n
    missed = tot_missed / tot_n
    print(f"| | **합계** | {tot_n} | **{rate*100:.1f}%** | {tot_strict} "
          f"| **{tot_missed}** | {drifted}장 | ${cost:.2f} |")

    print(f"\n## Phase 1 착수 기준")
    for label, val, ok in (
        ("선생님 채점 일치율 ≥ 95%", f"{rate*100:.1f}%", rate >= 0.95),
        ("놓친 오답 < 1%", f"{missed*100:.2f}% ({tot_missed}건)", missed < 0.01),
        ("밀림 경보 0장", f"{drifted}장", drifted == 0),
    ):
        print(f"  {'✅' if ok else '❌'} {label:<26} → {val}")

    print("\n※ '우리만 오답'은 대부분 **선생님의 철자 관대 채점**입니다"
          " (12 §12.6). 채점 규칙으로 흡수할 수 있어 치명적이지 않습니다.")
    print("   '놓친 오답'이 진짜 손해입니다 — 선생님은 틀렸다는데 우리가 맞다고 한 것입니다.")

    detail = [(i, r) for i, r in enumerate(results, 1)
              if not r.get("error") and (r["compare"]["theirs_only"] or r["warn"])]
    if detail:
        print("\n## 들여다볼 것")
        for i, r in detail:
            c = r["compare"]
            if c["theirs_only"]:
                print(f"  {i}. 놓친 오답 {', '.join(c['theirs_only'])}번 "
                      f"— 선생님 표기 {r['marks']['score_text'] or '없음'}")
                for no in c["theirs_only"][:5]:
                    it = next((x for x in r["transcript"]["items"] if x["no"] == no), {})
                    print(f"       {no}. {it.get('prompt','')!r} ← 학생 {it.get('written','')!r}")
            for w in r["warn"]:
                print(f"  {i}. ⚠️ {w}")


def main():
    ap = argparse.ArgumentParser(description="채점 전/후 사진 폴더를 통째로 벤치마크")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--dir", help="사진 폴더 (전/후가 연번으로 들어 있어야 함)")
    src.add_argument("--before", help="한 쌍만: 채점 전 사진")
    ap.add_argument("--after", help="한 쌍만: 채점 후 사진")
    ap.add_argument("--model", default=G.DEFAULT_MODEL)
    ap.add_argument("--effort", default="high",
                    choices=["low", "medium", "high", "xhigh", "max"])
    ap.add_argument("--split", type=int, default=1, help="글씨가 작으면 2~4")
    ap.add_argument("--strict", action="store_true", help="철자를 엄격히 본다")
    ap.add_argument("--no-thinking", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="짝짓기만 확인하고 API는 부르지 않는다")
    ap.add_argument("--out", default="bench", help="원자료 저장 폴더")
    a = ap.parse_args()

    if a.before:
        if not a.after:
            sys.exit("--before를 쓰면 --after도 필요합니다.")
        pairs = [{"before": a.before, "after": a.after, "red": None}]
        leftover = None
    else:
        files = sorted(os.path.join(a.dir, n) for n in os.listdir(a.dir)
                       if n.lower().endswith(IMG_EXT))
        if len(files) < 2:
            sys.exit(f"{a.dir}에 사진이 2장 이상 있어야 합니다.")
        pairs, leftover = pair_up(files)

    print(f"{len(pairs)}쌍")
    for i, p in enumerate(pairs, 1):
        r = f"  빨간펜 {p['red'][0]:.3%} → {p['red'][1]:.3%}" if p["red"] else ""
        print(f"  {i}. 전 {os.path.basename(p['before']):<34} "
              f"후 {os.path.basename(p['after'])}{r}")
    if leftover:
        print(f"  ⚠️  짝이 없어 제외: {os.path.basename(leftover)}")

    if a.dry_run:
        print("\n짝짓기가 맞는지 확인하십시오. '후'가 빨간펜 있는 쪽이어야 합니다.")
        print("틀렸으면 --before/--after로 한 쌍씩 돌리십시오.")
        return

    client = G.client_or_die()
    os.makedirs(a.out, exist_ok=True)
    results = []
    for i, p in enumerate(pairs, 1):
        print(f"\n▶ {i}/{len(pairs)}  {os.path.basename(p['before'])} …", flush=True)
        try:
            r = run_pair(client, a, p)
            c = r["compare"]
            print(f"   {r['sheet'].get('title','?')[:40]} · 문항 {r['n_items']} "
                  f"· 일치 {c['agree']}/{c['n']} ({c['rate']*100:.1f}%) · ${r['cost']:.3f}")
            for w in r["warn"]:
                print(f"   ⚠️  {w}")
        except Exception as e:                       # noqa: BLE001 — 한 쌍 실패로 전체를 멈추지 않는다
            print(f"   ❌ 실패: {type(e).__name__}: {str(e)[:200]}")
            traceback.print_exc(limit=2)
            r = {"pair": p, "error": str(e)[:500]}
        results.append(r)
        with open(os.path.join(a.out, f"pair{i:02d}.json"), "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False, indent=1)

    summarize(results)
    print(f"\n원자료 → {a.out}/")


if __name__ == "__main__":
    main()
