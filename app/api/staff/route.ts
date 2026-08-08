import { NextResponse } from "next/server";
import { adminClient, bearer, userClient } from "@/lib/db/client";
import { me } from "@/lib/db/queries";
import type { Role } from "@/lib/db/schema";

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
  if (password.length < 10) {
    return NextResponse.json({ error: "비밀번호는 10자 이상으로 정해 주십시오." }, { status: 400 });
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
