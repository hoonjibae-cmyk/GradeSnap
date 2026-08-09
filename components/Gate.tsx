"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AcademyLine, Backdrop, BrandMark, ScanCard } from "@/components/Brand";
import { Crown } from "@/components/Logo";
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

  // 로그인 전 세 화면은 **같은 배경 위에** 올립니다. 확인 중에만 흰 화면이
  // 번쩍이면 앱이 두 개인 것처럼 보입니다.
  if (state === "loading") {
    return (
      <Backdrop>
        <BrandMark />
        <p className="mt-6 text-sm text-cyan-100/80">불러오는 중…</p>
      </Backdrop>
    );
  }

  if (state === "notstaff") {
    return (
      <Backdrop>
        <BrandMark />
        <div className="mt-8 w-full max-w-sm">
          <ScanCard>
            <p className="text-sm text-white">
              로그인은 됐지만 <strong>직원 명부에 없습니다.</strong>
              <br />
              <span className="text-cyan-100/80">원장님께 등록을 요청하십시오.</span>
            </p>
            <button
              onClick={() => void db?.auth.signOut()}
              className="mt-4 w-full rounded-xl border border-white/30 px-4 py-2.5 text-sm font-medium text-white"
            >
              로그아웃
            </button>
          </ScanCard>
        </div>
        <div className="mt-10">
          <AcademyLine />
        </div>
      </Backdrop>
    );
  }

  if (state === "out") {
    const field =
      "block w-full rounded-xl border border-white/25 bg-white/15 px-3.5 py-2.5 text-sm text-white " +
      "placeholder:text-white/60 focus:border-cyan-200/70 focus:bg-white/20 focus:outline-none";
    return (
      <Backdrop>
        <BrandMark />
        <div className="mt-8 flex w-full max-w-sm justify-center">
          <ScanCard>
            <form onSubmit={signIn} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일"
                autoComplete="username"
                className={field}
              />
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="비밀번호"
                autoComplete="current-password"
                className={field}
              />
              {err && (
                <p className="rounded-xl border border-rose-200/50 bg-rose-500/25 p-2.5 text-sm text-white">{err}</p>
              )}
              <button
                type="submit"
                disabled={busy || !email || !pw}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-300 to-teal-300 px-4 py-2.5 font-bold text-[#0B3A8F] shadow-lg shadow-cyan-500/20 transition disabled:opacity-40"
              >
                {busy ? "확인 중…" : "로그인"}
              </button>
            </form>
          </ScanCard>
        </div>
        <div className="mt-10">
          <AcademyLine />
        </div>
      </Backdrop>
    );
  }

  return <>{children(db!, staff!)}</>;
}

const ROLE_LABEL: Record<StaffRow["role"], string> = { assistant: "조교", teacher: "선생님", admin: "관리자" };

/**
 * 화면 위쪽에 늘 붙는 줄.
 *
 * **메뉴를 화면마다 넘기지 않고 여기서 만듭니다.** 예전에는 각 화면이 링크를
 * 넘겨줬는데, 그래서 화면마다 메뉴가 달랐고 휴대폰에서는 줄이 넘쳐
 * '명 단' '관 리' 처럼 글자가 쪼개졌습니다.
 *
 * 휴대폰에서는 이름을 누르면 메뉴가 열리고, 넓은 화면에서는 그대로 펼칩니다.
 * 조교는 대부분 접수 화면에만 있으므로 메뉴를 접어두는 손해가 거의 없습니다.
 */
export function Bar({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    { href: "/", label: "접수" },
    { href: "/roster", label: "명단" },
    { href: "/quick", label: "빠른 시험" },
    ...(staff.role === "admin"
      ? [
          { href: "/bench", label: "모델 비교" },
          { href: "/admin", label: "관리" },
        ]
      : []),
  ];
  // 답안지 상세(/sheets/…)에서는 접수를 현재 위치로 봅니다 — 거기서 넘어온 화면입니다.
  const here = (href: string) => (href === "/" ? path === "/" || path.startsWith("/sheets") : path.startsWith(href));

  return (
    <header className="mb-5 border-b border-slate-200 pb-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <a href="/" className="inline-flex shrink-0 items-center gap-1.5 font-bold">
          <Crown className="h-5 w-auto" />
          GradeSnap
        </a>

        {/* 넓은 화면 — 그대로 펼칩니다 */}
        <nav className="hidden flex-1 items-center gap-4 sm:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={here(l.href) ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-700"}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 text-slate-500 sm:flex">
          <span className="whitespace-nowrap">
            {staff.name || "이름 없음"} · {ROLE_LABEL[staff.role]}
          </span>
          <button onClick={() => void db.auth.signOut()} className="underline">
            로그아웃
          </button>
        </div>

        {/* 휴대폰 — 이름을 눌러 엽니다. 누구로 들어와 있는지는 접지 않고 늘 보입니다. */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex max-w-[60%] items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-600 sm:hidden"
        >
          <span className="truncate">{staff.name || "이름 없음"}</span>
          <span className="text-xs text-slate-400">{open ? "▲" : "▼"}</span>
        </button>
      </div>

      {open && (
        <nav className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`rounded-lg border px-3 py-2 text-center ${
                here(l.href) ? "border-slate-900 bg-slate-900 font-medium text-white" : "border-slate-300 text-slate-700"
              }`}
            >
              {l.label}
            </a>
          ))}
          <button
            onClick={() => void db.auth.signOut()}
            className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-slate-500"
          >
            로그아웃 ({ROLE_LABEL[staff.role]})
          </button>
        </nav>
      )}
    </header>
  );
}
