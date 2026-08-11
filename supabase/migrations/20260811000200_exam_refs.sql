-- 시험 참조 — 같은 시험을 30번 새로 읽지 않습니다 (docs/13 §13.27).
--
-- 한 반이 같은 시험을 보는데 지금까지 학생마다 정답을 새로 만들어냈고,
-- 그래서 같은 답이 학생마다 다르게 판정될 수 있었습니다. 첫 학생의 깨끗한
-- 결과를 시험의 참조로 남겨 반 전체가 같은 정답으로 판정받게 합니다.
--
-- 학생 개인정보가 없습니다 — 인쇄된 제시어와 정답뿐입니다. 그래서 90일
-- 삭제 대상이 아니고, 같은 교재를 다음 학기에 다시 쓰면 그대로 씁니다.

create table if not exists public.exam_refs (
  -- norm(제목)|문항번호,... — 번호까지 넣어 같은 제목의 다른 시험이 안 섞입니다.
  fingerprint  text primary key,
  title        text not null,
  -- [{no, prompt, direction, expected}]
  items        jsonb not null,
  source_sheet uuid references public.sheets (id) on delete set null,
  created_by   uuid references public.staff (id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.exam_refs enable row level security;

create policy exam_refs_read on public.exam_refs
  for select to authenticated using (public.is_staff());
-- 채점 경로가 저장하므로 조교도 넣을 수 있어야 합니다. 덮어쓰기는 없습니다 —
-- 먼저 저장된 것이 이깁니다(insert 충돌 무시). 지우는 것은 관리자만.
create policy exam_refs_insert on public.exam_refs
  for insert to authenticated with check (public.is_staff());
create policy exam_refs_delete on public.exam_refs
  for delete to authenticated using (public.is_admin());

-- 🔴 기본 꺼짐. 실제 채점 동작이 바뀌는 것이라 관리자가 켭니다.
alter table public.settings
  add column if not exists use_exam_refs boolean not null default false;
