"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import {
  allStaff,
  countExamRefs,
  getSettings,
  deleteSheet,
  gradedBetween,
  pagesFor,
  retentionStatus,
  sheetsOfStudent,
  saveGradingModel,
  saveSettings,
  saveUseExamRefs,
  updateStaff,
  usageBetween,
  type RetentionStatus,
} from "@/lib/db/queries";
import { readJson } from "@/lib/http";
import { MIN_PASSWORD } from "@/lib/password";
import { CATALOG, EFFORTS, label, normalizeGrading } from "@/lib/grading/provider";
import { FIXED_INPUT_PER_PAGE, imageTokens, split } from "@/lib/tokens";
import { breakdown, edgeFactor, krw, project, saving } from "@/lib/cost";
import type { Role, SettingsRow, SheetPageRow, SheetRow, StaffRow, UsageEventRow } from "@/lib/db/schema";
import {
  byHour,
  byStaff,
  DAY_NAMES,
  DEFAULT_HOURS,
  describeHours,
  isOffHours,
  normalizeHours,
  totals,
  type DayHours,
  type WorkHours,
} from "@/lib/usage";

/**
 * 관리 화면 — 직원, 사용량, 사진 보관.
 *
 * 사용량을 보는 이유는 **근무 시간 외 사적 사용을 막기 위해서**입니다.
 * 답안지 한 장에 $0.14가 나가고 그 돈은 학원이 냅니다.
 */
export default function AdminPage() {
  return <Gate>{(db, staff) => <Admin db={db} staff={staff} />}</Gate>;
}

