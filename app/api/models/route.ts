import { NextResponse } from "next/server";
import { listModels } from "@/lib/grading/client";
import { bearer, userClient } from "@/lib/db/client";
import { me } from "@/lib/db/queries";

export const runtime = "nodejs";

/**
 * **이 계정이 실제로 부를 수 있는 모델 목록.**
 *
 * 만든 계기: Anthropic 영업이 "claude-opus-5는 없다"고 두 번 주장했습니다
 * (2026-08-11). 우리 쪽 증거는 그 ID로 13장을 채점하고 $2.04를 낸 기록이지만,
 * 문서 대 문서로 다투는 대신 **양쪽이 합의한 심판**을 부릅니다 — Models API는
 * 이 키로 쓸 수 있는 모델을 그대로 돌려주고, 그 응답이 계정의 진실입니다.
 *
 * 관리자만 봅니다. 비밀은 아니지만, 계정 상태를 묻는 호출을 아무나 누르게
 * 둘 이유도 없습니다.
 */
export async function GET(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const db = userClient(token);
  const staff = await me(db).catch(() => null);
  if (!staff?.active || staff.role !== "admin") {
    return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  }
  try {
    return NextResponse.json({ models: await listModels() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
