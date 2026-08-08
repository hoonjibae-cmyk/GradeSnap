-- 직원 관리와 사용 기록.
--
-- 두 가지를 답할 수 있어야 합니다.
--   1. 누가 이 앱을 쓸 수 있는가 (지금은 SQL로만 넣을 수 있습니다)
--   2. 누가 언제 얼마나 썼는가 (지금은 아무 데도 안 남습니다)
--
-- 두 번째가 필요한 이유는 **근무 시간 외 사적 사용을 막기 위해서**입니다.
-- 답안지 사진 한 장에 $0.14가 나가고, 그 돈은 학원이 냅니다.

-- ---------------------------------------------------------------------------
-- 직원을 지우지 않고 끕니다
-- ---------------------------------------------------------------------------

-- 퇴사한 조교의 행을 지우면 **그 사람이 채점한 기록이 주인을 잃습니다.**
-- `received_by`가 null이 되면 "누가 받았나"를 영영 못 답합니다.
-- 그래서 지우지 않고 끕니다.
alter table public.staff add column if not exists active boolean not null default true;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active and role = 'admin');
$$;

create or replace function public.can_confirm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active and role in ('teacher', 'admin'));
$$;

-- ---------------------------------------------------------------------------
-- 근무 시간 — 무엇이 '근무 시간 외'인지는 학원이 정합니다
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  -- 행이 하나뿐인 표. `check (id)`가 두 번째 행을 막습니다.
  id         boolean primary key default true check (id),
  work_start int   not null default 13 check (work_start between 0 and 23),
  work_end   int   not null default 23 check (work_end between 1 and 24),
  /** 0=일 … 6=토. 기본은 월~토 — 학원은 토요일에도 돕니다. */
  work_days  int[] not null default '{1,2,3,4,5,6}',
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (true) on conflict (id) do nothing;

alter table public.settings enable row level security;

create policy settings_read on public.settings
  for select to authenticated using (public.is_staff());
create policy settings_write on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 사용 기록 — 돈이 나간 모든 호출
-- ---------------------------------------------------------------------------

-- `sheets`와 겹치는 것 같지만 다른 사실입니다.
--   sheets        무엇을 채점했는가 (일의 결과)
--   usage_events  누가 언제 돈을 썼는가 (지출의 기록)
--
-- 재시도로 한 답안지를 두 번 채점하면 sheets는 한 행, 여기는 두 행입니다.
-- 모델 비교 실험은 sheets를 안 건드리지만 여기에는 남습니다.
-- **그리고 '빠른 시험'은 답안지 행이 아예 없습니다** — 여기가 유일한 기록입니다.
create table public.usage_events (
  id       uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff (id) on delete set null,
  kind     text not null check (kind in ('grade', 'quick', 'trial')),
  -- 빠른 시험은 답안지가 없어 null입니다.
  sheet_id uuid references public.sheets (id) on delete set null,
  pages    int not null default 0,
  cost_usd numeric(10, 4),
  latency_ms int,
  model    text,
  effort   text,
  ok       boolean not null default true,
  created_at timestamptz not null default now()
);

create index usage_events_staff_idx on public.usage_events (staff_id, created_at desc);
create index usage_events_time_idx on public.usage_events (created_at desc);

alter table public.usage_events enable row level security;

-- **자기 것만 남길 수 있습니다.** 남의 이름으로 기록을 만들 수 없습니다.
create policy usage_insert on public.usage_events
  for insert to authenticated
  with check (public.is_staff() and staff_id = auth.uid());

-- 보는 것은 관리자, 그리고 자기 것. 조교가 서로를 들여다볼 이유는 없습니다.
create policy usage_read on public.usage_events
  for select to authenticated
  using (public.is_admin() or staff_id = auth.uid());

-- 고치거나 지우는 정책은 두지 않습니다. **지출 기록은 고쳐지면 안 됩니다.**
