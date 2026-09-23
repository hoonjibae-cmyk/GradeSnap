import { describe, expect, it, vi } from "vitest";
import { listRetestFiles, retestCutoff } from "../client";

vi.mock("../auth", () => ({ accessToken: async () => "test-token", driveConfig: () => null }));

describe("RePass file window", () => {
  it("clamps two calendar months at the end of a shorter month", () => {
    expect(retestCutoff(new Date("2026-05-31T12:30:00Z"))).toBe("2026-03-31T12:30:00.000Z");
    expect(retestCutoff(new Date("2026-04-30T12:30:00Z"))).toBe("2026-02-28T12:30:00.000Z");
  });

  it("traverses old folders but returns only recent PDF and word document metadata", async () => {
    const now = new Date();
    const recent = now.toISOString();
    const old = new Date(now.getTime() - 100 * 86400000).toISOString();
    const queries: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url) => {
      const q = new URL(String(url)).searchParams.get("q") ?? "";
      queries.push(q);
      const files = q.includes("'root' in parents")
        ? [{ id: "archive", name: "지난 폴더", mimeType: "application/vnd.google-apps.folder", modifiedTime: old }]
        : [{ id: "recent", name: "이번 시험.pdf", mimeType: "application/pdf", modifiedTime: recent },
           { id: "hwp", name: "이번 시험.HWPX", mimeType: "application/octet-stream", modifiedTime: recent },
           { id: "docx", name: "이번 답지.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", modifiedTime: recent },
           { id: "google-doc", name: "이번 시험 안내", mimeType: "application/vnd.google-apps.document", modifiedTime: recent },
           { id: "image", name: "이번 시험.png", mimeType: "image/png", modifiedTime: recent },
           { id: "old", name: "지난 시험.pdf", mimeType: "application/pdf", modifiedTime: old }];
      return new Response(JSON.stringify({ files }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await listRetestFiles({ email: "test@example.com", key: "", folderId: "root" });
      expect(result.files.map((file) => file.id)).toEqual(["recent", "hwp", "docx", "google-doc"]);
      expect(result.files.find((file) => file.id === "hwp")?.readable).toBe(false);
      expect(result.visitedFolders).toBe(2);
      expect(queries).toHaveLength(2);
      expect(queries.every((q) => q.includes("mimeType = 'application/vnd.google-apps.folder' or modifiedTime >"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

