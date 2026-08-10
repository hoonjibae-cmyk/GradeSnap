"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { itemsFor, sheetsOn, trialsOn } from "@/lib/db/queries";
import type { ItemRow, ModelTrialRow, SheetRow, StaffRow } from "@/lib/db/schema";
import { bias, diffRuns, pct, summarize, type Diff, type Run } from "@/lib/bench";
import { CATALOG, info } from "@/lib/grading/provider";

/** 지금 실제 채점이 쓰는 설정. 서버에서 읽어 넘겨줍니다. */
export interface Live {
  model: string;
  effort: string;
}

/**
 * 값싼 모델로 바꾸면 무엇을 잃는가 — 실측하는 화면.
 *
 * 이미 채점된 답안지를 **다시 채점만** 해 보고 결과를 나란히 놓습니다.
 * 실제 채점 결과는 안 건드립니다([12 §12.8](../../docs/12-page-level-grading.md)).
 */
export default function BenchPage({ live }: { live: Live }) {
  return <Gate>{(db, staff) => <Bench db={db} staff={staff} live={live} />}</Gate>;
}

/** 목록은 `lib/grading/provider.ts` 한 곳에서 옵니다 — 화면과 서버가 갈리면 안 됩니다. */
const MODELS = CATALOG;
const EFFORTS = ["high", "medium", "low"];
/** 실험은 급하지 않습니다. 실제 채점이 밀리지 않게 둘만 씁니다. */
const LANES = 2;

