"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import {
  allStaff,
  getSettings,
  retentionStatus,
  saveSettings,
  updateStaff,
  usageBetween,
  type RetentionStatus,
} from "@/lib/db/queries";
import type { Role, SettingsRow, StaffRow, UsageEventRow } from "@/lib/db/schema";
import { byHour, byStaff, DAY_NAMES, describeHours, isOffHours, totals, type DayHours, type WorkHours } from "@/lib/usage";

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
      <Usage db={db} onError={setErr} />
      <People db={db} meId={staff.id} onError={setErr} />
      <Retention db={db} onError={setErr} />
    </main>
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

  const hours: WorkHours = cfg.work_hours;
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
  const [rows, setRows] = useState<WorkHours>(cfg.work_hours);
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
      const j = await r.json();
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

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">직원</h2>
        <button onClick={() => setOpen((v) => !v)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          {open ? "취소" : "계정 만들기"}
        </button>
      </div>

      {made && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">{made}</p>}

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
            placeholder="비밀번호 (10자 이상)"
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
            비밀번호가 화면에 그대로 보입니다 — <strong>적어서 본인에게 직접 전달</strong>하고, 본인이 바꾸게
            하십시오. 여기서는 다시 볼 수 없습니다.
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
      const j = await r.json();
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
