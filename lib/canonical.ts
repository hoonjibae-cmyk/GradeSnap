/**
 * 주소를 하나로 모읍니다.
 *
 * 도메인을 새로 붙여도 `*.vercel.app` 주소는 계속 살아 있습니다. 그러면
 * **두 주소가 서로 다른 사이트로 취급됩니다** — 로그인 세션도, 홈 화면
 * 아이콘도, 저장해둔 '반/철자' 설정도 따로 놉니다. 조교 한 사람이 두
 * 주소를 섞어 쓰면 매번 다시 로그인하게 됩니다.
 *
 * **`CANONICAL_HOST`를 넣기 전에는 아무 일도 하지 않습니다.**
 * DNS가 아직 안 붙었는데 넘겨버리면 앱이 통째로 사라집니다 — 그래서
 * 켜는 것을 사람 손에 남겨뒀습니다.
 */

export interface RedirectInput {
  /** 요청이 들어온 호스트. 포트가 붙어 있을 수 있습니다. */
  host: string | null;
  /** 가야 할 곳. 비어 있으면 아무것도 안 합니다. */
  canonical: string | undefined;
  method: string;
  /** 미리보기 배포까지 넘기면 미리보기가 쓸모없어집니다. */
  isProduction: boolean;
}

/** 넘길 곳의 호스트, 아니면 null. */
export function canonicalHost({ host, canonical, method, isProduction }: RedirectInput): string | null {
  const target = (canonical ?? "").trim().toLowerCase();
  if (!target) return null;
  if (!isProduction) return null;
  // POST를 넘기면 본문이 한 번 더 날아갑니다. 채점 요청이 두 번 나가는 것보다
  // 옛 주소로 API를 부르게 두는 편이 낫습니다 — 사람이 보는 화면만 옮깁니다.
  if (method !== "GET" && method !== "HEAD") return null;

  const from = (host ?? "").toLowerCase().split(":")[0];
  if (!from || from === target) return null;
  return target;
}
