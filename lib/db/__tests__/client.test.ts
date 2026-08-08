import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 브라우저로 나가는 환경 변수는 **글자 그대로 써야** 합니다.
 *
 * Next.js가 `process.env.NEXT_PUBLIC_...`이라는 문자열을 찾아 값으로 바꿔치기
 * 하는 방식이라, `process.env[name]`처럼 이름을 변수로 넘기면 바꿔칠 자리를
 * 못 찾습니다. 그러면 **Vercel에 값을 제대로 넣어도 브라우저에서는 undefined**입니다.
 * 빌드도 타입 검사도 통과하고, 로그인 화면에서야 드러납니다.
 *
 * 한 번 당했으므로 다시 못 들어오게 막습니다.
 */
const raw = readFileSync(join(__dirname, "..", "client.ts"), "utf8");
/** 주석은 뺍니다 — 함정을 설명하는 글이 함정으로 잡히면 안 됩니다. */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("환경 변수를 브라우저까지 들고 가기", () => {
  it("이름을 변수로 넘겨 읽지 않는다", () => {
    expect(src).not.toMatch(/process\.env\s*\[/);
  });

  it("공개 변수를 글자 그대로 참조한다", () => {
    expect(src).toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
    expect(src).toContain("process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("서비스 키는 공개 변수로 새어나가지 않는다", () => {
    expect(src).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
    expect(src).toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
  });
});
