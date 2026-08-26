-- 정답지.
--
-- 프로그램은 답안지의 **답란만** 봅니다. 단어 시험은 그것으로 충분합니다 —
-- 제시어를 보면 정답이 나옵니다. 그런데 순서배열·문장삽입은 정답이 **지문**에
-- 달려 있고, 지문은 답란 옆이 아니라 시험지 본문에 있습니다. 그래서 프로그램이
-- 알 수가 없었고, 알 수 없는 자리에서 지어냈습니다(docs/13 §13.40).
--
-- 답은 간단합니다. **정답을 사람이 시험마다 한 번 알려주면 됩니다.**
-- 30명이 같은 시험을 보므로 수고는 1/30입니다.
--
-- `exam_refs`와 다릅니다.
--
--   exam_refs    프로그램이 첫 답안지에서 **스스로 만든** 것. 편의(절감)입니다.
--   answer_keys  **사람이 등록한** 것. 근거입니다. 프로그램이 못 만듭니다.
--
-- 그래서 표를 나눕니다. 섞으면 "이 정답은 누가 정했나"를 못 답합니다.

create table if not exists public.answer_keys (
  -- 같은 시험인지 가리는 값. 제목을 정규화한 것입니다.
  -- **번호 목록을 안 넣습니다** — 정답지와 답안지의 문항 번호 읽힘이 한 글자만
  -- 달라도 안 붙으면, 사람이 애써 등록한 것이 조용히 무시됩니다.
  slug        text primary key,
  -- 사람이 읽을 제목. 화면과 목록에 그대로 씁니다.
  title       text not null,
  -- [{ no, expected }] — 문항 번호와 정답.
  items       jsonb not null,
  note        text not null default '',
  created_by  uuid references public.staff (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.answer_keys enable row level security;

-- 읽기는 직원 전부입니다. 채점이 이걸 씁니다.
create policy answer_keys_read on public.answer_keys
  for select to authenticated using (public.is_staff());

-- 🔴 **쓰기는 확정할 수 있는 사람만.**
-- 정답지가 틀리면 그 시험을 본 반 전체가 같은 오류로 채점됩니다. 확정과
-- 같은 무게라 같은 문(can_confirm)을 씁니다.
create policy answer_keys_write on public.answer_keys
  for all to authenticated using (public.can_confirm()) with check (public.can_confirm());
