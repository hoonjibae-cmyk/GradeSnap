/**
 * 브라우저에서 사진을 줄여 보냅니다.
 *
 * 휴대폰 원본은 한 장에 1.5MB 안팎이고 그대로 올리면 요청이 무거워집니다.
 * 어차피 API에 보낼 때 2576px로 줄어드니 **보내기 전에 줄입니다.**
 *
 * 그리고 그 줄인 이미지가 나중에 보관할 것이기도 합니다 — "왜 이렇게 채점했나"를
 * 되짚을 때 봐야 할 것은 휴대폰 원본이 아니라 **모델이 실제로 본 이미지**입니다.
 * (docs/13 §13.7)
 */

/** 모델이 보는 최대 변 길이. 이보다 줄이면 연필 글씨가 안 읽힙니다. */
export const MAX_EDGE = 2576;

export interface PreparedImage {
  /** 데이터 URL 접두사 없는 base64 */
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  /** 화면 미리보기용 */
  objectUrl: string;
}

export async function prepareImage(file: File, maxEdge = MAX_EDGE): Promise<PreparedImage> {
  // 휴대폰 사진은 EXIF로 회전 정보를 들고 있습니다. 실제 샘플이 전부 그랬습니다.
  // 'from-image'로 열어야 세워진 상태로 캔버스에 들어갑니다.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("이미지를 변환할 수 없습니다.");

  return {
    base64: await blobToBase64(blob),
    mediaType: "image/jpeg",
    width,
    height,
    bytes: blob.size,
    objectUrl: URL.createObjectURL(blob),
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1)); // "data:image/jpeg;base64," 제거
    };
    r.readAsDataURL(blob);
  });
}
