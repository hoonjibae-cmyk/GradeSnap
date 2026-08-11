import { describe, expect, it } from "vitest";
import { looksLikeTimeout, parseJson } from "@/lib/http";

/*
  2026-08-11. Sonnet 5 실험에서 297초짜리 요청이 이 문장으로 실패했습니다.

    Unexpected token 'A', "An error o"... is not valid JSON

  **실험은 끝나 있었습니다.** 결과도 저장돼 있었습니다. 앞단이 먼저 끊고
  JSON이 아닌 오류 문서를 돌려줬을 뿐인데, 화면은 파싱 오류를 그대로 보여줬고
  그건 무엇을 해야 하는지도 안 적혔고 사실도 아니었습니다.
*/
describe("서버 응답 읽기", () => {
  it("JSON이면 그대로 읽습니다", () => {
    expect(parseJson(200, '{"ok":true}')).toEqual({ ok: true });
  });

  it("실패 응답이어도 JSON이면 그 안의 문장을 살립니다", () => {
    expect(parseJson(400, '{"error":"모르는 모델입니다"}')).toEqual({ error: "모르는 모델입니다" });
  });

  it("시간 초과는 '다시 누르라'가 아니라 '새로 고쳐 확인하라'고 말합니다", () => {
    expect(() => parseJson(504, "An error occurred with this application")).toThrowError(/새로 고쳐 확인/);
    // 돈이 두 번 나가는 것을 막는 문장이 반드시 들어 있어야 합니다.
    expect(() => parseJson(504, "An error occurred")).toThrowError(/두 번/);
  });

  it("JSON이 아니면 무엇이 왔는지 보여줍니다 — 파서 오류를 그대로 던지지 않습니다", () => {
    expect(() => parseJson(500, "<html>Internal Server Error</html>")).toThrowError(/Internal Server Error/);
    expect(() => parseJson(500, "<html>x</html>")).not.toThrowError(/Unexpected token/);
  });

  it("빈 응답도 사람 말로 말합니다", () => {
    expect(() => parseJson(200, "")).toThrowError(/빈 응답/);
  });

  it("시간 초과는 상태 코드로도 본문으로도 알아봅니다", () => {
    expect(looksLikeTimeout(504, "")).toBe(true);
    expect(looksLikeTimeout(500, "FUNCTION_INVOCATION_TIMEOUT")).toBe(true);
    expect(looksLikeTimeout(500, "그냥 오류")).toBe(false);
  });
});
