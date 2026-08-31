/**
 * **이미 등록한 정답지는 목록에서 빼 줍니다.**
 *
 * > 원장: "한 번 등록한 파일은 다른 사람 또는 같은 사람이 나중에 이 메뉴에
 * > 들어왔을 때 업로드할 정답지 목록에서 사라지게 만든건 맞니?"
 *
 * 안 그러면 조교는 매번 **뭘 이미 했고 뭘 안 했는지 모른 채** 목록을
 * 훑습니다. 같은 정답지를 두 번 읽어 돈을 두 번 쓰거나, 반대로 아직 안 된
 * 것을 했다고 착각하고 넘어갑니다. 조교가 여럿이면 더합니다.
 *
 * ---
 *
 * ## 🔴 그냥 숨기기만 하면 더 나쁩니다
 *
 * 선생님이 정답지를 **고쳐서 다시 올리는 일**이 있습니다. 오타를 고쳤거나
 * 문항을 바꿨거나. 「한 번 등록했으니 영영 숨긴다」로 만들면 **그 고친
 * 정답지가 화면에 다시는 안 나타납니다.** 조교는 이미 했다고 알고 있고,
 * 반 전체가 옛 정답으로 채점됩니다. 원래 문제보다 나쁩니다.
 *
 * 그래서 **파일의 수정 시각**을 같이 기억해 뒀다가, 그보다 나중에 고쳐진
 * 파일은 **다시 꺼내 놓습니다.** 「고쳐졌습니다」를 달아서.
 *
 * ## 세 칸으로 가릅니다
 *
 *   `todo`    아직 등록 안 한 것. **조교가 볼 목록입니다.**
 *   `changed` 등록은 했는데 그 뒤에 파일이 고쳐진 것. todo와 같이 놓되 표시합니다.
 *   `done`    등록했고 그대로인 것. 접어 둡니다 — 지우지는 않습니다.
 *
 * `done`을 아예 없애지 않는 이유는, 잘못 읽힌 정답지를 **다시 읽고 싶을
 * 때** 그 파일에 닿을 길이 없어지기 때문입니다.
 *
 * 정답지는 한 달이면 지워집니다(`KEY_DAYS`). 그때는 등록 기록도 같이
 * 사라지므로 파일이 저절로 `todo`로 돌아옵니다 — 따로 할 일이 없습니다.
 */

export interface FileLike {
  id: string;
  /** RFC3339. 구글이 주는 그대로입니다. */
  modifiedTime: string;
}

export interface KeyLike {
  title: string;
  source_file_id?: string | null;
  /** 그 파일을 읽은 시점의 **파일 수정 시각**. */
  source_modified?: string | null;
  updated_at: string;
}

/** 파일 하나에 붙는 등록 기록. 없으면 아직 안 한 것입니다. */
export interface Registered {
  title: string;
  /** 파일이 그 뒤에 고쳐졌는가. */
  changed: boolean;
  /** 언제 등록했는가. 화면에 날짜로 씁니다. */
  at: string;
}

export interface Split<T> {
  todo: T[];
  changed: (T & { was: Registered })[];
  done: (T & { was: Registered })[];
}

/** 시각 비교. 못 읽는 값은 0으로 봅니다 — 없으면 '옛날'입니다. */
const at = (s: string | null | undefined): number => {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? t : 0;
};

/**
 * 파일 목록을 등록 여부로 가릅니다.
 *
 * 🔴 **맞추는 기준은 파일 ID입니다.** 제목이 아닙니다 — 제목은 사람이
 * 화면에서 고칠 수 있고(그러라고 만든 칸입니다), 고치는 순간 연결이
 * 끊깁니다. 파일은 이름을 바꿔도 ID가 그대로입니다.
 */
export function splitRegistered<T extends FileLike>(files: T[], keys: KeyLike[]): Split<T> {
  const byFile = new Map<string, KeyLike>();
  for (const k of keys) {
    const id = (k.source_file_id ?? "").trim();
    if (!id) continue; // 사진으로 올린 정답지 — 아무 파일도 안 가립니다.
    /*
      같은 파일로 여러 번 등록했으면 **가장 나중 것**이 뜻입니다. 앞의
      것을 남기면 "고쳐졌습니다"가 영영 안 꺼집니다.
    */
    const prev = byFile.get(id);
    if (!prev || at(k.updated_at) > at(prev.updated_at)) byFile.set(id, k);
  }

  const out: Split<T> = { todo: [], changed: [], done: [] };
  for (const f of files) {
    const k = byFile.get(f.id);
    if (!k) {
      out.todo.push(f);
      continue;
    }
    /*
      읽은 시점의 수정 시각을 안 남긴 정답지(이 기능 이전에 등록된 것)는
      **고쳐졌다고 보지 않습니다.** 모르는 것을 "고쳐졌다"고 말하면 목록이
      가짜 경고로 채워지고, 그러면 진짜 경고도 안 읽힙니다.
    */
    const was: Registered = {
      title: k.title,
      changed: at(k.source_modified) > 0 && at(f.modifiedTime) > at(k.source_modified),
      at: k.updated_at,
    };
    (was.changed ? out.changed : out.done).push({ ...f, was });
  }
  return out;
}
