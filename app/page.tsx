"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { createExam, listExams } from "@/lib/db/queries";
import type { ExamRow } from "@/lib/db/schema";

/** 시험 목록 · 새 시험 만들기. 조교의 하루가 여기서 시작합니다. */
export default function Home() {
  return <Gate>{(db, staff) => <Exams db={db} staff={staff} />}</Gate>;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function Exams({ db, staff }: { db: SupabaseClient; staff: Parameters<typeof Bar>[0]["staff"] }) {
  const [exams, setExams] = useState<ExamRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [className, setClassName] = useState("");
  const [examDate, setExamDate] = useState(today());
  const [cutLine, setCutLine] = useState("");
  const [strict, setStrict] = useState(false);

  useEffect(() => {
    listExams(db).then(setExams).catch((e) => setErr(String(e.message ?? e)));
  }, [db]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const row = await createExam(db, { title, className, examDate, cutLine, strictSpelling: strict });
      location.href = `/exams/${row.id}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-5 pb-24">
      <Bar db={db} staff={staff}>
        <a href="/quick" className="text-slate-500 underline">
          빠른 시험
        </a>
      </Bar>

      {err && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>}

      {!open ? (
        <button onClick={() => setOpen(true)} className="mb-6 rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white">
          새 시험 만들기
        </button>
      ) : (
        <form onSubmit={submit} className="mb-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-700">시험 이름</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: BOOSTER VOCA Day 12-14"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">반</span>
              <input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="예: 중3 A"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">날짜</span>
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">커트라인</span>
              <input
                value={cutLine}
                onChange={(e) => setCutLine(e.target.value)}
                placeholder="비워두면 시험지에서 읽습니다"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            커트라인은 <strong>비워두는 것이 기본</strong>입니다 — 시험지 머리말에서 읽습니다. 빨간펜이 머리말을
            덮어 안 읽힐 때만 넣으십시오. 한 반이 같은 값을 쓰므로 여기 한 번이면 됩니다.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
            <span>철자를 엄격히 본다</span>
            <span className="text-xs text-slate-500">(기본은 선생님들 채점 관행에 맞춘 관대)</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white disabled:opacity-40">
              {busy ? "만드는 중…" : "만들고 사진 올리기"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">
              취소
            </button>
          </div>
        </form>
      )}

      {exams === null ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : exams.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          아직 시험이 없습니다. 위에서 하나 만드십시오.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {exams.map((e) => (
            <li key={e.id}>
              <a href={`/exams/${e.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50">
                <div>
                  <p className="font-medium">{e.title || "(이름 없음)"}</p>
                  <p className="text-sm text-slate-500">
                    {[e.class_name, e.exam_date, e.cut_line, e.strict_spelling ? "철자 엄격" : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="text-slate-300">›</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
