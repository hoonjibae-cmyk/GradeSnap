"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { retentionStatus, type RetentionStatus } from "@/lib/db/queries";
import type { StaffRow } from "@/lib/db/schema";

/**
 * 관리 화면 — 지금은 **사진 보관**만 있습니다.
 *
 * 매일 새벽 3시에 Vercel Cron이 알아서 지웁니다. 이 화면은 그게 **정말 돌고
 * 있는지 보는 곳**이고, 필요하면 손으로도 돌립니다. 동의서에 "90일 후 자동 파기"를
 * 적는 이상 그 약속이 지켜지는지 확인할 데가 있어야 합니다(docs/14 §14.5).
 */
export default function AdminPage() {
  return <Gate>{(db, staff) => <Admin db={db} staff={staff} />}</Gate>;
}

function Admin({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [st, setSt] = useState<RetentionStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSt(await retentionStatus(db));
  }, [db]);

  useEffect(() => {
    void load().catch((e) => setErr(String(e.message ?? e)));
  }, [load]);

  async function purge() {
    if (!confirm("보관 기간이 지난 사진을 지웁니다. 되돌릴 수 없습니다.")) return;
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const { data } = await db.auth.getSession();
      const r = await fetch("/api/retention", {
        headers: { authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      setDone(
        j.deleted === 0
          ? "지울 사진이 없었습니다."
          : `사진 ${j.deleted}장을 지웠습니다.${j.remaining ? " 남은 것은 다음 실행이 이어서 합니다." : ""}`,
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
    <main className="mx-auto max-w-3xl p-5 pb-24">
      <Bar db={db} staff={staff}>
        <a href="/" className="text-slate-500 underline">
          접수
        </a>
      </Bar>

      <header className="mb-4">
        <h1 className="text-xl font-bold">관리</h1>
      </header>

      {err && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">사진 보관 — 90일</h2>
        <p className="mt-1 text-sm text-slate-600">
          답안지 사진은 <strong>촬영일로부터 90일</strong>이 지나면 지웁니다. 매일 새벽 3시에 자동으로
          돌아갑니다. 채점 결과는 사진과 별개로 남습니다.
        </p>

        {st === null ? (
          <p className="mt-4 text-sm text-slate-500">불러오는 중…</p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="갖고 있는 사진" value={st.kept.toLocaleString()} />
              <Stat
                label="지워야 할 사진"
                value={st.expired.toLocaleString()}
                tone={st.expired > 0 ? "warn" : undefined}
              />
              <Stat label="지운 기록" value={st.purged.toLocaleString()} />
              <Stat
                label="가장 오래된 사진"
                value={st.oldest ? new Date(st.oldest).toLocaleDateString("ko-KR") : "—"}
              />
            </dl>

            {st.expired > 0 ? (
              <p className="mt-3 rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
                🔶 보관 기간이 지난 사진이 <strong>{st.expired}장</strong> 남아 있습니다. 자동 실행이 아직
                안 돌았거나 실패했을 수 있습니다.
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
        <p className="mt-2 text-xs text-slate-500">
          자동 실행을 기다리지 않고 바로 돌립니다. <strong>사진 파일이 지워지고 되돌릴 수 없습니다.</strong>{" "}
          어느 답안지에 사진이 있었는지는 기록으로 남습니다.
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-lg font-bold ${tone === "warn" ? "text-amber-700" : ""}`}>{value}</dd>
    </div>
  );
}