function daysAgo(n: number) {
  const d = new Date(Date.now() - n * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Admin({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [err, setErr] = useState<string | null>(null);

  if (staff.role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl p-5">
        <Bar db={db} staff={staff} />
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          관리자만 볼 수 있습니다.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-5 pb-24">
      <Bar db={db} staff={staff} />
      <h1 className="mb-4 text-xl font-bold">관리</h1>
      {err && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      <Grading db={db} onError={setErr} />
      <Cost db={db} onError={setErr} />
      <Usage db={db} onError={setErr} />
      <People db={db} meId={staff.id} onError={setErr} />
      <Withdrawal db={db} onError={setErr} />
      <Retention db={db} onError={setErr} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// 채점 모델
// ---------------------------------------------------------------------------

/**
 * 실제 채점이 쓸 모델을 원장님이 고릅니다.
 *
 * 예전에는 Vercel 환경 변수였습니다. "되돌릴 수 있게" 코드 밖에 뒀는데,
 * 되돌리려면 여전히 저를 불러야 했습니다. **원장님이 직접 못 바꾸면
 * 되돌릴 수 있는 게 아닙니다.**
 *
 * 🔴 목록에 GPT가 없는 것은 빠뜨린 게 아닙니다. 실제 채점이 OpenAI로 나가면
 * 동의서에 없는 회사로 학생 답안지가 갑니다(docs/14 §14.8). 모델 비교
 * 실험(`/bench`)에서만 고를 수 있습니다.
 */
function Grading({ db, onError }: { db: SupabaseClient; onError: (m: string) => void }) {
  const [cfg, setCfg] = useState<SettingsRow | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /** 계정의 Models API 응답. `null`이면 아직 안 물어봤습니다. */
  const [account, setAccount] = useState<{ id: string; name: string }[] | null>(null);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  /** 지금까지 저장된 참조 수. **켜져 있는데 0이면 아직 안 도는 것입니다.** */
  const [refs, setRefs] = useState<number | null>(null);

  const load = useCallback(async () => {
    const c = await getSettings(db);
    setCfg(c);
    setModel(c.grading_model ?? "");
    setEffort(c.grading_effort ?? "");
    setRefs(await countExamRefs(db).catch(() => null));
  }, [db]);

  /**
   * **계정에 물어봅니다** — 문서도 영업 담당자도 아니고, 이 키의 Models API가
   * 이 계정의 진실입니다. "그 모델은 없다"는 주장(2026-08-11)을 문서 링크로
   * 다투는 대신 여기서 한 번 눌러 끝냅니다.
   */
  async function checkModels() {
    setBusy(true);
    setAccountErr(null);
    try {
      const { data } = await db.auth.getSession();
      const r = await fetch("/api/models", {
        headers: { authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      setAccount(j.models);
    } catch (e) {
      setAccountErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load().catch((e) => onError(String(e.message ?? e)));
  }, [load, onError]);

  if (!cfg) return <section className="mb-6 text-sm text-slate-500">불러오는 중…</section>;

  const current = normalizeGrading(cfg.grading_model, cfg.grading_effort);
  const chosen = normalizeGrading(model, effort);
  const dirty = Boolean(chosen) && (model !== cfg.grading_model || effort !== cfg.grading_effort);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await saveGradingModel(db, model, effort);
      await load();
      setSaved(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRefs(on: boolean) {
    setBusy(true);
    try {
      await saveUseExamRefs(db, on);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-700">채점 모델</h2>
      <p className="mt-1 text-xs text-slate-500">
        지금 접수되는 답안지가 어떤 모델로 채점되는지입니다. <strong>바꾸면 다음 답안지부터</strong> 적용되고,
        이미 채점된 것은 그대로 있습니다.
      </p>

      {/*
        칸이 없을 수 있습니다 — 마이그레이션 전에 배포가 먼저 붙는 경우입니다.
        그때 화면이 기본값을 보여주면 **실제로 도는 것과 다른 이름**을 말하게 됩니다.
      */}
      {!current && (
        <p className="mt-2 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
          🔴 <strong>지금 설정을 읽지 못했습니다.</strong> 저장된 값이 &ldquo;{String(cfg.grading_model)} ·{" "}
          {String(cfg.grading_effort)}&rdquo;입니다. 마이그레이션(<code>20260810000100_grading_model.sql</code>)이
          밀려 있으면 이렇게 됩니다. 이 상태에서는 <strong>채점도 멈춥니다</strong> — 모르는 설정으로 돈을
          쓰지 않습니다.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-slate-700">모델</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          >
            {!current && <option value="">(못 읽음)</option>}
            {CATALOG.filter((m) => m.provider === "anthropic").map((m) => (
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
            {!current && <option value="">(못 읽음)</option>}
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void save()}
          disabled={busy || !dirty}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "저장 중…" : "바꾸기"}
        </button>
        {saved && !dirty && <span className="text-xs text-emerald-700">저장했습니다.</span>}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {CATALOG.find((m) => m.id === model)?.note}
        {" · "}강도는 <strong>판정 단계만</strong> 건드립니다 — 전사(글자 읽기)는 안 변합니다.
        {" · "}
        <button onClick={() => void checkModels()} disabled={busy} className="underline disabled:opacity-40">
          계정에서 모델 확인
        </button>
      </p>

      {accountErr && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">{accountErr}</p>
      )}
      {account && (
        <div className="mt-2 rounded border border-slate-300 bg-slate-50 p-2 text-xs">
          {account.some((m) => m.id === cfg.grading_model) ? (
            <p className="text-emerald-800">
              ✓ 지금 설정(<code>{cfg.grading_model}</code>)이 <strong>이 계정의 모델 목록에 있습니다</strong> —{" "}
              {account.find((m) => m.id === cfg.grading_model)?.name}. Models API 응답이라 문서보다 이쪽이
              계정의 진실입니다.
            </p>
          ) : (
            <p className="font-medium text-rose-800">
              🔴 지금 설정(<code>{cfg.grading_model}</code>)이 계정 모델 목록에 <strong>없습니다.</strong> 위에서
              목록에 있는 모델로 바꾸고, support.claude.com 에 서면 확인을 요청하십시오.
            </p>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-slate-600">이 계정이 부를 수 있는 모델 {account.length}개</summary>
            <ul className="mt-1 list-disc pl-5 text-slate-600">
              {account.map((m) => (
                <li key={m.id}>
                  <code>{m.id}</code> — {m.name}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {dirty && (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          🔶 <strong>바꾸기 전에 재보십시오.</strong> {label(cfg.grading_model)} · {cfg.grading_effort}에서{" "}
          {label(model)} · {effort}로 옮기는 것입니다. <a className="underline" href="/bench">모델 비교</a>에서
          같은 답안지로 돌려보면 판정이 갈리는지 먼저 보입니다.
          <br />
          특히 <strong>FAIL이 섞인 날</strong>로 재야 합니다. 통과한 답안지만 있으면 관대한 모델도 100%가 나옵니다.
        </p>
      )}

      {/*
        같은 시험 참조 (docs/13 §13.27). 실제 채점 동작이 바뀌는 것이라
        관리자가 명시적으로 켭니다. 기본은 꺼짐 — 켜기 전과 완전히 같습니다.
      */}
      <div className="mt-4 border-t border-slate-200 pt-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={cfg.use_exam_refs === true}
            disabled={busy}
            onChange={(e) => void toggleRefs(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <strong>같은 시험 참조</strong>
            <span className="block text-xs text-slate-500">
              한 반이 같은 시험을 보면, 첫 답안지의 정답을 그 시험의 기준으로 남겨 나머지를 판정합니다.
              <strong> 반 전체가 같은 정답으로 판정받고</strong>(지금은 학생마다 정답을 새로 만들어 흔들릴 수
              있습니다), 밀림 검사도 참조 기준으로 한 번 더 돌며, 판정 비용이 줄어듭니다.
              <br />
              🔶 참조가 틀리면 반 전체에 번질 수 있습니다 — <strong>전 장 검수가 그대로 안전망</strong>이고,
              검수 화면의 정답 칸이 참조 값입니다. 이상하면 이 스위치를 끄면 즉시 예전 방식으로 돌아갑니다.
            </span>
          </span>
        </label>
        {/*
          🔴 **켜짐만 말하는 화면은 못 믿습니다.**

          이 기능은 스위치가 켜져 있는데 코드가 한 번도 안 불린 채로 며칠을
          보냈습니다(§13.34). 그때 화면은 "켜짐"이라고 했습니다. 그래서 지금은
          **저장된 참조 수**를 같이 내놓습니다 — 도는지 안 도는지의 증거입니다.
        */}
        {cfg.use_exam_refs === true && (
          <p className="ml-6 mt-2 text-xs text-slate-500">
            {refs === null ? (
              <>저장된 참조를 읽지 못했습니다 — 마이그레이션(<code>20260811000200_exam_refs.sql</code>)이 밀려
              있는지 확인해 주십시오.</>
            ) : refs > 0 ? (
              <>지금까지 저장된 참조 <strong className="text-slate-700">{refs}개</strong>. 시험 하나에 하나씩
              쌓입니다.</>
            ) : (
              <>아직 저장된 참조가 <strong className="text-amber-700">없습니다.</strong> 다음 시험의 첫
              깨끗한 답안지에서 만들어집니다 — 한 반을 채점한 뒤에도 0이면 알려 주십시오.</>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 비용
// ---------------------------------------------------------------------------

/** 학원이 예상하는 규모. 원장님이 2026-08-10에 알려주신 값입니다. */
const PLANNED_PAGES_PER_MONTH = 12_600;

/**
 * **돈이 어디로 나가는지** 실제 토큰으로 봅니다.
 *
 * 절감을 이야기할 때마다 제가 산수로 자릿수를 냈고, 한 번은 세 자릿수 배
 * 틀렸습니다(docs/13 §13.22). 이 화면이 있으면 그럴 일이 없습니다 —
 * 사진이 입력의 몇 할인지, 문항이 출력의 몇 할인지가 숫자로 나옵니다.
 */
function Cost({ db, onError }: { db: SupabaseClient; onError: (m: string) => void }) {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [sheets, setSheets] = useState<SheetRow[] | null>(null);
  const [pages, setPages] = useState<SheetPageRow[]>([]);

  const load = useCallback(async () => {
    const rows = await gradedBetween(db, from, to);
    setSheets(rows);
    setPages(await pagesFor(db, rows.map((r) => r.id)));
  }, [db, from, to]);

  useEffect(() => {
    void load().catch((e) => onError(String(e.message ?? e)));
  }, [load, onError]);

  if (!sheets) return <section className="mb-6 text-sm text-slate-500">불러오는 중…</section>;

  const s = split(sheets);
  const items = sheets.reduce((a, x) => a + (x.transcript?.items.length ?? 0), 0);
  const spent = sheets.reduce((a, x) => a + Number(x.cost_usd ?? 0), 0);
  const inTok = s.transcribe.inputTokens + s.judge.inputTokens;
  /*
    🔴 **어림값입니다.** 시스템 프롬프트를 750토큰으로 치고 뺀 값이라,
    실제보다 사진을 크게 잡습니다. 2026-08-11 `/bench` A/B에서 이 값이
    65%라고 했는데 실제는 23%였습니다(docs/13 §13.26).

    아래 '저장된 사진 크기'가 훨씬 곧은 답입니다 — 픽셀을 750으로 나누면
    사진 토큰이고, 그건 추정이 안 들어갑니다.
  */
  const imgPerPage = imageTokens(s, FIXED_INPUT_PER_PAGE);
  /** 저장된 사진의 긴 변. **여기가 사실입니다.** */
  const edges = pages.map((p) => Math.max(p.width ?? 0, p.height ?? 0)).filter((n) => n > 0).sort((a, b) => a - b);
  const medianEdge = edges.length ? edges[Math.floor(edges.length / 2)] : null;
  const px = pages.map((p) => (p.width ?? 0) * (p.height ?? 0)).filter((n) => n > 0);
  const avgImgTokens = px.length ? px.reduce((a, n) => a + n, 0) / px.length / 750 : null;
  /*
    🔴 여기서 **재는 것만** 씁니다.

    예전에는 답안지 두 장에 맞춘 `쪽당 + 문항당` 모형으로 환산했는데, 그게
    출력을 35%라고 말했습니다. 실측은 62%였고, **같은 상자 안에서 두 숫자가
    서로 다른 말을 하고 있었습니다.** 모형을 버렸습니다(docs/13 §13.24).
  */
  const measured = {
    pages: s.pages,
    items,
    imageTokens: imgPerPage * s.pages,
    otherInputTokens: Math.max(0, inTok - imgPerPage * s.pages),
    outputTokens: s.transcribe.outputTokens + s.judge.outputTokens,
  };
  const now = breakdown(measured);
  const plan = project(measured, PLANNED_PAGES_PER_MONTH);
  const perPage = s.pages ? items / s.pages : 0;
  const man = (usd: number) => (krw(usd) / 10_000).toFixed(0);
  const levers = [
    { label: "긴 변 2576→1800", usd: saving(measured, PLANNED_PAGES_PER_MONTH, { name: "", image: edgeFactor(2576, 1800) }) },
    { label: "긴 변 2576→1288", usd: saving(measured, PLANNED_PAGES_PER_MONTH, { name: "", image: edgeFactor(2576, 1288) }) },
    // 실측값입니다(docs/13 §13.21). 예측이 아니라 재본 것을 씁니다.
    { label: "출력 스키마 압축 (실측 −7.6%)", usd: plan.totalUsd * 0.076 },
  ];

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-700">비용</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        <span className="text-slate-400">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
      </div>

      {s.sheets === 0 ? (
        <p className="mt-3 text-sm text-slate-500">이 기간에 채점된 답안지가 없습니다.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="채점한 답안지" value={`${s.sheets}장`} sub={`${s.pages}쪽 · ${items}문항`} />
            <Stat label="쓴 돈" value={`$${spent.toFixed(2)}`} sub={`장당 $${(spent / s.sheets).toFixed(3)}`} />
            <Stat
              label="저장된 사진"
              value={medianEdge ? `${medianEdge}px` : "—"}
              sub={avgImgTokens ? `쪽당 약 ${Math.round(avgImgTokens).toLocaleString()}토큰 (넓이÷750)` : "크기 기록 없음"}
            />
            <Stat
              label="출력이 비용에서"
              value={`${(now.output.share * 100).toFixed(0)}%`}
              sub={`문항당 약 ${s.pages ? Math.round(measured.outputTokens / Math.max(1, items)) : 0}토큰`}
            />
          </dl>

          {/*
            **이게 이 화면을 만든 이유입니다.** 하루 일곱 장을 보고 월 규모를
            짐작하면 틀립니다. 잰 토큰을 그대로 늘립니다 — 맞추는 모형을
            거치지 않습니다.
          */}
          <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm">
            <p>
              지금 찍히는 대로면 <strong>쪽당 {perPage.toFixed(1)}문항</strong>입니다. 계획한{" "}
              <strong>월 {PLANNED_PAGES_PER_MONTH.toLocaleString()}쪽</strong>이면{" "}
              <strong className="text-rose-700">
                ${plan.totalUsd.toFixed(0)} · 약 {man(plan.totalUsd)}만원
              </strong>
              입니다.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              사진 ${plan.image.usd.toFixed(0)} · 그 외 입력 ${plan.otherInput.usd.toFixed(0)} · 출력 $
              {plan.output.usd.toFixed(0)}
            </p>

            <table className="mt-2 w-full text-xs">
              <tbody>
                {levers.map((l) => (
                  <tr key={l.label} className="border-t border-slate-200">
                    <td className="py-1 text-slate-600">{l.label}</td>
                    <td className="py-1 text-right font-medium">월 {man(l.usd)}만원</td>
                    <td className="py-1 pl-2 text-right text-slate-500">{((l.usd / plan.totalUsd) * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">
              해상도는 <strong>연필이 읽히는지</strong>를 걸고 사는 것입니다. 바꾸기 전에{" "}
              <a className="underline" href="/bench">모델 비교</a>로 재야 합니다.
            </p>

            {s.sheets < 30 && (
              <p className="mt-1 text-xs text-amber-800">
                🔶 표본이 {s.sheets}장뿐이라 쪽당 문항 수가 실제와 다를 수 있습니다. 수업이 돌기 시작하면 다시 보십시오.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 동의 철회 — 한 학생 것 전부 지우기
// ---------------------------------------------------------------------------

/**
 * 개인정보 동의 철회를 처리합니다(docs/14 §14.7).
 *
 * 동의서에 **"철회 시 7일 안에 파기"**라고 적어 돌렸습니다. 약속을 지키는
 * 코드가 이것입니다 — 이름으로 찾아 그 학생의 답안지를 **행째** 지웁니다.
 * 사진, 전사, 판정, 이름 전부입니다. 사진만 지우고 전사를 남기면 학생이
 * 쓴 답과 이름이 그대로 남아 파기가 아닙니다.
 *
 * **정확히 같은 이름만** 찾습니다. 동명이인은 반·날짜를 보고 사람이
 * 가립니다 — 그래서 전체 삭제 단추 옆에 장마다 지우는 단추도 있습니다.
 *
 * 지우는 순서는 `deleteSheet`가 지킵니다: **사진 먼저, 행은 나중.**
 * 중간에 끊기면 사진 없는 행이 남고, 다시 지우면 됩니다. 반대 순서면
 * "지웠다"는 행이 사라진 채 사진이 남습니다 — 약속을 어기는 쪽입니다.
 */
function Withdrawal({ db, onError }: { db: SupabaseClient; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [found, setFound] = useState<SheetRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function search() {
    setBusy(true);
    setDone(null);
    try {
      setFound(await sheetsOfStudent(db, name));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(s: SheetRow) {
    setBusy(true);
    try {
      await deleteSheet(db, s);
      setFound((p) => (p ? p.filter((x) => x.id !== s.id) : p));
      setDone((n) => (n ?? 0) + 1);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    if (!found?.length) return;
    /*
      브라우저 확인창에 **이름과 장 수**를 그대로 적습니다. "정말
      지우시겠습니까?"만 물으면 무엇을 지우는지 안 보이고, 이 단추는
      되돌릴 수 없습니다.
    */
    if (!window.confirm(`${name.trim()} 학생의 답안지 ${found.length}장을 전부 지웁니다.\n사진·전사·판정이 모두 삭제되고 되돌릴 수 없습니다.`)) {
      return;
    }
    setBusy(true);
    try {
      for (const s of [...found]) {
        await deleteSheet(db, s);
        setFound((p) => (p ? p.filter((x) => x.id !== s.id) : p));
        setDone((n) => (n ?? 0) + 1);
      }
    } catch (e) {
      // 도중에 끊겨도 지운 것은 지워졌습니다. 남은 것이 목록에 그대로 보입니다.
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-700">동의 철회 — 학생 기록 삭제</h2>
      <p className="mt-1 text-xs text-slate-500">
        학부모가 개인정보 동의를 철회하면 <strong>7일 안에</strong> 그 학생의 답안지를 지우기로
        동의서에 적었습니다. 이름이 정확히 같은 답안지만 찾습니다 — 사진·전사·판정·이름이 함께 지워지고
        <strong> 되돌릴 수 없습니다.</strong>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && void search()}
          placeholder="학생 이름 (정확히)"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => void search()}
          disabled={busy || !name.trim()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          찾기
        </button>
        {found && found.length > 0 && (
          <button
            onClick={() => void removeAll()}
            disabled={busy}
            className="rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {found.length}장 전부 삭제
          </button>
        )}
      </div>

      {done !== null && (
        <p className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
          {done}장을 지웠습니다. 사진과 기록이 함께 삭제됐습니다.
        </p>
      )}

      {found && found.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          이 이름의 답안지가 없습니다. 이름이 다르게 접수됐을 수 있으니 접수 화면에서 반·날짜로도 찾아보십시오.
        </p>
      )}

      {found && found.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1 font-medium">접수일</th>
              <th className="py-1 font-medium">반</th>
              <th className="py-1 font-medium">상태</th>
              <th className="py-1 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {found.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1.5">{s.created_at.slice(0, 10)}</td>
                <td className="py-1.5">{s.class_name || "—"}</td>
                <td className="py-1.5 text-xs text-slate-500">
                  {s.status}
                  {s.verdict && ` · ${s.verdict.toUpperCase()}`}
                </td>
                <td className="py-1.5 text-right">
                  <button
                    onClick={() => void removeOne(s)}
                    disabled={busy}
                    className="rounded border border-rose-300 px-2 py-0.5 text-xs text-rose-700 disabled:opacity-40"
                  >
                    이 장만 삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 사용량
// ---------------------------------------------------------------------------

function Usage({ db, onError }: { db: SupabaseClient; onError: (m: string) => void }) {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [events, setEvents] = useState<UsageEventRow[]>([]);
  const [people, setPeople] = useState<StaffRow[]>([]);
  const [cfg, setCfg] = useState<SettingsRow | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [e, p, s] = await Promise.all([usageBetween(db, from, to), allStaff(db), getSettings(db)]);
    setEvents(e);
    setPeople(p);
    setCfg(s);
  }, [db, from, to]);

  useEffect(() => {
    void load().catch((e) => onError(String(e.message ?? e)));
  }, [load, onError]);

  if (!cfg) return <section className="mb-6 text-sm text-slate-500">불러오는 중…</section>;

  /*
    설정을 못 읽으면 **읽었다고 치지 않습니다.** 마이그레이션이 아직 안 돌아
    칸 자체가 없을 수 있고, 그때 조용히 기본값을 쓰면 화면의 '근무 시간 외'가
    거짓말을 합니다. 숫자는 기본값으로 그리되 **틀릴 수 있다고 적습니다.**
  */
  const stored = normalizeHours(cfg.work_hours);
  const hours: WorkHours = stored ?? DEFAULT_HOURS;
  const rows = byStaff(events, hours);
  const sum = totals(rows);
  const bins = byHour(events, hours);
  const peak = Math.max(1, ...bins.map((b) => b.total));
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name || (id ? "(지워진 직원)" : "(알 수 없음)");

  const off = events.filter((e) => isOffHours(e.created_at, hours)).slice(0, 20);

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">사용량</h2>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
          <span className="text-slate-400">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="호출" value={sum.events.toLocaleString()} />
        <Stat label="쪽" value={sum.pages.toLocaleString()} />
        <Stat label="비용" value={`$${sum.costUsd.toFixed(2)}`} />
        <Stat
          label="근무 시간 외"
          value={sum.offHours.toLocaleString()}
          sub={sum.offHours ? `$${sum.offHoursCost.toFixed(2)}` : undefined}
          tone={sum.offHours > 0 ? "warn" : undefined}
        />
      </dl>

      {!stored && (
        <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
          🔴 <strong>근무 시간 설정을 읽지 못했습니다.</strong> 아래 숫자는 임시 기준(월~토 13~23시)으로 센
          것이라 <strong>믿으면 안 됩니다.</strong>
          <br />
          <span className="text-xs">
            마이그레이션 <code>20260809000100_work_hours.sql</code>을 아직 안 돌리셨을 수 있습니다.
          </span>
        </p>
      )}

      {/* 근무 시간 — 무엇이 '밖'인지의 기준이라 화면에 늘 보여야 합니다. */}
      <div className="mt-3 rounded-lg bg-slate-100 p-2 text-xs text-slate-600">
        기준 근무 시간: <strong>{describeHours(hours)}</strong> <span className="text-slate-500">(한국 시간)</span>
        <button onClick={() => setEditing((v) => !v)} className="ml-2 underline">
          {editing ? "닫기" : "바꾸기"}
        </button>
        {editing && <HoursForm db={db} cfg={cfg} onSaved={() => void load().then(() => setEditing(false))} onError={onError} />}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">이 기간에 기록이 없습니다.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="p-2 font-medium">직원</th>
                  <th className="p-2 font-medium">호출</th>
                  <th className="p-2 font-medium">쪽</th>
                  <th className="p-2 font-medium">비용</th>
                  <th className="p-2 font-medium">근무 시간 외</th>
                  <th className="p-2 font-medium">빠른 시험</th>
                  <th className="p-2 font-medium">마지막</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.staffId ?? "none"} className={`border-t border-slate-100 ${u.offHours > 0 ? "bg-amber-50" : ""}`}>
                    <td className="p-2 font-medium">{nameOf(u.staffId)}</td>
                    <td className="p-2 text-slate-600">
                      {u.events}
                      {u.failed > 0 && <span className="ml-1 text-xs text-rose-600">실패 {u.failed}</span>}
                    </td>
                    <td className="p-2 text-slate-600">{u.pages}</td>
                    <td className="p-2 text-slate-600">${u.costUsd.toFixed(2)}</td>
                    <td className="p-2">
                      {u.offHours > 0 ? (
                        <span className="font-bold text-amber-700">
                          {u.offHours} · ${u.offHoursCost.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400">없음</span>
                      )}
                    </td>
                    {/* 답안지를 안 남기는 호출이라 따로 봅니다 — 사적 사용이 여기로 샙니다. */}
                    <td className="p-2 text-slate-600">{u.byKind.quick || <span className="text-slate-400">0</span>}</td>
                    <td className="p-2 text-xs text-slate-500">
                      {u.lastAt ? new Date(u.lastAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 합계만 보면 "밤에 썼다"가 안 보입니다. 막대로 봐야 새벽 두 시가 튑니다. */}
          <div className="mt-5">
            <p className="mb-1 text-xs text-slate-500">시간대별 호출 (한국 시간)</p>
            <div className="flex items-end gap-[2px]">
              {bins.map((b, h) => (
                <div
                  key={h}
                  className="flex-1"
                  title={`${h}시 · ${b.total}건${b.off ? ` (근무 시간 외 ${b.off})` : ""}`}
                >
                  {/* 근무 시간 밖에서 일어난 몫을 막대 위쪽에 노랗게 얹습니다. */}
                  <div
                    className="w-full rounded-t bg-amber-400"
                    style={{ height: `${(b.off / peak) * 56}px` }}
                  />
                  <div
                    className={`w-full ${b.total === 0 ? "rounded-t bg-slate-100" : b.off === b.total ? "" : "rounded-t bg-slate-700"}`}
                    style={{ height: `${Math.max(b.total === 0 ? 2 : 0, ((b.total - b.off) / peak) * 56)}px` }}
                  />
                  {h % 6 === 0 && <p className="mt-0.5 text-[10px] text-slate-400">{h}</p>}
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400 align-middle" />
              근무 시간 외
            </p>
          </div>

          {off.length > 0 && (
            <div className="mt-5">
              <p className="mb-1 text-xs font-medium text-amber-800">근무 시간 외 기록 (최근 {off.length}건)</p>
              <ul className="space-y-0.5 text-xs text-slate-600">
                {off.map((e) => (
                  <li key={e.id}>
                    {new Date(e.created_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                    <span className="font-medium">{nameOf(e.staff_id)}</span> ·{" "}
                    {e.kind === "quick" ? "빠른 시험" : e.kind === "trial" ? "모델 비교" : "채점"} · {e.pages}쪽 · $
                    {Number(e.cost_usd ?? 0).toFixed(3)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 요일마다 따로 정합니다.
 *
 * 학원은 토요일만 오전이거나 금요일만 늦게 끝나는 일이 흔합니다. 한 쌍으로
 * 묶어두면 **'근무 시간 외' 숫자가 틀리고, 그 숫자로 직원을 봅니다.**
 */
function HoursForm({
  db,
  cfg,
  onSaved,
  onError,
}: {
  db: SupabaseClient;
  cfg: SettingsRow;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [rows, setRows] = useState<WorkHours>(normalizeHours(cfg.work_hours) ?? DEFAULT_HOURS);
  const [busy, setBusy] = useState(false);

  const set = (d: number, h: DayHours) => setRows((p) => p.map((x, i) => (i === d ? h : x)));
  const firstOn = rows.find(Boolean) as NonNullable<DayHours> | undefined;

  async function save() {
    const bad = rows.findIndex((h) => h && h.start >= h.end);
    if (bad >= 0) return onError(`${DAY_NAMES[bad]}요일: 시작 시각이 끝 시각보다 빨라야 합니다.`);
    setBusy(true);
    try {
      await saveSettings(db, rows);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 border-t border-slate-200 pt-2">
      <div className="space-y-1">
        {DAY_NAMES.map((name, d) => {
          const h = rows[d];
          return (
            <div key={d} className="flex items-center gap-2">
              <button
                onClick={() => set(d, h ? null : (firstOn ?? { start: 13, end: 23 }))}
                className={`h-7 w-7 shrink-0 rounded border text-xs ${
                  h ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-400"
                }`}
              >
                {name}
              </button>
              {h ? (
                <>
                  <Hour value={h.start} onChange={(v) => set(d, { ...h, start: v })} />
                  <span className="text-slate-400">~</span>
                  <Hour value={h.end} onChange={(v) => set(d, { ...h, end: v })} to />
                </>
              ) : (
                <span className="text-slate-400">근무일 아님</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => void save()} disabled={busy} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40">
          {busy ? "…" : "저장"}
        </button>
        {/* 대부분 같은 시간이고 하루 이틀만 다른 경우가 많습니다. 그 하루를 위해 일곱 번 고르게 두지 않습니다. */}
        {firstOn && (
          <button
            onClick={() => setRows((p) => p.map((x) => (x ? { ...firstOn } : null)))}
            className="rounded border border-slate-300 px-2 py-1 text-slate-600"
          >
            근무일 모두 {String(firstOn.start).padStart(2, "0")}:00~{String(firstOn.end).padStart(2, "0")}:00 로
          </button>
        )}
      </div>
    </div>
  );
}

function Hour({ value, onChange, to }: { value: number; onChange: (v: number) => void; to?: boolean }) {
  const opts = to ? Array.from({ length: 24 }, (_, i) => i + 1) : Array.from({ length: 24 }, (_, i) => i);
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded border border-slate-300 px-1 py-0.5"
    >
      {opts.map((h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// 직원
// ---------------------------------------------------------------------------

const ROLE_NAMES: Record<Role, string> = { assistant: "조교", teacher: "선생님", admin: "관리자" };

function People({ db, meId, onError }: { db: SupabaseClient; meId: string; onError: (m: string) => void }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "assistant" as Role });
  const [made, setMade] = useState<string | null>(null);

  const load = useCallback(async () => setRows(await allStaff(db)), [db]);
  useEffect(() => {
    void load().catch((e) => onError(String(e.message ?? e)));
  }, [load, onError]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMade(null);
    try {
      const { data } = await db.auth.getSession();
      const r = await fetch("/api/staff", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify(form),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      setMade(`${form.email} 계정을 만들었습니다. 비밀번호를 본인에게 직접 전달하십시오.`);
      setForm({ email: "", password: "", name: "", role: "assistant" });
      setOpen(false);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, p: { role?: Role; active?: boolean }) {
    try {
      await updateStaff(db, id, p);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * 임시 비밀번호를 새로 발급합니다. **비밀번호를 잊어 로그인조차 안 될 때**입니다.
   *
   * 원장님이 직접 정하게 둡니다 — 무작위로 만들어 화면에 띄우면 그걸 다시
   * 받아 적어 전달해야 하고, 옮겨 적다 틀리면 또 못 들어옵니다.
   */
  async function resetPassword(id: string, name: string) {
    const pw = prompt(`${name || "이 직원"}의 임시 비밀번호를 정하십시오 (${MIN_PASSWORD}자 이상).`);
    if (pw === null) return;
    setBusy(true);
    setMade(null);
    try {
      const { data } = await db.auth.getSession();
      const r = await fetch("/api/staff", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ id, password: pw }),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      setMade(`${name || "직원"}의 비밀번호를 새로 정했습니다. 본인에게 직접 전달하고, 본인이 「내 계정」에서 다시 바꾸게 하십시오.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">직원</h2>
        <button onClick={() => setOpen((v) => !v)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          {open ? "취소" : "계정 만들기"}
        </button>
      </div>

      {made && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">{made}</p>}

      {/*
        직접 가입한 신청은 **꺼진 행**으로 들어옵니다(docs/13 §13.31).
        켜는 것이 곧 승인입니다. 모르는 이름이면 켜지 말고 지우십시오 —
        주소만 알면 누구나 가입 신청까지는 할 수 있습니다.
      */}
      {rows.some((r) => !r.active) && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          🔶 꺼진 계정 {rows.filter((r) => !r.active).length}개 — 새 <strong>가입 신청</strong>이거나 사용 중지된
          계정입니다. 아는 사람이면 <strong>켜기 = 승인</strong>이고, 모르는 이름이면 켜지 마십시오.
        </p>
      )}

      {open && (
        <form onSubmit={create} className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="이메일"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="이름"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={`비밀번호 (${MIN_PASSWORD}자 이상)`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {(Object.keys(ROLE_NAMES) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 sm:col-span-2">
            비밀번호가 화면에 그대로 보입니다 — <strong>적어서 본인에게 직접 전달</strong>하고, 본인이{" "}
            <strong>「내 계정」에서 바꾸게</strong> 하십시오. 여기서는 다시 볼 수 없습니다.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 sm:col-span-2"
          >
            {busy ? "만드는 중…" : "만들기"}
          </button>
        </form>
      )}

      <ul className="mt-3 divide-y divide-slate-100">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <p className={`font-medium ${s.active ? "" : "text-slate-400 line-through"}`}>{s.name || "(이름 없음)"}</p>
              <p className="text-xs text-slate-500">{s.active ? ROLE_NAMES[s.role] : "사용 중지"}</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <select
                value={s.role}
                onChange={(e) => void patch(s.id, { role: e.target.value as Role })}
                disabled={s.id === meId}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              >
                {(Object.keys(ROLE_NAMES) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r]}
                  </option>
                ))}
              </select>
              {/*
                비밀번호를 잊으면 로그인 자체가 안 돼서 「내 계정」에 못 들어갑니다.
                그때 풀 수 있는 사람은 관리자뿐입니다(§13.39).
              */}
              <button
                onClick={() => void resetPassword(s.id, s.name)}
                disabled={busy}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              >
                비밀번호 재발급
              </button>
              {/* 자기 자신은 못 끕니다 — 관리자가 스스로를 잠그면 되돌릴 길이 SQL뿐입니다. */}
              <button
                onClick={() => void patch(s.id, { active: !s.active })}
                disabled={s.id === meId}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
              >
                {s.active ? "사용 중지" : "다시 켜기"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        퇴사자는 <strong>지우지 않고 중지</strong>합니다. 행을 지우면 그 사람이 채점한 기록이 주인을 잃습니다.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        🔶 <strong>비밀번호 재발급은 남의 계정에 들어갈 수 있는 힘입니다.</strong> 발급한 비밀번호로
        로그인하면 사용·확정 기록에 <strong>그 사람 이름</strong>이 남습니다. 발급했으면 본인에게 전달하고
        <strong> 본인이 「내 계정」에서 다시 바꾸게</strong> 하십시오.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 사진 보관
// ---------------------------------------------------------------------------

function Retention({ db, onError }: { db: SupabaseClient; onError: (m: string) => void }) {
  const [st, setSt] = useState<RetentionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => setSt(await retentionStatus(db)), [db]);
  useEffect(() => {
    void load().catch((e) => onError(String(e.message ?? e)));
  }, [load, onError]);

  async function purge() {
    if (!confirm("보관 기간이 지난 사진을 지웁니다. 되돌릴 수 없습니다.")) return;
    setBusy(true);
    setDone(null);
    try {
      const { data } = await db.auth.getSession();
      const r = await fetch("/api/retention", { headers: { authorization: `Bearer ${data.session?.access_token ?? ""}` } });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      setDone(j.deleted === 0 ? "지울 사진이 없었습니다." : `사진 ${j.deleted}장을 지웠습니다.`);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">사진 보관 — 90일</h2>
      <p className="mt-1 text-sm text-slate-600">
        답안지 사진은 <strong>촬영일로부터 90일</strong>이 지나면 지웁니다. 매일 새벽 3시에 자동으로 돌아갑니다.
        채점 결과는 사진과 별개로 남습니다.
      </p>

      {st === null ? (
        <p className="mt-4 text-sm text-slate-500">불러오는 중…</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="갖고 있는 사진" value={st.kept.toLocaleString()} />
            <Stat label="지워야 할 사진" value={st.expired.toLocaleString()} tone={st.expired > 0 ? "warn" : undefined} />
            <Stat label="지운 기록" value={st.purged.toLocaleString()} />
            <Stat label="가장 오래된 사진" value={st.oldest ? new Date(st.oldest).toLocaleDateString("ko-KR") : "—"} />
          </dl>
          {st.expired > 0 ? (
            <p className="mt-3 rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
              🔶 보관 기간이 지난 사진이 <strong>{st.expired}장</strong> 남아 있습니다. 자동 실행이 아직 안 돌았거나
              실패했을 수 있습니다.
            </p>
          ) : (
            <p className="mt-3 rounded-lg bg-slate-100 p-2 text-sm text-slate-700">
              보관 기간이 지난 사진이 없습니다. 약속대로 지켜지고 있습니다.
            </p>
          )}
        </>
      )}

      {done && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">{done}</p>}

      <button
        onClick={() => void purge()}
        disabled={busy}
        className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
      >
        {busy ? "지우는 중…" : "지금 정리하기"}
      </button>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-lg font-bold ${tone === "warn" ? "text-amber-700" : ""}`}>{value}</dd>
      {sub && <dd className="text-xs text-slate-500">{sub}</dd>}
    </div>
  );
}
