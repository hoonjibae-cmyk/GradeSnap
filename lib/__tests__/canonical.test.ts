import { describe, expect, it } from "vitest";
import { canonicalHost } from "../canonical";

const base = {
  host: "grade-snap-alpha.vercel.app",
  canonical: "gradesnap.yussam.com",
  method: "GET",
  isProduction: true,
};

describe("주소를 하나로 모으기", () => {
  it("옛 주소로 들어오면 새 주소로 넘긴다", () => {
    expect(canonicalHost(base)).toBe("gradesnap.yussam.com");
  });

  it("이미 새 주소면 그대로 둔다 — 안 그러면 무한히 넘어간다", () => {
    expect(canonicalHost({ ...base, host: "gradesnap.yussam.com" })).toBeNull();
  });

  it("포트가 붙어 있어도 같은 주소로 본다", () => {
    expect(canonicalHost({ ...base, host: "gradesnap.yussam.com:443" })).toBeNull();
  });

  it("대소문자가 달라도 같은 주소로 본다", () => {
    expect(canonicalHost({ ...base, host: "GradeSnap.Yussam.COM" })).toBeNull();
  });

  it("설정이 없으면 아무것도 안 한다 — DNS 붙기 전에 켜지면 앱이 사라진다", () => {
    expect(canonicalHost({ ...base, canonical: undefined })).toBeNull();
    expect(canonicalHost({ ...base, canonical: "  " })).toBeNull();
  });

  it("미리보기 배포는 안 넘긴다 — 넘기면 미리보기가 쓸모없어진다", () => {
    expect(canonicalHost({ ...base, isProduction: false })).toBeNull();
  });

  it("POST는 안 넘긴다 — 본문이 한 번 더 날아가면 채점이 두 번 나간다", () => {
    expect(canonicalHost({ ...base, method: "POST" })).toBeNull();
    expect(canonicalHost({ ...base, method: "HEAD" })).toBe("gradesnap.yussam.com");
  });

  it("호스트를 못 읽으면 넘기지 않는다", () => {
    expect(canonicalHost({ ...base, host: null })).toBeNull();
  });
});
