import { describe, expect, it } from "vitest";
import { pushRecent } from "../recent";

describe("최근 쓴 반 기억하기", () => {
  it("가장 최근 것이 앞에 온다", () => {
    expect(pushRecent(["중3 A"], "중2 B")).toEqual(["중2 B", "중3 A"]);
  });

  it("이미 있던 것은 늘어나지 않고 앞으로 옮겨진다", () => {
    expect(pushRecent(["중2 B", "중3 A"], "중3 A")).toEqual(["중3 A", "중2 B"]);
  });

  it("앞뒤 공백과 대소문자만 다르면 같은 반으로 본다", () => {
    // '중3 A'와 '중3 a'가 따로 쌓이면 목록이 금세 쓸모없어집니다.
    expect(pushRecent(["중3 A"], "  중3 a  ")).toEqual(["중3 a"]);
  });

  it("빈 값은 안 넣는다 — 반을 안 적고 접수하는 것도 정상이다", () => {
    expect(pushRecent(["중3 A"], "")).toEqual(["중3 A"]);
    expect(pushRecent(["중3 A"], "   ")).toEqual(["중3 A"]);
  });

  it("정해둔 개수를 넘기지 않는다 — 단추가 화면을 덮으면 안 된다", () => {
    const many = ["a", "b", "c", "d", "e", "f"];
    expect(pushRecent(many, "g")).toEqual(["g", "a", "b", "c", "d", "e"]);
    expect(pushRecent(many, "g")).toHaveLength(6);
  });

  it("원래 목록을 고치지 않는다", () => {
    const list = ["중3 A"];
    pushRecent(list, "중2 B");
    expect(list).toEqual(["중3 A"]);
  });
});
