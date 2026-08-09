"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { ACADEMY, Crown } from "@/components/Logo";
import { sheetsOn, wrongItemsOn } from "@/lib/db/queries";
import type { SheetRow, StaffRow, WrongItemRow } from "@/lib/db/schema";
import { byClass, retestText, splitRoster, wrongText } from "@/lib/roster";

/**
 * 결과·명단 화면 — **오늘 누가 남고 누가 가는가.**
 *
 * 조교가 하던 "오답 정리 → 재시험 명단 만들기"가 이 화면입니다
 * ([13 §13.2](../../docs/13-phase1-plan.md)).
 */
export default function RosterPage() {
  return <Gate>{(db, staff) => <Roster db={db} staff={staff} />}</Gate>;
}

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Roster({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [day, setDay] = useState(todayLocal());
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [wrong, setWrong] = useState<WrongItemRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, w] = await Promise.all([sheetsOn(db, day), wrongItemsOn(db, day)]);
    setSheets(s);
    setWrong(w);
  }, [db, day]);

  useEffect(() => {
    void load().catch((e) => setErr(String(e.message ?? e)));
  }, [load]);

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setErr("복사가 막혔습니다. 글을 직접 끌어 선택해 주십시오.");
    }
  }

  const { retest, passed, pending } = splitRoster(sheets);
  // 확정된 답안지의 오답만 명단에 냅니다 — 검수 전 판정으로 오답노트를 뿌리지 않습니다.
  const confirmedIds = new Set(sheets.filter((s) => s.status === "confirmed").map((s) => s.id));
  const wrongConfirmed = wrong.filter((w) => confirmedIds.has(w.sheet_id));

  return (
    <main className="mx-auto max-w-3xl p-5 pb-24">
      <div className="no-print">
        <Bar db={db} staff={staff} />
      </div>

      {err && (
        <p className="no-print mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      )}

      {/*
        이 화면은 종이로 나가 선생님·학생에게 갑니다. 화면에서는 상단 줄에
        로고가 있지만 인쇄물에는 그게 안 따라가므로, **인쇄 전용 머리말**을
        따로 둡니다. 학원 이름 없는 명단은 어디서 나온 종이인지 알 수 없습니다.
      */}
      <div className="mb-3 hidden items-center gap-2 border-b border-slate-300 pb-2 print:flex">
        <Crown className="h-9 w-auto" />
        <div>
          <p className="text-base font-black tracking-tight text-[#25356E]">{ACADEMY}</p>
          <p className="text-xs text-slate-600">{day} 시험 결과</p>
        </div>
      </div>

      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="no-print rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="text-sm text-slate-600">
            접수 {sheets.length} · 확정 {retest.length + passed.length}
          </span>
        </div>
        <button onClick={() => window.print()} className="no-print rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          인쇄
        </button>
      </header>

      {pending.length > 0 && (
        <p className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 print-block">
          ⏳ <strong>아직 확정되지 않은 답안지가 {pending.length}장 있습니다.</strong> 선생님이 검수해 확정해야
          명단에 들어갑니다 — <strong>지금 명단은 완성이 아닙니다.</strong>
          <span className="no-print">
            {" "}
            <a href="/" className="underline">
              접수 목록에서 검수
            </a>
          </span>
        </p>
      )}

      <Section
        title={`재시험 — ${retest.length}명`}
        tone="fail"
        onCopy={() => void copy("retest", retestText(day, retest, pending.length))}
        copied={copied === "retest"}
      >
        {retest.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">확정된 재시험 대상이 없습니다.</p>
        ) : (
          byClass(retest).map(([cls, rows]) => (
            <div key={cls} className="border-t border-slate-100 p-3 first:border-t-0 print-block">
              <p className="text-xs font-medium text-slate-500">{cls}</p>
              <ul className="mt-1 space-y-1">
                {rows.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <a href={`/sheets/${s.id}`} className="font-medium">
                      {s.student_name || "(이름 못 읽음)"}
                    </a>
                    <span className="text-xs text-slate-500">
                      {s.title} · 오답 {s.n_wrong}
                      {s.cut !== null && ` / 허용 ${s.cut}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Section>

      <Section title={`통과 — ${passed.length}명`} tone="pass">
        {passed.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">확정된 통과가 없습니다.</p>
        ) : (
          byClass(passed).map(([cls, rows]) => (
            <div key={cls} className="border-t border-slate-100 p-3 first:border-t-0 print-block">
              <p className="text-xs font-medium text-slate-500">{cls}</p>
              <p className="mt-1 text-sm">
                {rows.map((s) => s.student_name || "(이름 못 읽음)").join(", ")}
              </p>
            </div>
          ))
        )}
      </Section>

      <Section
        title={`오답 목록 — ${wrongConfirmed.length}문항`}
        onCopy={() => void copy("wrong", wrongText(day, wrongConfirmed))}
        copied={copied === "wrong"}
      >
        {wrongConfirmed.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">확정된 답안지의 오답이 없습니다.</p>
        ) : (
          [...new Set(wrongConfirmed.map((w) => w.sheet_id))].map((id) => {
            const rows = wrongConfirmed.filter((w) => w.sheet_id === id);
            const h = rows[0];
            return (
              <div key={id} className="border-t border-slate-100 p-3 first:border-t-0 print-block">
                <p className="text-sm font-medium">
                  {h.student_name || "(이름 못 읽음)"}
                  {h.title && <span className="ml-2 font-normal text-slate-500">{h.title}</span>}
                  <span className="ml-2 text-xs text-slate-500">{rows.length}개</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {rows.map((r) => (
                    <li key={r.seq} className="text-slate-700">
                      <span className="text-slate-400">{r.no}.</span> {r.prompt}
                      {" → "}
                      <span className="font-medium">{r.written.trim() || "(무응답)"}</span>
                      {r.expected && <span className="text-slate-500"> (정답: {r.expected})</span>}
                      {r.overturned && <span className="ml-1 text-xs text-sky-700">고침</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </Section>
    </main>
  );
}

function Section({
  title,
  tone,
  onCopy,
  copied,
  children,
}: {
  title: string;
  tone?: "pass" | "fail";
  onCopy?: () => void;
  copied?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <h2
          className={`text-sm font-bold ${
            tone === "fail" ? "text-rose-700" : tone === "pass" ? "text-emerald-700" : "text-slate-700"
          }`}
        >
          {title}
        </h2>
        {onCopy && (
          <button onClick={onCopy} className="no-print rounded border border-slate-300 px-2 py-1 text-xs">
            {copied ? "복사됨" : "복사"}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
