import { NextResponse } from "next/server";
import { adminClient, bearer, userClient } from "@/lib/db/client";
import { me } from "@/lib/db/queries";
import type { Role } from "@/lib/db/schema";
import { MIN_PASSWORD } from "@/lib/password";

export const runtime = "nodejs";

const ROLES: Role[] = ["assistant", "teacher", "admin"];

/**
 * 관리자가 직원 계정을 만듭니다.
 *
 * 계정 생성은 Supabase의 관리자 API라 **서비스 키가 필요합니다** — 그래서
 * 브라우저가 직접 못 하고 이 라우트를 거칩니다. 서비스 키를 쓰는 두 번째이자
 * 마지막 자리입니다(첫째는 사진 정리).
 *
 * **부르는 사람이 관리자인지는 서비스 키가 아니라 그 사람의 토큰으로 확인합니다.**
 * 서비스 키로 확인하면 RLS를 우회하니 아무 의미가 없습니다.
 */
export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const caller = await me(userClient(token)).catch(() => null);
  if (caller?.role !== "admin" || !caller.active) {
    return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });
  }

  let email: string;
  let password: string;
  let name: string;
  let role: Role;
  try {
    const b = (await req.json()) as { email?: string; password?: string; name?: string; role?: Role };
    email = String(b?.email ?? "").trim().toLowerCase();
    password = String(b?.password ?? "");
    name = String(b?.name ?? "").trim();
    role = (b?.role ?? "assistant") as Role;
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  if (!email.includes("@")) return NextResponse.json({ error: "이메일이 올바르지 않습니다." }, { status: 400 });
  // Supabase 기본 최소 길이는 6이지만, 조교들이 공용 기기에서 쓰는 계정이라 더 받습니다.
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `비밀번호는 ${MIN_PASSWORD}자 이상으로 정해 주십시오.` }, { status: 400 });
  }
  if (!ROLES.includes(role)) return NextResponse.json({ error: `모르는 역할입니다: ${role}` }, { status: 400 });

  const admin = adminClient();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    const m = created.error?.message ?? "계정을 만들지 못했습니다.";
    return NextResponse.json({ error: m.includes("already") ? "이미 있는 이메일입니다." : m }, { status: 400 });
  }

  const ins = await admin.from("staff").insert({ id: created.data.user.id, name: name || email.split("@")[0], role });
  if (ins.error) {
    // 명부에 못 넣으면 **계정만 떠도는 상태**가 됩니다. 로그인은 되는데 아무것도
    // 못 보는 유령이 생기므로 되돌립니다.
    await admin.auth.admin.deleteUser(created.data.user.id);
    return NextResponse.json({ error: `직원 등록: ${ins.error.message}` }, { status: 500 });
  }

  return NextResponse.json({ id: created.data.user.id });
}

/**
 * 관리자가 **임시 비밀번호를 새로 발급**합니다.
 *
 * 비밀번호를 잊으면 로그인 자체가 안 되므로 `/account`에 못 들어옵니다.
 * 그때 풀 수 있는 사람은 관리자뿐입니다. 메일 재설정 링크를 쓰지 않는
 * 이유는 Supabase 기본 메일이 시간당 몇 통으로 묶여 있어서, 정작 급할 때
 * 안 나가기 때문입니다(supabase/README 1.5).
 *
 * 🔴 **이건 남의 계정에 들어갈 수 있는 힘입니다.** 원장님이 조교 비밀번호를
 * 정하면 그 계정으로 로그인할 수도 있고, 그러면 사용 기록과 확정 기록에
 * 조교 이름이 남습니다. 그래서 화면에 **본인에게 전달하고 본인이 다시
 * 바꾸게 하라**고 적어둡니다. 코드로 막을 수 있는 종류가 아닙니다.
 */
export async function PATCH(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const caller = await me(userClient(token)).catch(() => null);
  if (caller?.role !== "admin" || !caller.active) {
    return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });
  }

  let id: string;
  let password: string;
  try {
    const b = (await req.json()) as { id?: string; password?: string };
    id = String(b?.id ?? "").trim();
    password = String(b?.password ?? "");
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  if (!id) return NextResponse.json({ error: "누구의 비밀번호인지 없습니다." }, { status: 400 });
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `비밀번호는 ${MIN_PASSWORD}자 이상으로 정해 주십시오.` }, { status: 400 });
  }

  const admin = adminClient();
  // 명부에 없는 사람의 비밀번호를 바꾸지 않습니다. 이 학원 직원만 다룹니다.
  const row = await admin.from("staff").select("id").eq("id", id).maybeSingle();
  if (row.error || !row.data) return NextResponse.json({ error: "직원 명부에 없는 계정입니다." }, { status: 404 });

  const res = await admin.auth.admin.updateUserById(id, { password });
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
