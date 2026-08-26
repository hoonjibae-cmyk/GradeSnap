"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AcademyLine, Backdrop, BrandMark, ScanCard } from "@/components/Brand";
import { Crown } from "@/components/Logo";
import { browserClient } from "@/lib/db/client";
import { me, requestAccess } from "@/lib/db/queries";
import type { StaffRow } from "@/lib/db/schema";
import { MIN_PASSWORD } from "@/lib/password";

/**
 * 로그인 관문.
 *
 * **가입했다고 직원이 되지는 않습니다.** 직접 가입할 수 있지만(§13.31),
 * 그건 신청일 뿐입니다 — 관리자가 승인(People에서 켜기)하기 전에는
 * `is_staff()`가 false라 학생 손글씨와 이름이 담긴 어떤 화면에도 못 닿습니다.
 * "일단 보여주고 나중에 막자"가 안 되는 자리입니다.
 *
 * `signup`은 `/signup`에서만 켭니다 — 링크를 받고 들어온 사람에게 가입 칸을
 * 펼쳐 놓는 용도입니다. 주소를 나눠주려면 누를 곳이 아니라 **열자마자 그
 * 화면**이어야 합니다(§13.32).
 */
export function Gate({
  signup: startSignup = false,
  children,
}: {
  signup?: boolean;
  children: (db: SupabaseClient, staff: StaffRow) => React.ReactNode;
}) {
  // **브라우저에서만 만듭니다.** 빌드 시 미리 그려질 때 만들려 들면
  // 환경 변수가 없어 빌드가 통째로 죽습니다.
  const [db, setDb] = useState<SupabaseClient | null>(null);
  const [staff, setStaff] = useState<StaffRow | null>(null);
  const [state, setState] = useState<"loading" | "out" | "notstaff" | "pending" | "in">("loading");
  const [mode, setMode] = useState<"login" | "signup">(startSignup ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(db: SupabaseClient) {
    try {
      const { data } = await db.auth.getSession();
      if (!data.session) return setState("out");
      const s = await me(db);
      if (!s) {
        // 가입 때 적은 이름을 미리 채워둡니다. 신청 화면에서 또 안 물어봐도 되게.
        setName((data.session.user.user_metadata?.name as string) ?? "");
        return setState("notstaff");
      }
      setStaff(s);
      /*
        🔴 비활성 직원을 안으로 들이면 안 됩니다. RLS가 전부 막고 있어
        화면마다 오류가 쏟아집니다 — 승인 대기와 사용 중지 둘 다 여기서 멈춥니다.
      */
      setState(s.active ? "in" : "pending");
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

  /**
   * 직접 가입 → 승인 신청.
   *
   * Supabase 설정에 따라 두 갈래입니다.
   *   확인 메일 꺼짐 → 바로 세션이 생기고, 그 자리에서 신청 행을 넣습니다.
   *   확인 메일 켜짐 → 세션이 없습니다. 메일 안내를 띄우고, 확인 후
   *                    로그인하면 notstaff 화면이 신청을 받습니다.
   */
  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!db) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const { data, error } = await db.auth.signUp({
        email: email.trim(),
        password: pw,
        // 이름을 계정에 붙여둡니다 — 확인 메일을 거쳐 돌아와도 다시 안 묻게.
        options: { data: { name: name.trim() } },
      });
      if (error) throw new Error(
        error.message.includes("already registered")
          ? "이미 가입된 이메일입니다. 로그인해 주십시오."
          : error.message,
      );
      if (data.session) {
        await requestAccess(db, name);
        await refresh(db);
      } else {
        setMode("login");
        setNotice("확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 여기서 로그인하면 신청이 이어집니다.");
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!db) return;
    setBusy(true);
    setErr(null);
    try {
      await requestAccess(db, name);
      await refresh(db);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "block w-full rounded-xl border border-white/25 bg-white/15 px-3.5 py-2.5 text-sm text-white " +
    "placeholder:text-white/60 focus:border-cyan-200/70 focus:bg-white/20 focus:outline-none";

  // 로그인 전 화면들은 **같은 배경 위에** 올립니다. 확인 중에만 흰 화면이
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
              로그인은 됐지만 아직 <strong>직원 명부에 없습니다.</strong>
              <br />
              <span className="text-cyan-100/80">이름을 적어 승인을 신청하면 원장님이 확인합니다.</span>
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름 (실명)"
              className={`${field} mt-4`}
            />
            {err && (
              <p className="mt-3 rounded-xl border border-rose-200/50 bg-rose-500/25 p-2.5 text-sm text-white">{err}</p>
            )}
            <button
              onClick={() => void submitRequest()}
              disabled={busy || !name.trim()}
              className="mt-3 w-full rounded-xl bg-gradient-to-r from-cyan-300 to-teal-300 px-4 py-2.5 font-bold text-[#0B3A8F] shadow-lg shadow-cyan-500/20 disabled:opacity-40"
            >
              {busy ? "신청 중…" : "승인 신청"}
            </button>
            <button
              onClick={() => void db?.auth.signOut()}
              className="mt-2 w-full rounded-xl border border-white/30 px-4 py-2.5 text-sm font-medium text-white"
            >
              로그아웃
            </button>
            <HelpLink />
          </ScanCard>
        </div>
        <div className="mt-10">
          <AcademyLine />
        </div>
      </Backdrop>
    );
  }

  if (state === "pending") {
    return (
      <Backdrop>
        <BrandMark />
        <div className="mt-8 w-full max-w-sm">
          <ScanCard>
            {/*
              승인 대기와 사용 중지가 같은 화면입니다 — 굳이 안 가릅니다.
              "당신은 잘렸습니다"를 화면이 단정할 이유가 없고, 어느 쪽이든
              다음 행동은 같습니다: 원장님께 물어보기.
            */}
            <p className="text-sm text-white">
              <strong>{staff?.name || "신청"}</strong> — 신청이 접수됐습니다.
              <br />
              <span className="text-cyan-100/80">
                원장님이 승인하면 바로 쓸 수 있습니다. 이미 쓰던 계정이라면 사용이 중지된 상태이니
                원장님께 문의하십시오.
              </span>
            </p>
            <button
              onClick={() => db && void refresh(db)}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-cyan-300 to-teal-300 px-4 py-2.5 font-bold text-[#0B3A8F] shadow-lg shadow-cyan-500/20"
            >
              승인됐는지 확인
            </button>
            <button
              onClick={() => void db?.auth.signOut()}
              className="mt-2 w-full rounded-xl border border-white/30 px-4 py-2.5 text-sm font-medium text-white"
            >
              로그아웃
            </button>
            {/* 승인을 기다리는 동안 읽어두라고 여기에도 답니다 — 대기 화면이 가장 심심한 자리입니다. */}
            <HelpLink />
          </ScanCard>
        </div>
        <div className="mt-10">
          <AcademyLine />
        </div>
      </Backdrop>
    );
  }

  if (state === "out") {
    const signup = mode === "signup";
    return (
      <Backdrop>
        <BrandMark />
        <div className="mt-8 flex w-full max-w-sm justify-center">
          <ScanCard>
            <form onSubmit={signup ? signUp : signIn} className="space-y-3">
              {signup && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="이름 (실명)"
                  autoComplete="name"
                  className={field}
                />
              )}
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
                placeholder={signup ? `비밀번호 (${MIN_PASSWORD}자 이상)` : "비밀번호"}
                autoComplete={signup ? "new-password" : "current-password"}
                className={field}
              />
              {notice && (
                <p className="rounded-xl border border-cyan-200/50 bg-cyan-500/25 p-2.5 text-sm text-white">{notice}</p>
              )}
              {err && (
                <p className="rounded-xl border border-rose-200/50 bg-rose-500/25 p-2.5 text-sm text-white">{err}</p>
              )}
              <button
                type="submit"
                disabled={busy || !email || !pw || (signup && !name.trim())}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-300 to-teal-300 px-4 py-2.5 font-bold text-[#0B3A8F] shadow-lg shadow-cyan-500/20 transition disabled:opacity-40"
              >
                {busy ? "확인 중…" : signup ? "가입하고 승인 신청" : "로그인"}
              </button>
              {signup && (
                <p className="text-xs text-cyan-100/70">
                  가입해도 바로 쓸 수는 없습니다 — 원장님이 승인해야 화면이 열립니다.
                </p>
              )}
            </form>
            <button
              onClick={() => {
                setMode(signup ? "login" : "signup");
                setErr(null);
                setNotice(null);
              }}
              className="mt-3 w-full text-center text-sm text-cyan-100/80 underline"
            >
              {signup ? "이미 계정이 있습니다 — 로그인" : "처음입니다 — 계정 만들기"}
            </button>

            {/*
              업무용 고지 + 기록 고지. 뒤쪽이 법적으로 더 중요합니다 —
              직원의 사용 기록을 관리자가 보는 시스템이므로(§13.17), 쓰기
              전에 알렸다는 사실이 남아야 합니다(docs/14 §14.6 ⑦).
              로그인할 때마다 지나가는 자리라 "몰랐다"가 성립하지 않습니다.
            */}
            <p className="mt-4 border-t border-white/15 pt-3 text-center text-xs leading-relaxed text-cyan-100/70">
              이 시스템은 <strong className="text-white">목동유쌤영어학원 업무용</strong>입니다.
              <br />
              학생 답안지 채점 외의 용도로 사용할 수 없으며,
              <br />
              모든 사용은 로그(시각·건수·비용)로 기록·관리되고 관리자가 확인합니다.
            </p>
            <HelpLink />
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

/**
 * 로그인 전 화면에 다는 안내 링크.
 *
 * **`/help`는 로그인 없이 열립니다.** 처음 오는 조교는 계정도 승인도 없는
 * 상태로 안내를 읽어야 하고, 안내에는 학생 것이 한 글자도 없습니다.
 */
function HelpLink() {
  return (
    <a href="/help" className="mt-3 block text-center text-xs text-cyan-100/70 underline">
      처음 쓰십니까? 사용 안내 보기
    </a>
  );
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
    { href: "/keys", label: "정답지" },
    { href: "/account", label: "내 계정" },
    { href: "/help", label: "안내" },
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
