import { NextResponse } from "next/server";
import { anthropic, costUsd } from "@/lib/grading/client";
import { readAnswerKeyText } from "@/lib/grading/stages";
import { bearer, userClient } from "@/lib/db/client";
import { gradingOptions, me, recordUsage } from "@/lib/db/queries";
import { driveConfig } from "@/lib/drive/auth";
import { downloadFile, listAnswerKeyFiles } from "@/lib/drive/client";
import { titleFromName } from "@/lib/drive/names";
import { hasTextLayer, pdfText, SCANNED } from "@/lib/drive/pdf";
import type { StaffRow } from "@/lib/db/schema";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * **구글 폴더에서 정답지를 가져옵니다**(docs/13 §13.45, docs/17).
 *
 * 선생님들은 이미 매번 정답지를 구글 폴더에 올립니다. 조교가 그걸 다시
 * 종이로 뽑아 사진 찍는 것은 같은 일을 두 번 하는 것입니다.
 *
 * 🔴 **여기서도 저장은 안 합니다.** 읽은 결과를 화면이 표로 보여주고,
 * 사람이 확인·수정한 뒤에 저장합니다 — 사진으로 올릴 때와 똑같습니다.
 * 정답지가 틀리면 그 시험을 본 반 전체가 같은 오류로 채점됩니다.
 * 자동으로 집어넣지 않는 이유가 그것입니다.
 */

async function staffOr401(req: Request): Promise<{ db: SupabaseClient; staff: StaffRow } | NextResponse> {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const db = userClient(token);
  const staff = await me(db).catch(() => null);
  // 조교도 씁니다 — 정답을 정하는 사람은 선생님이고, 조교가 하는 일은
  // 그 종이(이제는 파일)를 프로그램에 넣는 것뿐입니다(§13.43).
  if (!staff?.active) return NextResponse.json({ error: "승인된 직원만 할 수 있습니다." }, { status: 403 });
  return { db, staff };
}

/** 폴더에 올라와 있는 정답지 목록. **돈이 안 나갑니다.** */
export async function GET(req: Request) {
  const auth = await staffOr401(req);
  if (auth instanceof NextResponse) return auth;

  const cfg = driveConfig();
  /*
    연결이 안 돼 있는 것은 **오류가 아닙니다.** 환경 변수를 아직 안 넣은
    상태이고, 사진으로 올리는 길은 그대로 있습니다. 화면이 버튼을 감추면
    될 뿐이라 200으로 돌려줍니다.
  */
  if (!cfg) return NextResponse.json({ configured: false, files: [] });

  try {
    return NextResponse.json({ configured: true, files: await listAnswerKeyFiles(cfg) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[drive/keys]", message);
    return NextResponse.json({ configured: true, error: message }, { status: 502 });
  }
}

/** 고른 파일 하나를 읽어 `{title, items}`로 돌려줍니다. 저장은 안 합니다. */
export async function POST(req: Request) {
  const auth = await staffOr401(req);
  if (auth instanceof NextResponse) return auth;
  const { db } = auth;

  const cfg = driveConfig();
  if (!cfg) return NextResponse.json({ error: "구글 폴더가 아직 연결돼 있지 않습니다." }, { status: 400 });

  let fileId = "";
  let name = "";
  try {
    const b = (await req.json()) as { fileId?: string; name?: string };
    fileId = String(b?.fileId ?? "");
    name = String(b?.name ?? "");
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  if (!fileId) return NextResponse.json({ error: "어느 파일인지 안 왔습니다." }, { status: 400 });

  const t0 = Date.now();
  try {
    const bytes = await downloadFile(fileId, cfg);
    const extracted = await pdfText(bytes);
    /*
      스캔본입니다. **여기서 사진 경로로 넘기지 않습니다** — 페이지를
      이미지로 만들어 모델에 보내는 길을 붙일 수는 있지만, 그건 조교가
      종이를 찍는 것과 값도 정확도도 같습니다. 이미 있는 길을 쓰라고
      말하는 편이 낫습니다.
    */
    if (!hasTextLayer(extracted)) {
      return NextResponse.json({ error: SCANNED }, { status: 422 });
    }

    const client = anthropic();
    const { useRefs: _useRefs, ...opts } = await gradingOptions(db);
    const r = await readAnswerKeyText(client, extracted.text, opts);

    await recordUsage(db, {
      kind: "quick",
      sheet_id: null,
      pages: extracted.pages,
      cost_usd: costUsd([r.usage], r.usage.model),
      latency_ms: Date.now() - t0,
      model: r.usage.model,
      effort: r.usage.effort ?? null,
      ok: true,
    });

    // 머리글에 제목이 없으면 파일 이름에서 뽑습니다 — 사람이 고칠 출발점입니다.
    return NextResponse.json({ title: r.title || titleFromName(name), items: r.items });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[drive/keys]", message);
    await recordUsage(db, {
      kind: "quick",
      sheet_id: null,
      pages: 0,
      cost_usd: null,
      latency_ms: Date.now() - t0,
      model: null,
      effort: null,
      ok: false,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
