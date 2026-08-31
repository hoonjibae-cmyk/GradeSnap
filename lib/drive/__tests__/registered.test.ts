import { describe, expect, it } from "vitest";
import { splitRegistered } from "../registered";

const file = (id: string, modifiedTime: string) => ({ id, name: `${id}.pdf`, modifiedTime });

const key = (o: Partial<Parameters<typeof splitRegistered>[1][number]> & { title: string }) => ({
  source_file_id: null,
  source_modified: null,
  updated_at: "2026-08-31T00:00:00Z",
  ...o,
});

describe("이미 등록한 정답지 가리기", () => {
  it("등록 안 한 것은 할 일로 남습니다", () => {
    const r = splitRegistered([file("a", "2026-08-30T10:00:00Z")], []);
    expect(r.todo.map((f) => f.id)).toEqual(["a"]);
    expect(r.done).toEqual([]);
  });

  it("등록한 것은 목록에서 빠집니다 — 이게 요청받은 것입니다", () => {
    const r = splitRegistered(
      [file("a", "2026-08-30T10:00:00Z")],
      [key({ title: "3과 단어", source_file_id: "a", source_modified: "2026-08-30T10:00:00Z" })],
    );
    expect(r.todo).toEqual([]);
    expect(r.done.map((f) => f.id)).toEqual(["a"]);
    expect(r.done[0].was.title).toBe("3과 단어");
  });

  it("🔴 등록 뒤에 선생님이 파일을 고쳤으면 **다시 꺼내 놓습니다**", () => {
    const r = splitRegistered(
      [file("a", "2026-08-31T09:00:00Z")],
      [key({ title: "3과 단어", source_file_id: "a", source_modified: "2026-08-30T10:00:00Z" })],
    );
    expect(r.done).toEqual([]);
    expect(r.changed.map((f) => f.id)).toEqual(["a"]);
    expect(r.changed[0].was.changed).toBe(true);
  });

  it("🔴 맞추는 기준은 파일 ID입니다 — 제목을 고쳐도 연결이 안 끊깁니다", () => {
    const r = splitRegistered(
      [file("a", "2026-08-30T10:00:00Z")],
      [key({ title: "사람이 손으로 고친 제목", source_file_id: "a", source_modified: "2026-08-30T10:00:00Z" })],
    );
    expect(r.done).toHaveLength(1);
  });

  it("사진으로 올린 정답지는 아무 파일도 안 가립니다", () => {
    const r = splitRegistered([file("a", "2026-08-30T10:00:00Z")], [key({ title: "찍어 올린 것" })]);
    expect(r.todo.map((f) => f.id)).toEqual(["a"]);
  });

  it("같은 파일을 여러 번 등록했으면 **가장 나중 것**이 뜻입니다", () => {
    const r = splitRegistered(
      [file("a", "2026-08-31T09:00:00Z")],
      [
        key({ title: "옛것", source_file_id: "a", source_modified: "2026-08-30T10:00:00Z", updated_at: "2026-08-30T10:05:00Z" }),
        key({ title: "새것", source_file_id: "a", source_modified: "2026-08-31T09:00:00Z", updated_at: "2026-08-31T09:05:00Z" }),
      ],
    );
    // 나중 것 기준으로는 고쳐진 것이 없습니다.
    expect(r.changed).toEqual([]);
    expect(r.done[0].was.title).toBe("새것");
  });

  it("수정 시각을 안 남긴 옛 정답지는 '고쳐졌다'고 말하지 않습니다", () => {
    const r = splitRegistered(
      [file("a", "2026-08-31T09:00:00Z")],
      [key({ title: "이 기능 이전에 등록", source_file_id: "a", source_modified: null })],
    );
    expect(r.changed).toEqual([]);
    expect(r.done).toHaveLength(1);
  });

  it("정답지가 한 달 뒤 지워지면 파일이 저절로 돌아옵니다", () => {
    // 지워진다는 것은 곧 keys에서 사라진다는 뜻입니다.
    expect(splitRegistered([file("a", "2026-08-30T10:00:00Z")], []).todo).toHaveLength(1);
  });
});
