import { NextResponse } from "next/server";
import { adminClient, bearer, userClient } from "@/lib/db/client";
import { me, purgeExpired } from "@/lib/db/queries";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 90일이 지난 답안지 사진을 지웁니다.
 *
 * **동의서에 적는 약속입니다**(docs/14 §14.2). "촬영일로부터 90일 후 자동 파기"라고
 * 적어놓고 안 지우는 것이 가장 나쁩니다. 그래서 사람 손을 안 타는 경로를 둡니다.
 *
 * 두 가지로 불립니다.
 *
 * | 누가 | 무엇으로 |
 * |---|---|
 * | Vercel Cron (매일 새벽 3시 KST) | `Authorization: Bearer $CRON_SECRET` |
 * | 관리자가 화면에서 | 로그인 토큰 |
 *
 * 둘 다 아니면 404를 냅니다. **"권한 없음"이 아니라 없는 척합니다** —
 * 이 주소가 있다는 것 자체를 밖에 알릴 이유가 없습니다.
 */
export async function GET(req: Request) {
  const token = bearer(req);
  const secret = (process.env.CRON_SECRET ?? "").trim();

  let who: string;
  if (secret && token === secret) {
    who = "cron";
  } else if (token) {
    try {
      const staff = await me(userClient(token));
      if (staff?.role !== "admin") return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
      who = staff.name || "admin";
    } catch {
      return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
    }
  } else {
    return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  }

  try {
    const result = await purgeExpired(adminClient());
    // 지운 기록은 로그에 남깁니다. 나중에 "정말 돌고 있었나"를 물을 때 필요합니다.
    console.log("[retention]", who, JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[retention]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
