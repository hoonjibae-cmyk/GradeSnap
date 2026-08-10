import sharp from "sharp";

/**
 * 사진을 실제로 줄입니다. **서버 전용** — `sharp`가 네이티브 모듈이라
 * 브라우저에서는 못 씁니다.
 *
 * 크기·비율 계산과 실험에 쓸 값 목록은 `resize.ts`에 있습니다. 화면도
 * 그걸 가져가야 하는데, 여기와 한 파일에 두면 브라우저 묶음이 깨집니다.
 */

/**
 * base64 JPEG를 긴 변 `maxEdge`로 줄입니다. 이미 작으면 **그대로 돌려줍니다.**
 *
 * 품질 88은 글자 가장자리를 뭉개지 않으면서 파일을 줄이는 자리입니다.
 * 다만 여기서 재려는 것은 **해상도**이므로 품질은 고정해 둡니다 —
 * 한 번에 두 가지를 바꾸면 원인을 못 짚습니다(docs/13 §13.21에서 데었습니다).
 */
export async function downscale(base64: string, maxEdge: number): Promise<string> {
  const input = Buffer.from(base64, "base64");
  const meta = await sharp(input).metadata();
  const long = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (!long || long <= maxEdge) return base64;

  const out = await sharp(input)
    .resize({ width: meta.width! >= meta.height! ? maxEdge : undefined, height: meta.height! > meta.width! ? maxEdge : undefined, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return out.toString("base64");
}
