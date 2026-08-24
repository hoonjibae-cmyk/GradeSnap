import { describe, expect, it } from "vitest";
import { checkNewPassword, MIN_PASSWORD } from "@/lib/password";

describe("새 비밀번호 검사", () => {
  const ok = "gradesnap2026!";

  it("통과하면 null입니다", () => {
    expect(checkNewPassword("oldpassword", ok, ok)).toBeNull();
  });

  it("지금 비밀번호를 안 넣으면 막습니다 — 확인 없이 바꾸면 자리 비운 사이 바뀝니다", () => {
    expect(checkNewPassword("", ok, ok)).toContain("지금 쓰는");
  });

  it(`${MIN_PASSWORD}자 미만은 막습니다`, () => {
    const short = "a".repeat(MIN_PASSWORD - 1);
    expect(checkNewPassword("oldpassword", short, short)).toContain(`${MIN_PASSWORD}자`);
  });

  it("두 번 입력이 다르면 막습니다 — 오타로 바꾸면 본인도 못 들어옵니다", () => {
    expect(checkNewPassword("oldpassword", ok, ok + "x")).toContain("서로 다릅니다");
  });

  it("지금 쓰는 것과 같으면 막습니다", () => {
    expect(checkNewPassword(ok, ok, ok)).toContain("같습니다");
  });

  it("길이를 먼저 봅니다 — 짧은데 서로 달라도 길이부터 말합니다", () => {
    expect(checkNewPassword("oldpassword", "abc", "abd")).toContain(`${MIN_PASSWORD}자`);
  });
});
