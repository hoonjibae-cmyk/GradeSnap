"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { itemsFor, sheetsOn, trialsOn } from "@/lib/db/queries";
import type { ItemRow, ModelTrialRow, SheetRow, StaffRow } from "@/lib/db/schema";
import { diffRuns, pct, summarize, type Diff, type Run } from "@/lib/bench";

/**
 * 값싼 모델로 바꾸면 무엇을 잃는가 — 실측하는 화면.
 *
 * 이미 채점된 답안지를 **다시 채점만** 해 보고 결과를 나란히 놓습니다.
 * 실제 채점 결과는 안 건드립니다([12 §12.8](../../docs/12-page-level-grading.md)).
 */
export default function BenchPage() {
  return <Gate>{(db, staff) => <Bench db={db} staff={staff} />}</Gate>;
}

const MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "입력 3/출력 15 — Opus의 60%" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "입력 1/출력 5 — Opus의 20%" },
  { id: "claude-opus-5", label: "Opus 5 (같은 모델)", note: "사고 강도만 낮춰볼 때" },
];
const EFFORTS = ["high", "medium", "low"];
/** 실험은 급하지 않습니다. 실제 채점이 밀리지 않게 둘만 씁니다. */
const LANES = 2;

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Bench({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [day, setDay] = useState(todayLocal());
  const [model, setModel] = useState(MODELS[0].id);
  const [effort, setEffort] = useState("high");
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [trials, setTrials] = useState<ModelTrialRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(0);
  const stop = useRef(false);

  const load = useCallback(async () => {
    const s = (await sheetsOn(db, day)).filter((x) => x.graded_at);
    const ids = s.map((x) => x.id);
    const [i, t] = await Promise.all([itemsFor(db, ids), trialsOn(db, ids)]);
    setSheets(s);
    setItems(i);
    setTrials(t);
  }, [db, day]);

  useEffect(() => {
    void load().catch((e) => setErr(String(e.message ?? e)));
  }, [load]);

  async function runOne(sheetId: string) {
    const { data } = await db.auth.getSession();
    const r = await fetch(`/api/sheets/${sheetId}/trial`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify({ model, effort }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
  }

  /** 아직 이 조합으로 안 돌려본 답안지만 돌립니다. 같은 걸 두 번 사지 않습니다. */
  async function runAll() {
    setErr(null);
    stop.current = false;
    const todo = sheets.filter((s) => !trials.some((t) => t.sheet_id === s.id && t.model === model && t.effort === effort));
    const queue = [...todo];
    const lane = async () => {
      for (;;) {
        if (stop.current) return;
        const s = queue.shift();
        if (!s) return;
        setRunning((n) => n + 1);
        try {
          await runOne(s.id);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setRunning((n) => n - 1);
          void load().catch(() => {});
        }
      }
    };
    await Promise.all(Array.from({ length: LANES }, lane));
  }

  // 이 조합의 가장 최근 실험만 씁니다. 같은 조건을 두 번 돌렸으면 나중 것.
  const latest = new Map<string, ModelTrialRow>();
  for (const t of trials) {
    if (t.model === model && t.effort === effort && !latest.has(t.sheet_id)) latest.set(t.sheet_id, t);
  }

  const pairs: { sheet: SheetRow; trial: ModelTrialRow; base: Run; diff: Diff }[] = [];
  for (const s of sheets) {
    const t = latest.get(s.id);
    if (!t || t.error || !t.transcript || !t.results) continue;
    const rows = items.filter((i) => i.sheet_id === s.id);
    if (!rows.length) continue;
    /*
      기준은 **시스템이 내놓은 것**(`correct`)이지 선생님이 고친 값이 아닙니다.
      여기서 답하려는 질문은 "값싼 모델이 지금 나가는 결과를 재현하는가"입니다.
      선생님 판정을 기준으로 두면 두 모델의 차이와 선생님의 수정이 뒤섞입니다.
    */
    const base: Run = {
      model: "claude-opus-5",
      effort: "high",
      items: rows.map((i) => ({ no: i.no, written: i.written })),
      results: rows.map((i) => ({ no: i.no, correct: i.correct ?? false, expected: i.expected, note: i.note })),
      cut: s.cut,
      nWrong: s.n_wrong ?? 0,
      verdict: s.verdict,
      nearBoundary: Boolean(s.near_boundary),
      margin: s.margin,
      costUsd: Number(s.cost_usd ?? 0),
      latencyMs: (s.token_usage ?? []).reduce((a, u) => a + u.latencyMs, 0),
    };
    const trial: Run = {
      model: t.model,
      effort: t.effort,
      items: t.transcript.items,
      results: t.results,
      cut: t.cut,
      nWrong: t.n_wrong ?? 0,
      verdict: t.verdict,
      nearBoundary: Boolean(t.near_boundary),
      margin: t.margin,
      costUsd: Number(t.cost_usd ?? 0),
      latencyMs: t.latency_ms ?? 0,
    };
    pairs.push({ sheet: s, trial: t, base, diff: diffRuns(base, trial) });
  }

  const failures = sheets
    .map((s) => latest.get(s.id))
    .filter((t): t is ModelTrialRow => Boolean(t?.error));
  const sum = summarize(pairs.map((p) => ({ base: p.base, diff: p.diff })));
  const done = latest.size;

  if (staff.role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl p-5">
        <Bar db={db} staff={staff} />
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          모델 비교는 <strong>돈이 나가는 실험</strong>이라 관리자만 돌릴 수 있습니다.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-5 pb-24">
      <Bar db={db} staff={staff}>
        <a href="/" className="text-slate-500 underline">
          접수
        </a>
      </Bar>

      <header className="mb-4">
        <h1 className="text-xl font-bold">모델 비교</h1>
        <p className="mt-1 text-sm text-slate-600">
          이미 채점된 답안지를 다른 모델로 <strong>다시 채점만</strong> 해 봅니다. 실제 결과는 바뀌지 않습니다.
        </p>
      </header>

      {err && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>}

      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-slate-700">날짜</span>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-700">모델</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-700">사고 강도</span>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              {EFFORTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void runAll()}
            disabled={running > 0 || sheets.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {running > 0 ? `돌리는 중… (${running})` : `안 돌려본 것 돌리기 (${sheets.length - done}장)`}
          </button>
          {running > 0 && (
            <button onClick={() => (stop.current = true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              중단
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">{MODELS.find((m) => m.id === model)?.note}</p>
      </section>

      {done > 0 && (
        <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-700">결과</h2>

          <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
            <p className="text-sm">
              <strong>판정 일치 {pct(sum.verdictAgree, sum.compared)}</strong>{" "}
              <span className="text-slate-500">
                ({sum.verdictAgree}/{sum.compared}장)
              </span>
              {sum.flippedWithMargin > 0 && (
                <span className="ml-2 font-bold text-rose-700">뒤집힘 {sum.flippedWithMargin}장</span>
              )}
              {sum.flippedAtBoundary > 0 && (
                <span className="ml-2 text-amber-700">경계선에서 갈림 {sum.flippedAtBoundary}장</span>
              )}
              {sum.trialUndecided > 0 && (
                <span className="ml-2 text-amber-700">대상만 판정 못 냄 {sum.trialUndecided}장</span>
              )}
              {sum.incomparable > 0 && (
                <span className="ml-2 text-slate-500">기준도 판정 없음 {sum.incomparable}장</span>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              이 시스템이 내놓는 것은 PASS/FAIL 하나이고, 학생에게 일어나는 일도 그것뿐입니다.
              <strong> 여유가 있었는데도 뒤집힌 장이 있으면 바꾸면 안 됩니다.</strong>
            </p>
            {sum.flippedAtBoundary > 0 && (
              <p className="mt-1 text-xs text-amber-800">
                커트라인에 걸려 있던 장은 <strong>같은 모델을 두 번 돌려도 갈립니다.</strong> 대상 모델의
                흠으로 세지 않습니다 — 원래 사람이 확정해야 하는 자리입니다.
              </p>
            )}
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="문항 정오 일치" value={pct(sum.itemsAgree, sum.itemsCompared)} sub={`${sum.itemsAgree}/${sum.itemsCompared}`} />
            <Stat label="전사가 다른 칸" value={String(sum.writtenDiffs)} sub="고쳐 읽기가 여기 숨습니다" />
            <Stat label="놓친 칸" value={String(sum.missedCells)} sub="기준은 읽었는데 못 읽은 것" />
            <Stat
              label="비용"
              value={`$${sum.trialCost.toFixed(3)}`}
              sub={`기준 $${sum.baseCost.toFixed(3)} · ${sum.baseCost ? pct(sum.trialCost, sum.baseCost) : "—"}`}
            />
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            시간 {(sum.trialMs / 1000).toFixed(0)}초 (기준 {(sum.baseMs / 1000).toFixed(0)}초)
          </p>
        </section>
      )}

      {failures.length > 0 && (
        <section className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <strong>{failures.length}장은 아예 실패했습니다.</strong> 이것도 결과입니다 — 값싼 모델이 스키마를
          못 맞추거나 거절한 것입니다.
          <ul className="mt-1 list-disc pl-5 text-xs">
            {failures.slice(0, 5).map((t) => (
              <li key={t.id}>{t.error}</li>
            ))}
          </ul>
        </section>
      )}

      {pairs.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="p-2 font-medium">학생</th>
                <th className="p-2 font-medium">기준(Opus)</th>
                <th className="p-2 font-medium">대상</th>
                <th className="p-2 font-medium">판정</th>
                <th className="p-2 font-medium">읽은 칸</th>
                <th className="p-2 font-medium">정오 차이</th>
                <th className="p-2 font-medium">전사 차이</th>
                <th className="p-2 font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map(({ sheet: s, diff: d }) => (
                <tr
                  key={s.id}
                  className={`border-t border-slate-100 ${
                    d.verdictMatch === false ? (d.baseNearBoundary ? "bg-amber-50" : "bg-rose-50") : ""
                  }`}
                >
                  <td className="p-2">
                    <a href={`/sheets/${s.id}`} className="font-medium">
                      {s.student_name || "이름 못 읽음"}
                    </a>
                  </td>
                  <td className="p-2">
                    {d.baseVerdict ? d.baseVerdict.toUpperCase() : "—"}
                    <span className="ml-1 text-xs text-slate-500">오답 {s.n_wrong}</span>
                  </td>
                  <td className="p-2">
                    {d.trialVerdict ? d.trialVerdict.toUpperCase() : "—"}
                    <span className="ml-1 text-xs text-slate-500">오답 {latest.get(s.id)?.n_wrong ?? "—"}</span>
                  </td>
                  <td className="p-2">
                    {d.verdictMatch === null ? (
                      <span className="text-amber-700">한쪽만</span>
                    ) : d.verdictMatch ? (
                      <span className="text-emerald-700">같음</span>
                    ) : d.baseNearBoundary ? (
                      <span className="font-medium text-amber-700" title="기준도 커트라인에 걸려 있던 장입니다">
                        경계선 🔶
                      </span>
                    ) : (
                      <span className="font-bold text-rose-700">뒤집힘</span>
                    )}
                  </td>
                  <td className="p-2 text-slate-600">
                    {d.trialRead} / {d.baseRead}
                    {d.onlyBase.length > 0 && <span className="ml-1 text-xs text-rose-600">-{d.onlyBase.length}</span>}
                  </td>
                  <td className="p-2 text-xs text-slate-600">
                    {d.wrongOnlyTrial.length === 0 && d.wrongOnlyBase.length === 0 ? (
                      <span className="text-slate-400">없음</span>
                    ) : (
                      <span>
                        {d.wrongOnlyTrial.length > 0 && (
                          <span className="text-rose-700" title="대상만 오답으로 본 문항">
                            +{d.wrongOnlyTrial.join(",")}
                          </span>
                        )}
                        {d.wrongOnlyBase.length > 0 && (
                          <span className="ml-1 text-sky-700" title="기준만 오답으로 본 문항">
                            -{d.wrongOnlyBase.join(",")}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-slate-600">
                    {d.written.length === 0 ? (
                      <span className="text-slate-400">없음</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer">{d.written.length}칸</summary>
                        <ul className="mt-1 space-y-0.5">
                          {d.written.slice(0, 20).map((w) => (
                            <li key={w.no}>
                              {w.no}. <span className="text-slate-500">{w.base || "(빈칸)"}</span> →{" "}
                              <span className="font-medium">{w.trial || "(빈칸)"}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="p-2 text-xs text-slate-500">${d.costUsd.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sheets.length === 0 && <p className="text-sm text-slate-500">이 날짜에 채점된 답안지가 없습니다.</p>}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
      <dd className="text-xs text-slate-500">{sub}</dd>
    </div>
  );
}
