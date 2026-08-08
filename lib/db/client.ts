import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 접속. 세 가지가 필요하고, **셋을 섞으면 안 됩니다.**
 *
 * | 누가 | 무엇으로 | 왜 |
 * |---|---|---|
 * | 브라우저 | anon 키 + 로그인 세션 | RLS가 걸립니다. 직원이 아니면 아무것도 못 봅니다 |
 * | API 라우트 | 그 요청을 보낸 사람의 토큰 | `auth.uid()`가 살아 있어야 "누가 확정했나"가 남습니다 |
 * | 정리 작업 | 서비스 키 | 90일 지난 사진을 지우는 것은 사람이 아닙니다 |
 *
 * 편하다고 API 라우트에서 서비스 키를 쓰면 RLS가 통째로 꺼지고,
 * 확정자·검수자 기록이 전부 null이 됩니다. 그 기록이 정확도 데이터입니다.
 */

/**
 * 🔴 **글자 그대로 `process.env.NEXT_PUBLIC_...`이라고 써야 합니다.**
 *
 * Next.js는 브라우저로 나가는 코드에서 이 문자열을 **찾아서 값으로 바꿔치기**
 * 합니다. `process.env[name]`처럼 이름을 변수로 넘기면 바꿔칠 자리를 못 찾아
 * 브라우저에서는 `undefined`가 됩니다 — Vercel에 값을 제대로 넣어도 그렇습니다.
 * 실제로 이걸로 로그인 화면이 통째로 막혔습니다.
 *
 * 서버 전용 값(`SUPABASE_SERVICE_ROLE_KEY`)은 런타임에 읽히므로 상관없지만,
 * 같은 함정을 다시 파지 않도록 여기서도 똑같이 씁니다.
 */
function need(value: string | undefined, name: string): string {
  const v = (value ?? "").trim();
  if (!v) throw new Error(`${name}이(가) 설정되지 않았습니다.`);
  return v;
}

const url = () => need(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
const anon = () => need(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY");

let browser: SupabaseClient | null = null;

/** 브라우저에서 한 번만 만들어 씁니다. 로그인 세션을 들고 있습니다. */
export function browserClient(): SupabaseClient {
  if (!browser) {
    browser = createClient(url(), anon(), {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return browser;
}

/**
 * API 라우트에서 **요청자 자격으로** 접속합니다.
 * `Authorization: Bearer <access_token>` 헤더를 그대로 넘겨받습니다.
 */
export function userClient(accessToken: string): SupabaseClient {
  if (!accessToken) throw new Error("로그인이 필요합니다.");
  return createClient(url(), anon(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** 요청 헤더에서 토큰만 꺼냅니다. 없으면 null — 401로 답하십시오. */
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() || null : null;
}

/**
 * RLS를 우회합니다. **보관 기간이 끝난 사진을 지우는 정리 작업 전용**입니다.
 * 다른 곳에서 부르지 마십시오.
 */
export function adminClient(): SupabaseClient {
  return createClient(url(), need(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
