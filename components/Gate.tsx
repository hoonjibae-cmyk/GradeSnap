"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACADEMY, Crown, Wordmark } from "@/components/Logo";
import { browserClient } from "@/lib/db/client";
import { me } from "@/lib/db/queries";
import type { StaffRow } from "@/lib/db/schema";

/**
 * 로그인 관문.
 *
 * **가입했다고 직원이 되지는 않습니다.** 로그인은 됐는데 `staff` 표에 없으면
 * 아무것도 보여주지 않습니다 — 학생 손글씨와 이름이 담긴 화면이라
 * "일단 보여주고 나중에 막자"가 안 됩니다.
 */
export function Gate({ children }: { children: (db: SupabaseClient, staff: StaffRow) => React.ReactNode }) {
  // **브라우저에서만 만듭니다.** 빌드 시 미리 그려질 때 만들려 들면
  // 환경 변수가 없어 빌드가 통째로 죽습니다.
  const [db, setDb] = useState<SupabaseClient | null>(null);
  const [staff, setStaff] = useState<StaffRow | null>(null);
  const [state, setState] = useState<"loading" | "out" | "notstaff" | "in">("loading");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(db: SupabaseClient) {
    try {
      const { data } = await db.auth.getSession();
      if (!data.session) return setState("out");
      const s = await me(db);
      if (!s) return setState("notstaff");
      setStaff(s);
      setState("in");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("out");
    }
  }

  useEffect(() => {
    let client: SupabaseClient;
    try {
      client = browserClient();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("out");
      return;
    }
    setDb(client);
    void refresh(client);
    const { data } = client.auth.onAuthStateChange(() => void refresh(client));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!db) return;
    setBusy(true);
    setErr(null);
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) setErr(error.message === "Invalid login credentials" ? "이메일 또는 비밀번호가 맞지 않습니다." : error.message);
    setBusy(false);
  }

  if (state === "loading") return <p className="p-6 text-sm text-slate-500">불러오는 중…</p>;

  if (state === "notstaff") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <Wordmark stacked className="mb-6" />
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          로그인은 됐지만 <strong>직원 명부에 없습니다.</strong> 원장님께 등록을 요청하십시오.
        </p>
        <button onClick={() => void db?.auth.signOut()} className="mt-3 text-sm text-slate-500 underline">
          로그아웃
        </button>
      </main>
    );
  }

  if (state === "out") {
    return (
      <main className="mx-auto max-w-sm p-6 pt-12">
        <Wordmark stacked />
        <div className="mt-5 text-center">
          <h1 className="text-2xl font-bold tracking-tight">GradeSnap</h1>
          <p className="mt-1 text-sm text-slate-600">찍으면 채점되는 AI 답안 채점</p>
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">학원 계정으로 로그인하십시오.</p>
        <form onSubmit={signIn} className="mt-4 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            autoComplete="username"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="비밀번호"
            autoComplete="current-password"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {err && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">{err}</p>}
          <button
            type="submit"
            disabled={busy || !email || !pw}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {busy ? "확인 중…" : "로그인"}
          </button>
        </form>
        <p className="mt-8 text-center text-xs text-slate-400">{ACADEMY} 전용 · 직원만 이용할 수 있습니다</p>
      </main>
    );
  }

  return <>{children(db!, staff!)}</>;
}

/** 화면 위쪽에 늘 붙는 줄. 누구로 들어와 있는지가 보여야 합니다. */
export function Bar({ db, staff, children }: { db: SupabaseClient; staff: StaffRow; children?: React.ReactNode }) {
  const label = { assistant: "조교", teacher: "선생님", admin: "관리자" }[staff.role];
  return (
    <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-3 text-sm">
      <div className="flex items-center gap-3">
        <a href="/" className="inline-flex items-center gap-1.5 font-bold">
          <Crown className="h-5 w-auto" />
          GradeSnap
        </a>
        {children}
      </div>
      <div className="flex items-center gap-3 text-slate-500">
        <span>
          {staff.name || "이름 없음"} · {label}
        </span>
        <button onClick={() => void db.auth.signOut()} className="underline">
          로그아웃
        </button>
      </div>
    </div>
  );
}
