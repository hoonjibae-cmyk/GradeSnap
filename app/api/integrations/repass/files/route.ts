import { NextResponse } from "next/server";
import { driveConfig } from "@/lib/drive/auth";
import { downloadFile, listRetestFiles } from "@/lib/drive/client";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

/** RePass 서버 전용 연결. Google 서비스 계정 열쇠는 GradeSnap 밖으로 보내지 않습니다. */
export async function GET(req: Request) {
  const secret = process.env.REPASS_INTEGRATION_KEY;
  if (!secret || secret.length < 32 || req.headers.get("x-repass-drive-key") !== secret) {
    return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  }
  const config = driveConfig();
  if (!config) return NextResponse.json({ error: "Google Drive 연결 설정이 없습니다." }, { status: 503 });

  try {
    const fileId = new URL(req.url).searchParams.get("fileId");
    if (!fileId) {
      const listing = await listRetestFiles(config);
      return NextResponse.json(listing, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (!/^[\w-]{10,200}$/.test(fileId)) return NextResponse.json({ error: "파일 ID가 올바르지 않습니다." }, { status: 400 });
    const bytes = await downloadFile(fileId, config);
    if (bytes.length > MAX_PDF_BYTES || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") {
      return NextResponse.json({ error: "출력할 수 있는 PDF가 아닙니다." }, { status: 422 });
    }
    return new Response(Uint8Array.from(bytes).buffer, { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("[repass/files]", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Google Drive 파일을 가져오지 못했습니다." }, { status: 502 });
  }
}

