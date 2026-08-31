import { describe, expect, it } from "vitest";
import { hasTextLayer, pdfText } from "../pdf";

/**
 * 글자층이 있는 PDF를 손으로 하나 만듭니다.
 *
 * 실제 정답지를 넣을 수는 없습니다 — 학생 이름은 없지만 선생님 이름과 시험
 * 내용이 들어 있고, 이 저장소에는 시험 자료를 안 넣습니다(`.gitignore`).
 * 여기서 재려는 것은 정답지의 내용이 아니라 **글자가 나오느냐 안 나오느냐**
 * 이므로 최소한의 PDF면 충분합니다.
 */
function madePdf(body: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${body}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

describe("PDF에서 글자 꺼내기", () => {
  it("글자층이 있으면 그대로 나옵니다 — AI도 돈도 안 씁니다", async () => {
    const t = await pdfText(madePdf("M4 Word Master Unit 33-34 answer key 1 abandon 2 abolish"));
    expect(t.pages).toBe(1);
    expect(t.text).toContain("Unit 33-34");
    expect(hasTextLayer(t)).toBe(true);
  });

  it("🔴 글자가 거의 없으면 스캔본으로 봅니다 — 조용히 빈 정답지를 만들지 않습니다", async () => {
    expect(hasTextLayer(await pdfText(madePdf("x")))).toBe(false);
  });
});
