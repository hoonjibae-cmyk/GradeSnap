/**
 * PDF에서 **글자를 그대로 꺼냅니다.** AI도 돈도 안 씁니다.
 *
 * 선생님들이 올리는 정답지는 한글·워드에서 뽑은 PDF라 글자층이 살아
 * 있습니다. 사진으로 찍어 AI에게 읽히는 것과 견주면
 *
 *   - **정확합니다.** 읽는 게 아니라 들어 있는 값을 꺼내는 것입니다.
 *   - **공짜입니다.**
 *   - **빠릅니다.**
 *
 * 다만 **스캔본은 못 읽습니다.** 종이를 복사기로 밀어 넣어 만든 PDF는
 * 속이 사진 한 장이라 꺼낼 글자가 없습니다. 그때는 조용히 빈 값을 주지
 * 말고 **그렇게 말해야 합니다** — 사람이 사진으로 올리면 되는 일입니다.
 */

/**
 * 글자가 이만큼은 나와야 "글자층이 있다"고 봅니다.
 *
 * 스캔본이라도 머리글에 도장처럼 몇 글자가 박혀 있는 경우가 있어,
 * 0보다는 여유를 둡니다.
 */
const MIN_CHARS = 40;

export interface PdfText {
  text: string;
  pages: number;
}

export async function pdfText(bytes: Uint8Array): Promise<PdfText> {
  // 무거운 모듈이라 **부를 때 불러옵니다.** 정답지를 안 읽는 요청까지
  // 이걸 짊어지면 채점이 그만큼 늦게 시작합니다.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(doc, { mergePages: true });
  return { text: String(text ?? "").trim(), pages: totalPages };
}

/** 꺼낸 글자가 쓸 만한가. 아니면 스캔본입니다. */
export function hasTextLayer(t: PdfText): boolean {
  return t.text.replace(/\s+/g, "").length >= MIN_CHARS;
}

export const SCANNED =
  "이 정답지는 **글자가 없는 스캔본**입니다 — 종이를 그대로 복사해 만든 PDF라 꺼낼 글자가 없습니다. " +
  "정답지를 사진으로 찍어 올려 주십시오.";
