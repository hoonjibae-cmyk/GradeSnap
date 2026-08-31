-- 정답지가 **어느 파일에서 왔는지** 기억합니다.
--
-- 구글 폴더에서 가져오기를 붙이고 나니 곧바로 드러난 구멍입니다.
--
-- > 원장: "한 번 등록한 파일은 다른 사람 또는 같은 사람이 나중에 이 메뉴에
-- > 들어왔을 때 업로드할 정답지 목록에서 사라지게 만든건 맞니?"
--
-- 아니었습니다. 폴더의 「답지」 파일을 전부 보여주기만 했습니다. 그러면
-- 조교는 매번 **뭘 이미 했고 뭘 안 했는지 모른 채** 목록을 훑게 됩니다.
-- 같은 정답지를 두 번 읽어 돈을 두 번 쓰거나, 반대로 아직 안 된 것을
-- 했다고 착각하고 넘어갑니다.
--
-- 제목으로 맞출 수도 있지만 그러면 안 됩니다 — 제목은 사람이 화면에서
-- 고칠 수 있고, 고치는 순간 연결이 끊깁니다. **파일 자체를 가리켜야** 합니다.

alter table public.answer_keys
  add column if not exists source_file_id  text,
  add column if not exists source_name     text,
  -- 그 파일을 읽은 시점의 **파일 수정 시각**입니다.
  --
  -- 이게 핵심입니다. 선생님이 정답지를 고쳐 다시 올리면 수정 시각이
  -- 올라가고, 그러면 화면이 그 파일을 **다시 꺼내 보여줍니다.**
  -- 「등록했으니 숨긴다」만 하면 **고쳐진 정답지가 영영 안 보입니다** —
  -- 원래 문제보다 나쁩니다.
  add column if not exists source_modified timestamptz;

-- 사진으로 올린 정답지는 이 세 칸이 비어 있습니다. 그래서 아무 파일도
-- 가리지 않습니다 — 맞는 동작입니다.
create index if not exists answer_keys_source_file_id_idx
  on public.answer_keys (source_file_id)
  where source_file_id is not null;
