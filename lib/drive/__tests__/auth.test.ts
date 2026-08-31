import { describe, expect, it } from "vitest";
import { unquote } from "../auth";

/*
  설정은 **한 번만** 하는 일입니다. 그래서 그 한 번에서 막히면 안 됩니다.

  JSON 파일에서 값을 복사할 때 따옴표가 딸려 오는 것, Vercel 칸에 줄바꿈이
  `\n` 두 글자로 들어가는 것 — 둘 다 흔하고, 둘 다 화면에는 "서명 실패"처럼
  **자기가 뭘 잘못했는지 알 수 없는 말**로 나타납니다.
*/
describe("환경 변수 다듬기", () => {
  it("감싼 큰따옴표를 뗍니다 — JSON에서 복사하면 딸려 옵니다", () => {
    expect(unquote('"gradesnap@x.iam.gserviceaccount.com"')).toBe("gradesnap@x.iam.gserviceaccount.com");
  });

  it("작은따옴표도 뗍니다", () => {
    expect(unquote("'abc'")).toBe("abc");
  });

  it("가운데 따옴표는 안 건드립니다", () => {
    expect(unquote('a"b')).toBe('a"b');
  });

  it("한쪽만 따옴표면 안 건드립니다 — 값의 일부일 수 있습니다", () => {
    expect(unquote('"abc')).toBe('"abc');
  });

  it("앞뒤 공백을 뗍니다", () => {
    expect(unquote("  abc  ")).toBe("abc");
  });

  it("없으면 빈 문자열 — 이 기능만 조용히 꺼집니다", () => {
    expect(unquote(undefined)).toBe("");
  });
});
