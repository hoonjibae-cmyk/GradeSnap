"use client";

import { use, useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { confirmSheet, getSheet, itemsOf, pageUrls, setTeacherVerdict, unconfirmSheet } from "@/lib/db/queries";
import type { ItemRow, SheetRow, StaffRow } from "@/lib/db/schema";
import type { Verdict } from "@/lib/grading/types";

/**
 * 검수 화면 — **선생님이 확인하고 확정하는 곳**입니다.
 *
 * [13 §13.2](../../docs/13-phase1-plan.md)의 "선생님이 채점한다 → 선생님이
 * 확인한다"가 실제로 일어나는 화면이고, 여기서 고친 기록이 그대로
 * 정확도 데이터가 됩니다(`items.overturned`).
 */
export default function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Gate>{(db, staff) => <Review db={db} staff={staff} id={id} />}</Gate>;
}

function Review({ db, staff, id }: { db: SupabaseClient; staff: StaffRow; id: string }) {
  const [sheet, setSheet] = useState<SheetRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cutText, setCutText] = useState("");

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([getSheet(db, id), itemsOf(db, id)]);
    setSheet(s);
    setItems(i);
  }, [db, id]);

  useEffect(() => {
    void load().catch((e) => setErr(String(e.message ?? e)));
    // 사진은 서명 URL이라 따로, 실패해도 검수는 되게 둡니다.
    pageUrls(db, id)
      .then(setPhotos)
      .catch(() => {});
  }, [db, id, load]);

  /** 셈은 서버가 합니다. 화면이 따로 세면 언젠가 서버와 어긋납니다. */
  const recount = useCallback(
    async (cutLine?: string) => {
      const { data } = await db.auth.getSession();
      const r = await fetch(`/api/sheets/${id}/recount`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify(cutLine ? { cutLine } : {}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      await load();
    },
    [db, id, load],
  );

  async function mark(item: ItemRow, correct: boolean | null) {
    setBusy(true);
    setErr(null);
    try {
      await setTeacherVerdict(db, item.id, correct);
      await recount();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyCut() {
    setBusy(true);
    setErr(null);
    try {
      await recount(cutText);
      setCutText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finalize(v: Verdict) {
    setBusy(true);
    setErr(null);
    try {
      await confirmSheet(db, id, v);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) return <p className="p-6 text-sm text-slate-500">{err ?? "불러오는 중…"}</p>;

  const canConfirm = staff.role === "teacher" || staff.role === "admin";
  const confirmed = sheet.status === "confirmed";
  const v = sheet.final_verdict ?? sheet.verdict;
  const wrong = items.filter((i) => i.final_correct === false).length;
  const changed = items.filter((i) => i.overturned).length;
  const reviewed = items.filter((i) => i.teacher_correct !== null).length;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-24">
      <Bar db={db} staff={staff}>
        <a href="/" className="text-slate-500 underline">
          접수 목록
        </a>
      </Bar>

      {err && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="shrink-0 underline">
            닫기
          </button>
        </p>
      )}

      <header className="mb-4">
        <h1 className="text-xl font-bold">{sheet.student_name || "이름 못 읽음"}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {[sheet.title, sheet.class_name, new Date(sheet.created_at).toLocaleString("ko-KR")].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {v && (
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                v === "pass" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}
            >
              {v === "pass" ? "PASS" : "FAIL"}
              {confirmed && " · 확정"}
            </span>
          )}
          <span className="text-sm text-slate-700">
            오답 {wrong} / {items.length}
            {sheet.cut !== null && <span className="text-slate-500"> · 허용 {sheet.cut}</span>}
          </span>
          <span className="text-xs text-slate-500">
            ${Number(sheet.cost_usd ?? 0).toFixed(3)}
            {sheet.token_usage && ` · ${(sheet.token_usage.reduce((a, u) => a + u.latencyMs, 0) / 1000).toFixed(0)}초`}
          </span>
        </div>
      </header>

      {sheet.near_boundary && v && (
        <p className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          🔶 <strong>커트라인에 걸렸습니다 — 반드시 확인하십시오.</strong>
          <br />
          오답 {wrong}개 / 허용 {sheet.cut}개
          {sheet.margin === 0
            ? " — 여유가 없습니다. 한 문항만 더 틀렸으면 결과가 뒤집힙니다."
            : sheet.margin !== null && sheet.margin < 0
              ? ` — 여유 ${-sheet.margin}문항. 이 안에서 판정이 갈립니다.`
              : ""}
        </p>
      )}

      {sheet.status === "graded" && sheet.cut === null && (
        <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          커트라인을 못 읽어 <strong>PASS/FAIL을 내지 않았습니다.</strong> 시험지에 적힌 대로 넣어 주십시오 —
          다시 채점하지 않고 세기만 합니다.
          <div className="mt-2 flex gap-2">
            <input
              value={cutText}
              onChange={(e) => setCutText(e.target.value)}
              placeholder="예: -8 까지 pass"
              className="w-48 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
            />
            <button
              onClick={() => void applyCut()}
              disabled={busy || !cutText.trim()}
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
            >
              반영
            </button>
          </div>
        </div>
      )}

      {(sheet.warnings ?? []).map((w, i) => (
        <p
          key={i}
          className={`mb-2 rounded-lg border p-3 text-sm ${
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

      {photos.length > 0 && (
        <section className="mb-4 flex flex-wrap gap-3">
          {photos.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`${i + 1}쪽`} className="h-36 w-auto rounded-lg border border-slate-200 object-contain" />
            </a>
          ))}
          <p className="w-full text-xs text-slate-500">
            모델이 본 이미지입니다. 눌러서 크게 보고 <strong>전사가 종이와 같은지</strong> 확인하십시오.
          </p>
        </section>
      )}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
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
            {items.map((it) => (
              <tr key={it.id} className={`border-t border-slate-100 ${it.overturned ? "bg-sky-50" : ""}`}>
                <td className="p-2 text-slate-500">{it.no}</td>
                <td className="p-2">{it.prompt}</td>
                <td className="p-2 font-medium">
                  {it.prefix && <span className="text-slate-400">{it.prefix}</span>}
                  {it.blank ? (
                    <span className="text-slate-400">(무응답)</span>
                  ) : (
                    it.written.slice(it.prefix.length)
                  )}
                  {!it.legible && <span className="ml-1 text-xs text-amber-700">판독불가</span>}
                  {it.erased && <span className="ml-1 text-xs text-slate-400">지운 자국</span>}
                </td>
                <td className="p-2 text-slate-500">{it.expected}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void mark(it, true)}
                      disabled={busy || confirmed}
                      className={`h-7 w-7 rounded border text-sm ${
                        it.final_correct
                          ? "border-emerald-500 bg-emerald-500 font-bold text-white"
                          : "border-slate-300 text-slate-400"
                      } disabled:opacity-40`}
                      aria-label="정답"
                    >
                      ○
                    </button>
                    <button
                      onClick={() => void mark(it, false)}
                      disabled={busy || confirmed}
                      className={`h-7 w-7 rounded border text-sm ${
                        it.final_correct === false
                          ? "border-rose-500 bg-rose-500 font-bold text-white"
                          : "border-slate-300 text-slate-400"
                      } disabled:opacity-40`}
                      aria-label="오답"
                    >
                      ✗
                    </button>
                    {it.teacher_correct !== null && !confirmed && (
                      <button
                        onClick={() => void mark(it, null)}
                        disabled={busy}
                        className="ml-1 text-[11px] text-slate-400 underline"
                        title="시스템 판정으로 되돌립니다"
                      >
                        되돌리기
                      </button>
                    )}
                  </div>
                </td>
                <td className="p-2 text-xs text-slate-500">
                  {it.overturned && <span className="mr-1 font-medium text-sky-700">고침</span>}
                  {it.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-3 text-xs text-slate-500">
        검수 {reviewed} / {items.length} · 고친 것 {changed}
        {" — "}
        전사가 종이에 쓰인 것을 그대로 옮겼는지 보십시오. <strong>오타를 실재 단어로 고쳐 읽는 경우</strong>가
        확인됐고 확신도로는 걸러지지 않습니다.
      </p>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        {confirmed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              <strong>확정됐습니다.</strong> 이 결과가 명단에 나갑니다.
            </p>
            {canConfirm && (
              <button
                onClick={() => void unconfirmSheet(db, id).then(load)}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              >
                확정 취소
              </button>
            )}
          </div>
        ) : !canConfirm ? (
          <p className="text-sm text-slate-600">
            문항은 고칠 수 있지만 <strong>확정은 선생님이 합니다.</strong> 학생을 재시험에 남기는 결정이라
            그렇습니다.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-700">
              확인이 끝났으면 확정하십시오. <strong>확정한 것만 명단에 나갑니다.</strong>
              {v && (
                <span className="text-slate-500">
                  {" "}
                  시스템 판정은 {v === "pass" ? "PASS" : "FAIL"}입니다.
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void finalize("pass")}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white disabled:opacity-40"
              >
                PASS로 확정
              </button>
              <button
                onClick={() => void finalize("fail")}
                disabled={busy}
                className="rounded-lg bg-rose-600 px-5 py-2.5 font-medium text-white disabled:opacity-40"
              >
                FAIL로 확정
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