/** 설정 때문에 못 돌린 것. 답안지마다 되풀이할 이유가 없어 한 번에 멈춥니다. */
class SetupError extends Error {}

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Bench({ db, staff, live }: { db: SupabaseClient; staff: StaffRow; live: Live }) {
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
    if (j?.setup) throw new SetupError(j?.error ?? "설정이 덜 됐습니다.");
    if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
  }

  async function run(list: SheetRow[]) {
    setErr(null);
    stop.current = false;
    const queue = [...list];
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
          /*
            키가 없는데 나머지 장을 계속 두드릴 이유가 없습니다. 같은 오류가
            장 수만큼 쌓일 뿐이고, 그 사이 진짜 실패와 섞입니다.
          */
          if (e instanceof SetupError) stop.current = true;
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
    // 기준의 설정은 **그 답안지를 실제로 채점한 값**입니다. 고정해두면
    // 운영 기본값을 바꾼 뒤 화면이 거짓말을 합니다.
    const baseUsage = (s.token_usage ?? [])[0];
    const base: Run = {
      model: baseUsage?.model ?? "claude-opus-5",
      effort: baseUsage?.effort ?? "high",
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

  /** 이 조합으로 아직 한 번도 안 돌려본 답안지. 같은 걸 두 번 사지 않습니다. */
  const untried = sheets.filter((s) => !latest.has(s.id));
  /** 돌렸는데 실패한 답안지. **다시 돌릴 수 있어야 합니다** — 키를 넣고 오면 될 일입니다. */
  const failed = sheets.filter((s) => latest.get(s.id)?.error);
  const failures = failed.map((s) => latest.get(s.id)!);

  /*
    같은 메시지가 여섯 줄 늘어서면 여섯 가지 문제로 보입니다. 실제로는 하나입니다.
  */
  const reasons = [...new Map(failures.map((t) => [t.error, 0])).keys()].map((msg) => ({
    msg: msg ?? "(이유 없음)",
    n: failures.filter((t) => t.error === msg).length,
  }));
  const sum = summarize(pairs.map((p) => ({ base: p.base, diff: p.diff })));
  const lean = bias(sum);
  const done = latest.size;
  const chosen = info(model);
  /*
    단가를 모르는 모델은 비용이 **빈칸**으로 저장됩니다. 그걸 0으로 더하면
    합계가 `$0.000`이 되고, 비교하려고 만든 화면이 "GPT가 공짜"라고 말합니다.
  */
  const noPrice = pairs.filter((p) => p.trial.cost_usd === null).length;

  /*
    🔴 **기준이 지금 쓰는 설정이 아닐 수 있습니다.**

    비교의 기준은 그 답안지를 실제로 채점한 값입니다. 운영 기본값을 바꾼 뒤에
    옛 날짜를 열면 기준이 옛 설정으로 남아 있고, 그러면 "비용 70%"가
    **지금 대비 절감액이 아닙니다.** 2026-08-10에 실제로 그렇게 읽혔습니다.
  */
  const baseSetting = pairs[0]?.base;
  const staleBase = baseSetting && (baseSetting.model !== live.model || baseSetting.effort !== live.effort);

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
      <Bar db={db} staff={staff} />

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
            onClick={() => void run(untried)}
            disabled={running > 0 || untried.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {running > 0 ? `돌리는 중… (${running})` : `안 돌려본 것 돌리기 (${untried.length}장)`}
          </button>
          {/*
            실패한 장을 다시 못 돌리면 화면이 막힙니다 — 실패도 '돌려본 것'이라
            위 단추가 0장이 되기 때문입니다. 키를 넣고 돌아왔을 때 누를 곳이
            있어야 합니다.
          */}
          {failed.length > 0 && (
            <button
              onClick={() => void run(failed)}
              disabled={running > 0}
              className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 disabled:opacity-40"
            >
              실패한 {failed.length}장 다시 돌리기
            </button>
          )}
          {running === 0 && done > 0 && (
            <button
              onClick={() => void run(sheets)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
              title="같은 조합을 한 번 더 돌립니다. 잡음 바닥을 재거나 흔들리는 장을 확인할 때 씁니다."
            >
              전부 다시 ({sheets.length}장)
            </button>
          )}
          {running > 0 && (
            <button onClick={() => (stop.current = true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              중단
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {chosen?.note}
          {pairs.length > 0 && (
            <span className="ml-2">
              · 기준은 {pairs[0].base.model} · {pairs[0].base.effort}
            </span>
          )}
        </p>

        {/*
          🔴 GPT를 고르면 **학생 답안지 사진이 OpenAI로 나갑니다.**
          지금 동의서에 적힌 국외 이전 대상은 Anthropic PBC 하나뿐입니다
          (docs/14 §14.3). 이건 실험 버튼 하나로 넘어갈 선이 아니라
          누르기 전에 보여야 하는 사실입니다.
        */}
        {chosen?.provider === "openai" && (
          <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
            🔴 <strong>이 모델은 OpenAI로 나갑니다.</strong> 개인정보 동의서에 적어둔 국외 이전 대상은
            지금 <strong>Anthropic PBC 하나</strong>입니다. 동의서를 아직 학부모에게 돌리지 않았다면
            돌리기 전에 이 실험을 끝내거나, 두 회사를 모두 적은 뒤에 돌리십시오.
            <br />
            실제 채점은 이 선택과 무관하게 Anthropic으로 나갑니다 — 여기서 고른 모델은 실험에만 씁니다.
          </p>
        )}
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

            {/*
              판정 일치율의 맹점. **관대한 모델은 통과할 학생을 더 통과시켜도
              판정이 그대로**라 100%가 나옵니다. 극단적으로 "전부 정답"이라고만
              답해도 통과 답안지만 있는 표본에서는 만점입니다.
            */}
            {lean !== "balanced" && (
              <p
                className={`mt-2 rounded border p-2 text-xs ${
                  lean === "lenient" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900"
                }`}
              >
                {lean === "lenient" ? (
                  <>
                    🔴 <strong>대상이 오답을 놓치는 쪽으로 치우쳤습니다.</strong> 대상이 놓친 오답{" "}
                    {sum.itemsWrongOnlyBase} · 대상만 잡은 오답 {sum.itemsWrongOnlyTrial}.
                    <br />
                    <strong>판정 일치율은 이걸 못 잡습니다</strong> — 통과할 학생을 더 통과시켜도 판정은
                    그대로이기 때문입니다.
                    {sum.allComparedPass && " 게다가 비교된 장이 전부 PASS라, 이 표본은 관대한 모델을 걸러낼 힘이 없습니다."}
                  </>
                ) : (
                  <>
                    🔶 <strong>대상이 오답을 더 잡는 쪽으로 치우쳤습니다.</strong> 대상만 잡은 오답{" "}
                    {sum.itemsWrongOnlyTrial} · 대상이 놓친 오답 {sum.itemsWrongOnlyBase}. 재시험이 늘어납니다.
                  </>
                )}
              </p>
            )}
            {lean === "balanced" && sum.allComparedPass && sum.compared > 0 && (
              <p className="mt-2 rounded border border-slate-300 bg-white p-2 text-xs text-slate-600">
                비교된 장이 <strong>전부 PASS</strong>입니다. 판정 일치율은 FAIL이 섞여야 판별력이 생깁니다 —
                커트라인 근처나 탈락한 답안지가 있는 날로도 돌려보십시오.
              </p>
            )}
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="문항 정오 일치" value={pct(sum.itemsAgree, sum.itemsCompared)} sub={`${sum.itemsAgree}/${sum.itemsCompared}`} />
            <Stat label="전사가 다른 칸" value={String(sum.writtenDiffs)} sub="고쳐 읽기가 여기 숨습니다" />
            <Stat label="놓친 칸" value={String(sum.missedCells)} sub="기준은 읽었는데 못 읽은 것" />
            <Stat
              label="비용"
              value={noPrice === pairs.length && pairs.length > 0 ? "—" : `$${sum.trialCost.toFixed(3)}`}
              sub={
                noPrice > 0
                  ? `${noPrice}장은 단가 미상`
                  : `기준 $${sum.baseCost.toFixed(3)} · ${sum.baseCost ? pct(sum.trialCost, sum.baseCost) : "—"}`
              }
            />
          </dl>

          {staleBase && (
            <p className="mt-2 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
              🔴 <strong>이 비용 비율은 지금 대비 절감액이 아닙니다.</strong> 기준이{" "}
              <strong>
                {baseSetting.model} · {baseSetting.effort}
              </strong>
              인데, 지금 실제 채점은{" "}
              <strong>
                {live.model} · {live.effort}
              </strong>
              로 나갑니다. 이 날 답안지는 설정을 바꾸기 전에 채점된 것입니다.
              <br />
              제대로 재려면 <strong>{`${live.model} · ${live.effort}`}를 먼저 실험으로 한 번 돌리십시오</strong> —
              같은 답안지에서 지금 설정의 비용과 시간이 나오고, 그것과 비교해야 진짜 절감액입니다.
            </p>
          )}

          {noPrice > 0 && (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <strong>{chosen?.label ?? model}의 단가를 모릅니다.</strong> 비용 칸을 0으로 채우면 이 화면이
              &ldquo;이쪽이 공짜&rdquo;라고 말하게 되므로 <strong>비워 두었습니다.</strong> 현재 단가를 알려주시면
              <code className="mx-1">lib/grading/provider.ts</code>의 <code>CATALOG</code>에 넣겠습니다 — 그 뒤로는
              비용도 같이 비교됩니다. <strong>시간과 판정은 지금도 비교됩니다.</strong>
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            시간 {(sum.trialMs / 1000).toFixed(0)}초 (기준 {(sum.baseMs / 1000).toFixed(0)}초)
          </p>
        </section>
      )}

      {failures.length > 0 && (
        <section className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <strong>{failures.length}장이 실패했습니다.</strong>
          {/*
            예전에는 여기서 "값싼 모델이 스키마를 못 맞추거나 거절한 것"이라고
            **단정했습니다.** 실제로 처음 뜬 실패는 우리가 키를 안 넣은 것이었고,
            화면은 그걸 모델 탓으로 적었습니다. 이유는 메시지에 있으니
            화면이 지어내지 않습니다.
          */}{" "}
          모델이 스키마를 못 맞췄을 수도, 거절했을 수도, 설정이 빠졌을 수도 있습니다.{" "}
          <strong>아래 메시지가 이유입니다.</strong>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {reasons.slice(0, 5).map((r) => (
              <li key={r.msg}>
                {r.msg}
                {r.n > 1 && <span className="ml-1 text-rose-700">({r.n}장)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            고치고 나면 위의 <strong>&ldquo;실패한 {failed.length}장 다시 돌리기&rdquo;</strong>를 누르십시오.
          </p>
        </section>
      )}

      {pairs.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="p-2 font-medium">학생</th>
                <th className="p-2 font-medium">기준</th>
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
                  <td className="p-2 text-xs text-slate-500">
                    {latest.get(s.id)?.cost_usd === null ? "—" : `$${d.costUsd.toFixed(3)}`}
                  </td>
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
