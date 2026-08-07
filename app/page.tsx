"use client";

import { useState } from "react";
import type { GradeResponse } from "@/app/api/grade/route";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { parseCut, verdict } from "@/lib/grading/cutline";

/**
 * M1 1단계 — 사진 한 장을 채점해 화면에 띄웁니다.
 *
 * 아직 저장하지 않습니다. 배관이 도는지, 실제 답안지에서 무엇이 나오는지를
 * 눈으로 보는 것이 목적입니다. 여러 장·검수·명단은 2~4단계입니다.
 */
export default function Home() {
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<GradeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [strict, setStrict] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setRes(null);
    try {
      setImg(await prepareImage(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    if (!img) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: img.base64, mediaType: img.mediaType, strictSpelling: strict }),
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
  const cut = res ? parseCut(res.transcript.sheet.cutLine, res.results.length) : null;
  const v = res ? verdict(wrong.length, cut) : null;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-24">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">GradeSnap</h1>
        <p className="mt-1 text-sm text-slate-600">답안지를 찍어 올리면 채점합니다. (1단계 — 한 장, 저장 없음)</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium">채점 전 답안지 사진</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onPick(e.target.files?.[0])}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white"
          />
        </label>

        {img && (
          <div className="mt-4 flex gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.objectUrl} alt="" className="h-40 w-auto rounded-lg border border-slate-200 object-contain" />
            <div className="text-sm text-slate-600">
              <p>
                {img.width}×{img.height} · {(img.bytes / 1024).toFixed(0)}KB
              </p>
              <p className="mt-1 text-xs text-slate-500">모델이 볼 이미지입니다. 글씨가 읽히는지 확인하십시오.</p>
              <label className="mt-3 flex items-center gap-2">
                <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
                <span>철자를 엄격히 본다</span>
              </label>
              <p className="mt-1 text-xs text-slate-500">
                선생님들은 지금 한 글자 오타를 정답 처리합니다. 기본은 그에 맞춘 관대입니다.
              </p>
            </div>
          </div>
        )}

        <button
          onClick={run}
          disabled={!img || busy}
          className="mt-4 rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white disabled:opacity-40"
        >
          {busy ? "채점 중… (20~40초)" : "채점"}
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
            {cut === null && (
              <p className="mt-2 text-sm text-amber-700">
                커트라인을 못 읽어 PASS/FAIL을 판정하지 않았습니다. 추측하면 학생이 잘못 남습니다.
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
                      : "border-slate-200 bg-slate-100 text-slate-700"
                  }`}
                >
                  {w.level === "drift" ? "⚠️ " : "ℹ️ "}
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
