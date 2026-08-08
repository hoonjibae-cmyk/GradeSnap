"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { deleteSheet, getExam, listSheets, progress, retrySheet, uploadSheet } from "@/lib/db/queries";
import type { ExamProgressRow, ExamRow, SheetRow, StaffRow } from "@/lib/db/schema";
import { defaultBreaks, groupsOf } from "@/lib/grouping";
import { prepareImage, rotateBy, type PreparedImage } from "@/lib/image";

/** 동시에 몇 장을 채점할지. 넷이면 20명 2쪽이 6분 반입니다(docs/13 §13.8). */
const LANES = 4;

export default function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Gate>{(db, staff) => <Exam db={db} staff={staff} examId={id} />}</Gate>;
}

function Exam({ db, staff, examId }: { db: SupabaseClient; staff: StaffRow; examId: string }) {
  const [exam, setExam] = useState<ExamRow | null>(null);
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [prog, setProg] = useState<ExamProgressRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  // 채점 루프가 도는 동안 다시 시작하지 않도록. state는 루프 안에서 낡습니다.
  const running = useRef(false);

  const refresh = useCallback(async () => {
    const [s, p] = await Promise.all([listSheets(db, examId), progress(db, examId)]);
    setSheets(s);
    setProg(p);
    return p;
  }, [db, examId]);

  useEffect(() => {
    getExam(db, examId).then(setExam).catch((e) => setErr(String(e.message ?? e)));
    void refresh().catch((e) => setErr(String(e.message ?? e)));
  }, [db, examId, refresh]);

  // 채점이 도는 동안만 3초마다 봅니다. 다 끝나면 조용해집니다.
  useEffect(() => {
    if (!prog?.pending) return;
    const t = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [prog?.pending, refresh]);

  /**
   * 큐 드라이버. **이게 전부입니다** — 네 갈래가 각자 "한 장 집어 채점"을
   * 서버에 시키고, 서버가 없다고 하면 멈춥니다. 크론도 워커도 없습니다.
   */
  const drive = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setGrading(true);
    setErr(null);
    try {
      const lane = async () => {
        for (;;) {
          const { data } = await db.auth.getSession();
          const token = data.session?.access_token;
          if (!token) throw new Error("로그인이 풀렸습니다. 다시 로그인하십시오.");
          const r = await fetch("/api/grade-sheet", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ examId }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
          void refresh().catch(() => {});
          if (j.done) return;
        }
      };
      await Promise.all(Array.from({ length: LANES }, lane));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setGrading(false);
      void refresh().catch(() => {});
    }
  }, [db, examId, refresh]);

  if (!exam) return <p className="p-6 text-sm text-slate-500">{err ?? "불러오는 중…"}</p>;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-24">
      <Bar db={db} staff={staff}>
        <a href="/" className="text-slate-500 underline">
          시험 목록
        </a>
      </Bar>

      <header className="mb-5">
        <h1 className="text-xl font-bold">{exam.title || "(이름 없음)"}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {[exam.class_name, exam.exam_date, exam.cut_line, exam.strict_spelling ? "철자 엄격" : "철자 관대"]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {err && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>}

      {/* 올리자마자 바로 채점을 겁니다. 조교가 버튼을 한 번 더 누를 이유가 없습니다. */}
      <Uploader
        db={db}
        examId={examId}
        onDone={() => {
          void refresh().catch(() => {});
          void drive();
        }}
      />

      {prog && prog.total > 0 && (
        <Progress prog={prog} grading={grading} onStart={() => void drive()} />
      )}

      <Sheets db={db} sheets={sheets} onChange={() => void refresh().catch(() => {})} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// 올리기
// ---------------------------------------------------------------------------

function Uploader({ db, examId, onDone }: { db: SupabaseClient; examId: string; onDone: () => void }) {
  const [imgs, setImgs] = useState<PreparedImage[]>([]);
  const [perStudent, setPerStudent] = useState(2);
  const [breaks, setBreaks] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /** 몇 장씩 끊을지가 바뀌면 경계를 다시 깝니다. 사람이 손댄 건 그때 사라집니다. */
  function relayout(n: number, count: number) {
    setBreaks(defaultBreaks(count, n));
  }

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    try {
      const prepared = await Promise.all([...files].map((f) => prepareImage(f)));
      const next = [...imgs, ...prepared];
      setImgs(next);
      relayout(perStudent, next.length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function rotate(k: number, delta: 90 | -90) {
    const next = await rotateBy(imgs[k], delta);
    setImgs((p) => p.map((x, i) => (i === k ? next : x)));
  }

  function remove(k: number) {
    const next = imgs.filter((_, i) => i !== k);
    setImgs(next);
    relayout(perStudent, next.length);
  }

  async function upload() {
    const groups = groupsOf(imgs, breaks);
    setErr(null);
    try {
      for (const [i, g] of groups.entries()) {
        setBusy(`${i + 1}/${groups.length}번째 학생 올리는 중…`);
        await uploadSheet(db, examId, g);
      }
      setImgs([]);
      setBreaks(new Set());
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const groups = groupsOf(imgs, breaks);
  const sideways = imgs.some((i) => i.looksSideways);

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">답안지 사진</span>
        <span className="mb-2 block text-xs text-slate-500">
          한 반을 <strong>순서대로 쭉 찍어</strong> 한꺼번에 올리십시오. 몇 장씩 한 학생인지만 정하면
          자동으로 나뉩니다.
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

      <label className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-slate-700">한 학생에</span>
        <select
          value={perStudent}
          onChange={(e) => {
            const n = Number(e.target.value);
            setPerStudent(n);
            relayout(n, imgs.length);
          }}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}장
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">양면 인쇄면 2장입니다. 아래에서 하나씩 고칠 수 있습니다.</span>
      </label>

      {imgs.length > 0 && (
        <>
          <div className="mt-4 space-y-3">
            {groups.map((g, gi) => {
              const start = groups.slice(0, gi).reduce((a, x) => a + x.length, 0);
              return (
                <div key={gi} className="rounded-lg border border-slate-200 p-2">
                  <p className="mb-2 text-xs font-medium text-slate-600">
                    {gi + 1}번째 학생 · {g.length}장
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {g.map((im, j) => {
                      const k = start + j;
                      return (
                        <figure key={k} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={im.objectUrl}
                            alt=""
                            className={`h-28 w-auto rounded-lg border object-contain ${
                              im.looksSideways ? "border-2 border-amber-400" : "border-slate-200"
                            }`}
                          />
                          <button
                            onClick={() => remove(k)}
                            className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs text-slate-600 shadow"
                            aria-label="빼기"
                          >
                            ✕
                          </button>
                          <figcaption className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                            <button onClick={() => void rotate(k, -90)} className="rounded border border-slate-300 px-1.5" aria-label="왼쪽으로">
                              ↺
                            </button>
                            <span>{(im.bytes / 1024).toFixed(0)}KB</span>
                            <button onClick={() => void rotate(k, 90)} className="rounded border border-slate-300 px-1.5" aria-label="오른쪽으로">
                              ↻
                            </button>
                          </figcaption>
                          {k > 0 && (
                            <button
                              onClick={() =>
                                setBreaks((p) => {
                                  const s = new Set(p);
                                  if (s.has(k)) s.delete(k);
                                  else s.add(k);
                                  return s;
                                })
                              }
                              className="mt-1 block w-full rounded border border-slate-200 text-[11px] text-slate-500 hover:bg-slate-50"
                            >
                              {breaks.has(k) ? "↩ 앞 학생에 붙이기" : "✂ 여기서 새 학생"}
                            </button>
                          )}
                        </figure>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {sideways && (
            <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              가로로 누운 사진이 있습니다. 답안지가 <strong>세워져 보이도록 돌려 주십시오.</strong> 눕힌 채로도
              읽기는 하지만 칸을 놓칩니다.
            </p>
          )}
          {err && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">{err}</p>}

          <button
            onClick={() => void upload()}
            disabled={!!busy}
            className="mt-4 rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {busy ?? `${groups.length}명 올리고 채점 시작`}
          </button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 진행
// ---------------------------------------------------------------------------

function Progress({ prog, grading, onStart }: { prog: ExamProgressRow; grading: boolean; onStart: () => void }) {
  const done = prog.graded + prog.confirmed + prog.failed;
  const pct = prog.total ? Math.round((done / prog.total) * 100) : 0;
  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {done} / {prog.total}명 채점됨
          {prog.pending > 0 && <span className="ml-2 text-slate-500">· 대기 {prog.pending}</span>}
          {prog.failed > 0 && <span className="ml-2 text-rose-600">· 실패 {prog.failed}</span>}
        </p>
        <span className="text-xs text-slate-500">${Number(prog.cost_usd).toFixed(2)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-slate-900 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {prog.needs_review > 0 && (
        <p className="mt-3 rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          🔶 <strong>{prog.needs_review}명은 사람이 반드시 봐야 합니다.</strong> 커트라인에 걸렸거나, 번호가
          밀렸거나, 판정을 내지 못한 답안지입니다.
        </p>
      )}
      {prog.pending > 0 && (
        <button
          onClick={onStart}
          disabled={grading}
          className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          {grading ? `채점 중… (동시 ${LANES}장, 한 명에 1~2분)` : `남은 ${prog.pending}명 채점하기`}
        </button>
      )}
      {grading && (
        <p className="mt-2 text-xs text-slate-500">
          창을 닫아도 이미 올린 것은 남습니다. 다시 열어 <strong>채점하기</strong>를 누르면 이어서 합니다.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 답안지 목록
// ---------------------------------------------------------------------------

const STATUS: Record<SheetRow["status"], string> = {
  uploading: "올리는 중",
  queued: "대기",
  running: "채점 중",
  graded: "채점됨",
  failed: "실패",
  confirmed: "확정",
};

function Sheets({ db, sheets, onChange }: { db: SupabaseClient; sheets: SheetRow[]; onChange: () => void }) {
  if (!sheets.length) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100">
        {sheets.map((s, i) => {
          const v = s.final_verdict ?? s.verdict;
          const drift = (s.warnings ?? []).some((w) => w.level === "drift");
          const incomplete = (s.warnings ?? []).some((w) => w.level === "incomplete");
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {s.student_name || <span className="text-slate-400">이름 못 읽음 · {i + 1}번째</span>}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>{STATUS[s.status]}</span>
                  {s.n_wrong !== null && (
                    <span>
                      오답 {s.n_wrong}
                      {s.cut !== null && ` / 허용 ${s.cut}`}
                    </span>
                  )}
                  {s.near_boundary && <span className="font-medium text-amber-700">🔶 커트라인</span>}
                  {drift && <span className="font-medium text-amber-700">⚠️ 밀림</span>}
                  {incomplete && <span className="font-medium text-rose-700">📄 일부만 찍힘</span>}
                  {s.verdict === null && s.status === "graded" && (
                    <span className="font-medium text-amber-700">판정 보류</span>
                  )}
                  {s.error && <span className="text-rose-600">{s.error}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {v && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      v === "pass" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {v === "pass" ? "PASS" : "FAIL"}
                  </span>
                )}
                {s.status === "failed" && (
                  <button
                    onClick={() => void retrySheet(db, s.id).then(onChange)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    다시
                  </button>
                )}
                {(s.status === "uploading" || s.status === "failed") && (
                  <button
                    onClick={() => confirm("이 답안지를 지웁니다.") && void deleteSheet(db, s).then(onChange)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500"
                  >
                    삭제
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
