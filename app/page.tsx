"use client";

import { useState } from "react";
import type { GradeResponse } from "@/app/api/grade/route";
import { prepareImage, rotateBy, type PreparedImage } from "@/lib/image";

/**
 * M1 1단계 — 사진 한 장을 채점해 화면에 띄웁니다.
 *
 * 아직 저장하지 않습니다. 배관이 도는지, 실제 답안지에서 무엇이 나오는지를
 * 눈으로 보는 것이 목적입니다. 여러 장·검수·명단은 2~4단계입니다.
 */
export default function Home() {
  // 한 학생의 답안지 사진들. **양면 인쇄면 앞·뒤 두 장입니다.**
  const [imgs, setImgs] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<GradeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [strict, setStrict] = useState(false);
  // 커트라인이 빨간펜에 가려 안 읽힐 때만 씁니다. 시험 하나에 한 번입니다.
  const [cutOverride, setCutOverride] = useState("");

  async function rotate(k: number, delta: 90 | -90) {
    const next = await rotateBy(imgs[k], delta);
    setImgs((p) => p.map((x, i) => (i === k ? next : x)));
    setRes(null);
  }

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    setRes(null);
    try {
      const prepared = await Promise.all([...files].map((f) => prepareImage(f)));
      setImgs((prev) => [...prev, ...prepared]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    if (!imgs.length) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: imgs.map((i) => ({ data: i.base64, mediaType: i.mediaType })),
          strictSpelling: strict,
          cutLineOverride: cutOverride,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      setRes(j as GradeResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const wrong = res?.results.filter((r) => !r.correct) ?? [];
  // 판정은 서버에서 계산한 것을 그대로 씁니다. 화면이 따로 계산하면 언젠가 어긋납니다.
  const cut = res?.cut ?? null;
  const v = res?.verdict ?? null;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-24">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">GradeSnap</h1>
        <p className="mt-1 text-sm text-slate-600">답안지를 찍어 올리면 채점합니다. (1단계 — 한 장, 저장 없음)</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">답안지 사진</span>
          <span className="mb-2 block text-xs text-slate-500">
            한 학생의 답안지입니다. <strong>양면이면 앞·뒤를 모두</strong> 올리십시오.
            순서는 상관없습니다 — 문항 번호로 합칩니다.
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            onChange={(e) => {
              void onPick(e.target.files);
              e.target.value = "";
            }}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white"
          />
        </label>

        {imgs.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap gap-3">
              {imgs.map((im, k) => (
                <figure key={k} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={im.objectUrl}
                    alt=""
                    className={`h-36 w-auto rounded-lg border object-contain ${
                      im.looksSideways ? "border-amber-400 border-2" : "border-slate-200"
                    }`}
                  />
                  <button
                    onClick={() => setImgs((p) => p.filter((_, i) => i !== k))}
                    className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs text-slate-600 shadow"
                    aria-label="빼기"
                  >
                    ✕
                  </button>
                  <figcaption className="mt-1 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <button onClick={() => void rotate(k, -90)} className="rounded border border-slate-300 px-1.5 py-0.5" aria-label="왼쪽으로 돌리기">
                      ↺
                    </button>
                    <span>
                      {k + 1}쪽 · {(im.bytes / 1024).toFixed(0)}KB
                    </span>
                    <button onClick={() => void rotate(k, 90)} className="rounded border border-slate-300 px-1.5 py-0.5" aria-label="오른쪽으로 돌리기">
                      ↻
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              모델이 볼 이미지입니다. 글씨가 읽히는지 확인하십시오.
            </p>
            {imgs.some((i) => i.looksSideways) && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                가로로 누운 사진이 있습니다. 답안지가 <strong>세워져 보이도록 돌려 주십시오.</strong>{" "}
                눕힌 채로도 읽기는 하지만 칸을 놓칠 수 있습니다.
              </p>
            )}

            <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
                <span>철자를 엄격히 본다</span>
                <span className="text-xs text-slate-500">(기본은 선생님들 채점에 맞춘 관대)</span>
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">커트라인 직접 입력</span>
                <span className="ml-2 text-xs text-slate-500">
                  머리말이 빨간펜에 가려 안 읽힐 때만. 시험 하나에 한 번이면 됩니다.
                </span>
                <input
                  value={cutOverride}
                  onChange={(e) => setCutOverride(e.target.value)}
                  placeholder="예: -8 까지 pass"
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </>
        )}

        <button
          onClick={run}
          disabled={!imgs.length || busy}
          className="mt-4 rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white disabled:opacity-40"
        >
          {busy ? `채점 중… (${imgs.length}장, 장당 20~40초)` : `채점 (${imgs.length}장)`}
        </button>
      </section>

      {err && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      )}

      {res && (
        <>
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">{res.transcript.sheet.title || "(제목 없음)"}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {[res.transcript.sheet.teacher, res.transcript.sheet.student, res.transcript.sheet.cutLine]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {v && (
                <span
                  className={`rounded-full px-3 py-1 text-sm font-bold ${
                    v === "pass" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {v === "pass" ? "PASS" : "FAIL"}
                </span>
              )}
              <span className="text-sm text-slate-700">
                오답 {wrong.length} / {res.results.length}
                {cut !== null && <span className="text-slate-500"> · 허용 {cut}</span>}
              </span>
              <span className="text-xs text-slate-500">
                ${res.costUsd.toFixed(3)} · {(res.usage.reduce((a, u) => a + u.latencyMs, 0) / 1000).toFixed(0)}초
              </span>
            </div>
            {res.missing > 0 && !res.robustToMissing && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                못 읽은 {res.missing}칸이 <strong>결과를 뒤집을 수 있어 PASS/FAIL을 내지 않았습니다.</strong>{" "}
                (다 틀렸다면 오답 {wrong.length + res.missing}개 &gt; 허용 {cut}개) 나머지를 올리거나 검수하십시오.
              </p>
            )}
            {res.missing > 0 && res.robustToMissing && (
              <p className="mt-2 rounded-lg bg-slate-100 p-2 text-sm text-slate-700">
                {res.missing}칸을 못 읽었지만 <strong>다 틀렸다고 쳐도 결과는 같아</strong> 그대로 판정했습니다.
                (최악 {wrong.length + res.missing}개 ≤ 허용 {cut}개)
              </p>
            )}
            {res.robustToMissing && cut === null && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                커트라인을 못 읽어 PASS/FAIL을 판정하지 않았습니다. 추측하면 학생이 잘못 남습니다.
                위 <strong>커트라인 직접 입력</strong>에 넣고 다시 채점하십시오.
              </p>
            )}
          </section>

          {res.warnings.length > 0 && (
            <section className="mt-4 space-y-2">
              {res.warnings.map((w, i) => (
                <p
                  key={i}
                  className={`rounded-lg border p-3 text-sm ${
                    w.level === "drift"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : w.level === "incomplete"
                        ? "border-rose-300 bg-rose-50 text-rose-900"
                        : "border-slate-200 bg-slate-100 text-slate-700"
                  }`}
                >
                  {w.level === "drift" ? "⚠️ " : w.level === "incomplete" ? "📄 " : "ℹ️ "}
                  {w.text}
                </p>
              ))}
            </section>
          )}

          <section className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="p-2 font-medium">번호</th>
                  <th className="p-2 font-medium">제시어</th>
                  <th className="p-2 font-medium">학생이 쓴 것</th>
                  <th className="p-2 font-medium">정답</th>
                  <th className="p-2 font-medium">판정</th>
                  <th className="p-2 font-medium">비고</th>
                </tr>
              </thead>
              <tbody>
                {res.transcript.items.map((it) => {
                  const j = res.results.find((r) => r.no === it.no);
                  return (
                    <tr key={it.no} className="border-t border-slate-100">
                      <td className="p-2 text-slate-500">{it.no}</td>
                      <td className="p-2">{it.prompt}</td>
                      <td className="p-2 font-medium">
                        {it.prefix && <span className="text-slate-400">{it.prefix}</span>}
                        {it.blank ? <span className="text-slate-400">(무응답)</span> : it.written.slice(it.prefix.length)}
                        {!it.legible && <span className="ml-1 text-xs text-amber-700">판독불가</span>}
                        {it.erased && <span className="ml-1 text-xs text-slate-400">지운 자국</span>}
                      </td>
                      <td className="p-2 text-slate-500">{j?.expected}</td>
                      <td className="p-2">{j?.correct ? "○" : <span className="font-bold text-rose-600">✗</span>}</td>
                      <td className="p-2 text-xs text-slate-500">{j?.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <p className="mt-4 text-xs text-slate-500">
            전사가 종이에 쓰인 것을 그대로 옮겼는지 확인하십시오. 오타를 실재 단어로 고쳐 읽는 경우가
            확인됐고, 확신도로는 걸러지지 않습니다.
          </p>
        </>
      )}
    </main>
  );
}
