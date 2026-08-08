-- 접근 제어
--
-- 학원 한 곳이고 직원이 몇 명입니다. 그래서 **직원끼리는 다 봅니다** —
-- 반별로 칸막이를 치면 "옆 반 답안지를 대신 올려줬다" 같은 일상적인 일이
-- 막힙니다. 경계는 "직원인가 아닌가"이고, 그건 `staff` 표에 있느냐입니다.
--
-- 단 하나 역할로 갈리는 것이 **확정**입니다. 학생을 재시험에 남기는 결정은
-- 선생님이 합니다. 그건 RLS로 표현하기 어려워 트리거로 막습니다.

alter table public.staff       enable row level security;
alter table public.exams       enable row level security;
alter table public.sheets      enable row level security;
alter table public.sheet_pages enable row level security;
alter table public.items       enable row level security;

-- 직원 명부 -----------------------------------------------------------------
-- 읽기는 직원 모두 (화면에 "확정: 김선생" 을 찍어야 하므로).
-- 명부를 고치는 것은 admin뿐입니다. **첫 admin은 서비스 키로 직접 넣습니다** —
-- 자기 자신을 admin으로 올릴 수 있는 경로를 두지 않기 위해서입니다.
create policy staff_read on public.staff
  for select to authenticated using (public.is_staff());

create policy staff_write on public.staff
  for all to authenticated
  using (exists (select 1 from public.staff where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.staff where id = auth.uid() and role = 'admin'));

-- 시험·답안지·사진·문항 -----------------------------------------------------
create policy exams_rw on public.exams
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy sheets_rw on public.sheets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy sheet_pages_rw on public.sheet_pages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy items_rw on public.items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 확정은 선생님만 -----------------------------------------------------------
create or replace function public.guard_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.final_verdict is distinct from old.final_verdict)
     or (new.status = 'confirmed' and old.status is distinct from 'confirmed') then
    if not public.can_confirm() then
      raise exception '확정은 선생님만 할 수 있습니다.' using errcode = '42501';
    end if;
    new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  return new;
end;
$$;

create trigger sheets_guard_confirm before update on public.sheets
  for each row execute function public.guard_confirm();

-- 사진 보관소 ---------------------------------------------------------------
-- 비공개 버킷입니다. 학생 손글씨와 이름이 찍힌 사진이라 서명 URL로만 봅니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sheets', 'sheets', false, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy sheets_bucket_read on storage.objects
  for select to authenticated using (bucket_id = 'sheets' and public.is_staff());

create policy sheets_bucket_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'sheets' and public.is_staff());

-- 지우는 것은 보관 기간이 끝났을 때뿐이고, 그건 서비스 키로 도는 정리 작업이
-- 합니다. 사람 손으로 지우는 경로는 두지 않습니다 — 채점 근거가 사라집니다.
create policy sheets_bucket_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'sheets'
         and exists (select 1 from public.staff where id = auth.uid() and role = 'admin'));
