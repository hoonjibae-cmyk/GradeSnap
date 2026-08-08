-- GradeSnap 스키마
--
-- 설계 근거는 docs/13 §13.7(보관)과 §13.9(큐)입니다. 여기서 정하는 것 하나만
-- 미리 말해두면: **큐를 위한 별도 테이블을 두지 않습니다.**
-- 일감의 단위가 "한 학생의 답안지"이고 그게 곧 `sheets`의 한 행이므로,
-- 상태 칼럼을 그 행에 두고 `for update skip locked`로 집어갑니다.
-- 큐 테이블을 따로 두면 같은 사실이 두 곳에 적히고 언젠가 어긋납니다.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 직원
-- ---------------------------------------------------------------------------

-- 가입했다고 자동으로 직원이 되지는 않습니다. 이 표에 있어야 직원입니다.
-- 학원 한 곳이라 조직 개념은 두지 않습니다.
create table public.staff (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  -- 확정(선생님이 PASS/FAIL을 최종 결정)은 teacher 이상만 합니다.
  role       text not null default 'assistant' check (role in ('assistant', 'teacher', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid());
$$;

create or replace function public.can_confirm()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid() and role in ('teacher', 'admin'));
$$;

-- ---------------------------------------------------------------------------
-- 시험
-- ---------------------------------------------------------------------------

create table public.exams (
  id              uuid primary key default gen_random_uuid(),
  title           text not null default '',
  class_name      text not null default '',
  exam_date       date not null default current_date,
  -- 인쇄된 표기 그대로 넣습니다. 예: '-8 까지 pass', '( -10%까지 PASS )'
  -- 비워두면 시험지 머리말에서 읽습니다. 채워두면 그걸 씁니다 —
  -- 빨간펜이 머리말을 덮은 경우의 폴백입니다(docs/13 §13.8).
  -- **시험 하나에 한 번**입니다. 장마다 입력하는 항목이 아닙니다.
  cut_line        text,
  strict_spelling boolean not null default false,
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_by      uuid references public.staff (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 답안지 — 한 학생분. 큐의 한 칸이기도 합니다.
-- ---------------------------------------------------------------------------

create table public.sheets (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid not null references public.exams (id) on delete cascade,
  -- 머리말에서 읽습니다. 못 읽으면 조교가 채웁니다.
  student_name text not null default '',

  -- 큐 -----------------------------------------------------------------
  -- queued → running → graded → confirmed. 실패하면 failed.
  status       text not null default 'queued'
                 check (status in ('queued', 'running', 'graded', 'failed', 'confirmed')),
  attempts     int not null default 0,
  claimed_at   timestamptz,
  claimed_by   uuid references public.staff (id),
  error        text,

  -- 채점 결과 -----------------------------------------------------------
  transcript        jsonb,
  -- Warning[] — level이 drift / incomplete / info로 나뉩니다(lib/grading/types.ts).
  warnings          jsonb not null default '[]'::jsonb,
  printed_total     int,
  -- 인쇄된 문항 수보다 덜 읽힌 칸 수
  missing           int,
  -- 못 읽은 칸이 전부 오답이라 쳐도 결정이 안 바뀌면 true. false면 verdict가 null입니다.
  robust_to_missing boolean,
  cut               int,
  n_wrong           int,
  verdict           text check (verdict in ('pass', 'fail')),
  -- 커트라인에 걸려 문항 하나가 결과를 뒤집을 수 있는 상태. **여기는 사람이 봅니다.**
  near_boundary     boolean,
  margin            int,
  token_usage       jsonb,
  cost_usd          numeric(10, 4),
  graded_at         timestamptz,

  -- 확정 ---------------------------------------------------------------
  -- 선생님이 화면에서 확인하고 누른 값. 이게 실제로 나가는 결과입니다.
  final_verdict text check (final_verdict in ('pass', 'fail')),
  confirmed_by  uuid references public.staff (id),
  confirmed_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sheets_queue_idx on public.sheets (exam_id, status, created_at);
create index sheets_review_idx on public.sheets (exam_id, near_boundary) where status = 'graded';

-- ---------------------------------------------------------------------------
-- 사진 — 모델에 실제로 보낸 축소본만 저장합니다 (docs/13 §13.7)
-- ---------------------------------------------------------------------------

create table public.sheet_pages (
  id           uuid primary key default gen_random_uuid(),
  sheet_id     uuid not null references public.sheets (id) on delete cascade,
  -- 조교가 올린 순서. 문항 순서와 다를 수 있고, 맞출 필요도 없습니다 —
  -- 병합은 문항 번호로 합니다(lib/grading/merge.ts).
  idx          int not null,
  storage_path text not null,
  -- 조교가 돌려서 보낸 각도. 눕혀 찍은 사진이 실제로 올라옵니다(docs/13 §13.8).
  rotation     int not null default 0 check (rotation in (0, 90, 180, 270)),
  width        int,
  height       int,
  bytes        int,
  created_at   timestamptz not null default now(),
  -- 90일이 지나 이미지를 지운 시각. 행은 남깁니다 — 무엇이 있었는지는 기록입니다.
  purged_at    timestamptz,
  unique (sheet_id, idx)
);

create index sheet_pages_purge_idx on public.sheet_pages (created_at) where purged_at is null;

-- ---------------------------------------------------------------------------
-- 문항 — 전사 + 판정 + 검수를 한 행에
-- ---------------------------------------------------------------------------

-- 검수 기록을 jsonb에 묻지 않고 표로 두는 이유가 있습니다.
-- **선생님이 우리 판정을 뒤집은 기록이 곧 정확도 데이터**입니다(docs/12 §12.8).
-- 그걸 시험을 가로질러 세려면 칼럼이어야 합니다.
create table public.items (
  id       uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.sheets (id) on delete cascade,
  seq      int not null,
  -- 시험지에 인쇄된 번호 그대로. 문자열입니다 — '1)', 'A-3' 같은 것이 실재합니다.
  -- 번호가 아예 안 찍힌 시험지(문법 백지)에서는 모델이 붙인 순번입니다.
  no       text not null,

  -- 전사 ---------------------------------------------------------------
  prompt     text not null default '',
  direction  text check (direction in ('en2ko', 'ko2en', 'other')),
  prefix     text not null default '',
  -- 학생이 쓴 그대로. **철자가 틀렸으면 틀린 채로.**
  written    text not null default '',
  blank      boolean not null default false,
  legible    boolean not null default true,
  erased     boolean not null default false,
  confidence numeric(4, 3),

  -- 판정 ---------------------------------------------------------------
  correct  boolean,
  expected text not null default '',
  note     text not null default '',

  -- 검수 ---------------------------------------------------------------
  -- **선생님이 바꾼 것만 채웁니다.** null이면 시스템 판정 그대로 둔 것입니다.
  teacher_correct boolean,
  reviewed_by     uuid references public.staff (id),
  reviewed_at     timestamptz,

  -- 실제로 쓰이는 값. 화면·명단·집계가 전부 이걸 봅니다.
  final_correct boolean generated always as (coalesce(teacher_correct, correct)) stored,
  -- 우리가 틀렸던 건. 이 칼럼을 세는 것이 정확도 측정입니다.
  overturned    boolean generated always as
                  (teacher_correct is not null and teacher_correct is distinct from correct) stored,

  unique (sheet_id, seq)
);

create index items_sheet_idx on public.items (sheet_id, seq);
create index items_wrong_idx on public.items (sheet_id) where final_correct is false;
create index items_overturned_idx on public.items (sheet_id) where overturned;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger exams_touch before update on public.exams
  for each row execute function public.touch_updated_at();
create trigger sheets_touch before update on public.sheets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 큐 — 브라우저가 몰아붙이되, 탭을 닫아도 잃지 않게
-- ---------------------------------------------------------------------------

-- 한 반이 6분 넘게 걸립니다(docs/13 §13.8). 조교가 탭을 닫거나 와이파이가
-- 끊겨도 진행이 남아야 하고, 조교 둘이 같은 시험을 열어도 같은 답안지를
-- 두 번 채점하면 안 됩니다. `skip locked`가 그 둘을 동시에 해결합니다.
create or replace function public.claim_sheets(p_exam uuid, p_limit int default 4)
returns setof public.sheets
language sql
as $$
  update public.sheets s
     set status     = 'running',
         attempts   = s.attempts + 1,
         claimed_at = now(),
         claimed_by = auth.uid(),
         error      = null
   where s.id in (
     select id
       from public.sheets
      where exam_id = p_exam
        and (
          status = 'queued'
          -- 잡아놓고 죽은 것. 300초짜리 함수라 10분이면 확실히 끝났거나 죽었습니다.
          or (status = 'running' and claimed_at < now() - interval '10 minutes')
        )
        and attempts < 3
      order by created_at
        for update skip locked
      limit greatest(p_limit, 0)
   )
  returning s.*;
$$;

-- ---------------------------------------------------------------------------
-- 화면이 쓰는 것
-- ---------------------------------------------------------------------------

-- 진행 표시. 조교가 보는 숫자는 이 한 줄이면 됩니다.
create view public.exam_progress with (security_invoker = on) as
select e.id as exam_id,
       count(s.id)                                              as total,
       count(*) filter (where s.status in ('queued', 'running')) as pending,
       count(*) filter (where s.status = 'graded')               as graded,
       count(*) filter (where s.status = 'confirmed')            as confirmed,
       count(*) filter (where s.status = 'failed')               as failed,
       -- 사람이 반드시 봐야 하는 것: 경계선, 밀림, 판정 보류
       count(*) filter (
         where s.status = 'graded'
           and (s.near_boundary
                or s.verdict is null
                or s.warnings @> '[{"level":"drift"}]'::jsonb)
       )                                                        as needs_review,
       coalesce(sum(s.cost_usd), 0)                             as cost_usd
  from public.exams e
  left join public.sheets s on s.exam_id = e.id
 group by e.id;

-- 재시험 명단. 확정된 것만 나갑니다 — 검수 전 판정으로 학생을 남기지 않습니다.
create view public.retest_roster with (security_invoker = on) as
select s.exam_id,
       s.id as sheet_id,
       s.student_name,
       s.n_wrong,
       s.cut,
       s.confirmed_at
  from public.sheets s
 where s.status = 'confirmed'
   and s.final_verdict = 'fail'
 order by s.student_name;

-- 오답 목록. 선생님이 고친 값을 반영합니다.
create view public.wrong_items with (security_invoker = on) as
select s.exam_id,
       i.sheet_id,
       s.student_name,
       i.seq,
       i.no,
       i.prompt,
       i.written,
       i.expected,
       i.note,
       i.overturned
  from public.items i
  join public.sheets s on s.id = i.sheet_id
 where i.final_correct is false
 order by s.student_name, i.seq;

-- 90일 지난 사진. 지우는 것은 앱이 합니다(스토리지 파일까지 지워야 하므로).
create view public.expired_pages with (security_invoker = on) as
select id, sheet_id, storage_path, created_at
  from public.sheet_pages
 where purged_at is null
   and created_at < now() - interval '90 days';
