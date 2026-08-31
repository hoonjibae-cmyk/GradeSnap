/**
 * 구글 드라이브를 **읽기만** 하는 열쇠(docs/17).
 *
 * 선생님들은 이미 매번 정답지를 구글 폴더에 올립니다. 조교가 그걸 다시
 * 종이로 뽑아 사진 찍는 것은 같은 일을 두 번 하는 것입니다. 그래서
 * 프로그램이 그 폴더를 직접 봅니다(§13.45).
 *
 * ---
 *
 * ## 왜 라이브러리를 안 쓰나
 *
 * `googleapis`는 이 일 하나에 견줘 너무 큽니다. 우리가 부르는 것은 **파일
 * 목록과 내려받기 두 가지**뿐이고, 그 앞에 필요한 것은 서비스 계정으로
 * 토큰을 받는 것 하나입니다. 서명은 Node에 이미 들어 있습니다.
 *
 * ## 🔴 권한은 읽기 하나입니다
 *
 * `drive.readonly`. 프로그램이 선생님들의 폴더에 **쓸 수 있으면 안 됩니다** —
 * 정답지를 지우거나 덮는 사고가 났을 때 되돌릴 방법이 없습니다. 범위를
 * 넓히고 싶어지면 그때가 다시 생각할 때입니다.
 *
 * ## 무엇이 서버 전용인가
 *
 * `GOOGLE_SERVICE_ACCOUNT_KEY`는 **개인 열쇠**입니다. 브라우저에 나가면 그
 * 폴더를 아무나 읽습니다. `NEXT_PUBLIC_` 접두사를 붙이지 마십시오.
 */

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** 토큰 수명 요청. 구글이 주는 것은 보통 3600초입니다. */
const LIFETIME = 3600;
/** 만료 직전에 쓰다 걸리지 않게 미리 버립니다. */
const EARLY = 60;

export interface DriveConfig {
  email: string;
  key: string;
  folderId: string;
}

/**
 * 환경 변수를 읽습니다. **하나라도 없으면 `null`** — 이 기능만 조용히
 * 꺼지고 나머지는 그대로 돕니다. 사진으로 올리는 길이 그대로 있습니다.
 */
export function driveConfig(): DriveConfig | null {
  const email = unquote(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  /*
    JSON 파일에서 값을 복사할 때 **따옴표까지 같이 딸려 옵니다.** 그리고
    Vercel 환경 변수 칸은 줄바꿈을 못 받는 경우가 있어 `\n`이 두 글자
    그대로 들어옵니다. 둘 다 여기서 되돌립니다.

    이걸 안 하면 열쇠가 통째로 못 읽히는데, 화면에 뜨는 것은 "서명 실패"
    같은 말이라 **사람은 자기가 뭘 잘못했는지 알 길이 없습니다.** 설정을
    한 번만 하는 기능일수록 그 한 번에서 막히면 안 됩니다.
  */
  const key = unquote(process.env.GOOGLE_SERVICE_ACCOUNT_KEY).replace(/\\n/g, "\n");
  const folderId = unquote(process.env.DRIVE_FOLDER_ID);
  if (!email || !key || !folderId) return null;
  return { email, key, folderId };
}

/** 앞뒤 공백과 **감싼 따옴표**를 뗍니다. */
export function unquote(v: string | undefined): string {
  const s = (v ?? "").trim();
  const quoted = s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")));
  return quoted ? s.slice(1, -1).trim() : s;
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cached: { token: string; until: number } | null = null;

/**
 * 접근 토큰. **한 시간짜리라 받아 두고 씁니다.**
 *
 * 서버리스라 함수가 살아 있는 동안만 남지만, 답안지 여러 장을 이어
 * 채점하는 동안 토큰 요청이 매번 나가는 것은 그만큼 느려지는 일입니다.
 */
export async function accessToken(cfg: DriveConfig, now = Date.now()): Promise<string> {
  if (cached && cached.until > now) return cached.token;

  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({ iss: cfg.email, scope: SCOPE, aud: TOKEN_URL, exp: iat + LIFETIME, iat }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  let signature: string;
  try {
    signature = b64url(signer.sign(cfg.key));
  } catch (e) {
    // 열쇠를 잘못 붙여 넣는 것이 가장 흔한 사고입니다. 그렇게 말해 줍니다.
    throw new Error(
      `구글 서비스 계정 열쇠를 읽을 수 없습니다 — GOOGLE_SERVICE_ACCOUNT_KEY가 ` +
        `'-----BEGIN PRIVATE KEY-----'로 시작하는지 확인하십시오. (${e instanceof Error ? e.message : String(e)})`,
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`구글 인증에 실패했습니다 (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = JSON.parse(body) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("구글이 토큰을 안 줬습니다.");

  cached = { token: json.access_token, until: now + ((json.expires_in ?? LIFETIME) - EARLY) * 1000 };
  return json.access_token;
}

/** 테스트와 열쇠 교체용. */
export function forgetToken(): void {
  cached = null;
}
