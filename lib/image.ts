/**
 * 브라우저에서 사진을 세우고 줄여 보냅니다.
 *
 * 휴대폰 원본은 한 장에 1.5MB 안팎이고 그대로 올리면 요청이 무거워집니다.
 * 어차피 API에 보낼 때 2576px로 줄어드니 **보내기 전에 줄입니다.**
 *
 * 그리고 그 줄인 이미지가 나중에 보관할 것이기도 합니다 — "왜 이렇게 채점했나"를
 * 되짚을 때 봐야 할 것은 휴대폰 원본이 아니라 **모델이 실제로 본 이미지**입니다.
 * (docs/13 §13.7)
 *
 * **회전이 실제로 문제가 됩니다.** 현장 테스트에서 답안지를 90도 눕혀 찍은 사진이
 * 올라왔고, 모델이 읽어내긴 했지만 48칸 중 46칸만 잡았습니다. 세워서 보내면
 * 그 손실이 줄어듭니다. (docs/13 §13.8)
 */

/** 모델이 보는 최대 변 길이. 이보다 줄이면 연필 글씨가 안 읽힙니다. */
export const MAX_EDGE = 2576;

/** 시계 방향 회전 각도. 0이면 그대로. */
export type Rotation = 0 | 90 | 180 | 270;

export interface PreparedImage {
  /** 다시 돌릴 때 원본에서 새로 만들기 위해 들고 있습니다. */
  file: File;
  rotation: Rotation;
  /** 데이터 URL 접두사 없는 base64 */
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  /** 화면 미리보기용 */
  objectUrl: string;
  /**
   * 가로로 누운 사진. 답안지는 대개 세로라 **눕혀 찍었을 가능성**이 높습니다.
   * 자동으로 돌리지는 않습니다 — 진짜 가로 시험지도 있을 수 있어 사람이 봅니다.
   */
  looksSideways: boolean;
}

export async function prepareImage(file: File, rotation: Rotation = 0, maxEdge = MAX_EDGE): Promise<PreparedImage> {
  // 휴대폰 사진은 EXIF로 회전 정보를 들고 있습니다. 실제 샘플이 전부 그랬습니다.
  // 'from-image'로 열어야 세워진 상태로 캔버스에 들어갑니다.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const swap = rotation === 90 || rotation === 270;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("이미지를 변환할 수 없습니다.");

  return {
    file,
    rotation,
    base64: await blobToBase64(blob),
    mediaType: "image/jpeg",
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size,
    objectUrl: URL.createObjectURL(blob),
    looksSideways: canvas.width > canvas.height,
  };
}

/** 같은 원본을 90도씩 돌려 다시 만듭니다. */
export function rotateBy(img: PreparedImage, delta: 90 | -90): Promise<PreparedImage> {
  const next = (((img.rotation + delta) % 360) + 360) % 360;
  URL.revokeObjectURL(img.objectUrl);
  return prepareImage(img.file, next as Rotation);
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
