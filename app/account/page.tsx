"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import type { StaffRow } from "@/lib/db/schema";
import { checkNewPassword, MIN_PASSWORD } from "@/lib/password";

/**
 * 내 계정 — **비밀번호를 본인이 바꾸는 자리**입니다.
 *
 * 관리자가 계정을 만들 때 화면이 "본인이 바꾸게 하십시오"라고 안내하는데,
 * 정작 바꿀 자리가 없었습니다(§13.39). 그래서 임시 비밀번호가 그대로 남고,
 * 그 비밀번호는 종이나 메신저에 한 번 적힌 채 돌아다닙니다.
 *
 * 이름과 이메일은 여기서 못 바꿉니다 — **일부러입니다.** 이름은 사용 기록과
 * 확정 기록에서 사람을 가리키는 값이라, 본인이 아무 때나 바꾸면 "누가 했나"가
 * 흐려집니다. 원장님이 관리 화면에서 바꿉니다.
 */
export default function AccountPage() {
  return <Gate>{(db, staff) => <Account db={db} staff={staff} />}</Gate>;
}

function Account({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    const problem = checkNewPassword(current, next, confirm);
    if (problem) {
      setErr(problem);
      return;
    }
    setBusy(true);
    setErr(null);
    setDone(false);
    try {
      const { data } = await db.auth.getUser();
      const email = data.user?.email;
      if (!email) throw new Error("로그인 정보를 읽지 못했습니다. 다시 로그인해 주십시오.");

      /*
        🔴 **지금 비밀번호를 먼저 확인합니다.**

        Supabase는 로그인만 돼 있으면 확인 없이 바꿔줍니다. 그러면 조교가
        화면을 켜둔 채 자리를 비웠을 때 옆 사람이 비밀번호를 바꿔버릴 수
        있습니다. 학생 이름과 성적으로 이어지는 계정이라 그 한 단계를 둡니다.
      */
      const check = await db.auth.signInWithPassword({ email, password: current });
      if (check.error) throw new Error("지금 쓰는 비밀번호가 맞지 않습니다.");

      const res = await db.auth.updateUser({ password: next });
      if (res.error) throw new Error(res.error.message);

      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base";

  return (
    <main className="mx-auto max-w-md p-5 pb-24">
      <Bar db={db} staff={staff} />

      <h1 className="text-xl font-bold">내 계정</h1>
      <p className="mt-1 text-sm text-slate-600">{staff.name}</p>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium">비밀번호 바꾸기</h2>
        <p className="mt-1 text-xs text-slate-500">
          받은 임시 비밀번호를 쓰고 계시면 <strong>지금 바꾸십시오.</strong> 임시 비밀번호는 만들 때 한 번
          화면에 그대로 보였던 것입니다.
        </p>

        <label className="mt-4 block text-sm">
          <span className="text-slate-700">지금 쓰는 비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={field}
          />
        </label>

        <label className="mt-3 block text-sm">
          <span className="text-slate-700">새 비밀번호</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={`${MIN_PASSWORD}자 이상`}
            className={field}
          />
        </label>

        <label className="mt-3 block text-sm">
          <span className="text-slate-700">새 비밀번호 한 번 더</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={field}
          />
        </label>

        {err && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">{err}</p>}
        {done && (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
            바꿨습니다. <strong>다음 로그인부터 새 비밀번호를 쓰십시오.</strong>
          </p>
        )}

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-40"
        >
          {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </button>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-700">여기서 못 바꾸는 것</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>
            <strong>이름</strong> — 사용 기록과 확정 기록에서 사람을 가리키는 값입니다. 원장님께 말씀하시면
            바꿔 드립니다.
          </li>
          <li>
            <strong>이메일</strong> — 로그인 아이디입니다. 원장님께 말씀하십시오.
          </li>
          <li>
            <strong>비밀번호를 잊어 로그인 자체가 안 될 때</strong> — 이 화면에 못 들어옵니다. 원장님께
            말씀하시면 임시 비밀번호를 새로 발급해 드립니다.
          </li>
        </ul>
      </section>
    </main>
  );
}
