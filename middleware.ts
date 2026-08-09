import { NextResponse, type NextRequest } from "next/server";
import { canonicalHost } from "@/lib/canonical";

/**
 * 옛 주소로 들어오면 새 주소로 넘깁니다. 규칙은 `lib/canonical.ts`에 있습니다.
 *
 * **`CANONICAL_HOST`가 없으면 아무 일도 안 합니다.** 도메인 연결이 확인된
 * 뒤에 Vercel 환경 변수로 켜십시오.
 */
export function middleware(req: NextRequest) {
  const target = canonicalHost({
    host: req.headers.get("host"),
    canonical: process.env.CANONICAL_HOST,
    method: req.method,
    isProduction: process.env.VERCEL_ENV === "production",
  });
  if (!target) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.host = target;
  url.port = "";
  url.protocol = "https:";
  // 308이라야 브라우저가 주소를 갈아끼웁니다. 302면 북마크가 안 바뀝니다.
  return NextResponse.redirect(url, 308);
}

export const config = {
  // 정적 파일과 이미지는 넘길 이유가 없습니다 — 옛 주소에서도 잘 나옵니다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
