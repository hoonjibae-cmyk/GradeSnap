/**
 * 구글 드라이브에서 **정답지 파일 목록과 내용**을 가져옵니다.
 *
 * 폴더 구조가 한 겹이 아닙니다. 원장님이 주신 주소는 **상위 폴더**이고,
 * 그 안에 선생님별 폴더가 있고, 그 안에 또 폴더가 있습니다:
 *
 *   (공유 폴더)
 *     ├ (2관) 정다빈T
 *     │   └ 0827_M9(A,B)_Day1-3_재시_답지.pdf
 *     ├ (3관)선재현T
 *     │   └ …
 *     └ …
 *
 * 그래서 **하위 폴더를 따라 들어갑니다.** 다만 무한정은 아닙니다 —
 * 깊이와 개수에 뚜껑을 씌웁니다. 폴더가 커졌을 때 화면이 30초씩 멈추는
 * 것보다 "최근 것부터 200개"가 낫습니다.
 */

import { accessToken, driveConfig, type DriveConfig } from "./auth";
import { isAnswerKeyName, PDF } from "./names";

const API = "https://www.googleapis.com/drive/v3/files";

/** 몇 겹까지 들어갈 것인가. 지금 구조는 2겹이라 넉넉합니다. */
const MAX_DEPTH = 4;
/** 훑을 폴더 수의 뚜껑. 선생님 수의 몇 배입니다. */
const MAX_FOLDERS = 200;
/** 화면에 내놓을 정답지 수. 최근 것부터입니다. */
export const MAX_FILES = 200;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** 어느 선생님 폴더에서 나왔는가. 화면에서 고를 때 이게 제일 중요합니다. */
  folder: string;
  modifiedTime: string;
  /** PDF가 아니면 글자를 못 뽑습니다. 목록에는 두되 그렇게 표시합니다. */
  readable: boolean;
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function api(cfg: DriveConfig, path: string): Promise<Response> {
  const token = await accessToken(cfg);
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    throw new Error(
      `구글 폴더를 읽을 권한이 없습니다 (${res.status}). 폴더를 서비스 계정 주소(${cfg.email})에 ` +
        `**보기 권한으로 공유**했는지 확인하십시오. ${body.slice(0, 160)}`,
    );
  }
  if (!res.ok) throw new Error(`구글 드라이브 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** 폴더 하나의 바로 아래 것들. 페이지가 나뉘어 오면 이어 받습니다. */
async function childrenOf(cfg: DriveConfig, folderId: string): Promise<RawFile[]> {
  const out: RawFile[] = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: "1000",
      // 공유 드라이브에 있을 수도 있습니다. 없으면 무시되는 값입니다.
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await api(cfg, `${API}?${q}`);
    const j = (await res.json()) as { files?: RawFile[]; nextPageToken?: string };
    out.push(...(j.files ?? []));
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/**
 * 폴더를 따라 들어가며 **정답지로 보이는 파일**을 모읍니다.
 *
 * 최근에 고친 것부터 돌려줍니다 — 오늘 재시험 정답지를 찾는 사람이
 * 지난달 것을 헤집지 않게.
 */
export async function listAnswerKeyFiles(cfg?: DriveConfig | null): Promise<DriveFile[]> {
  const c = cfg ?? driveConfig();
  if (!c) throw new Error("구글 폴더가 아직 연결돼 있지 않습니다. (docs/17 참고)");

  const found: DriveFile[] = [];
  let visited = 0;
  // 너비 우선 — 얕은 곳(선생님 폴더 바로 아래)이 먼저 채워집니다.
  let level: { id: string; name: string }[] = [{ id: c.folderId, name: "" }];

  for (let depth = 0; depth < MAX_DEPTH && level.length && visited < MAX_FOLDERS; depth++) {
    const next: { id: string; name: string }[] = [];
    for (const folder of level) {
      if (visited++ >= MAX_FOLDERS) break;
      const kids = await childrenOf(c, folder.id);
      for (const f of kids) {
        if (f.mimeType === FOLDER_MIME) {
          // 하위 폴더 이름이 곧 선생님 이름입니다 — 그걸 물려줍니다.
          next.push({ id: f.id, name: folder.name || f.name });
          continue;
        }
        if (!isAnswerKeyName(f.name)) continue;
        found.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          folder: folder.name,
          modifiedTime: f.modifiedTime,
          readable: f.mimeType === PDF,
        });
      }
    }
    level = next;
  }

  found.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return found.slice(0, MAX_FILES);
}

/** 파일 하나를 통째로 내려받습니다. */
export async function downloadFile(id: string, cfg?: DriveConfig | null): Promise<Uint8Array> {
  const c = cfg ?? driveConfig();
  if (!c) throw new Error("구글 폴더가 아직 연결돼 있지 않습니다. (docs/17 참고)");
  const res = await api(c, `${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  return new Uint8Array(await res.arrayBuffer());
}
