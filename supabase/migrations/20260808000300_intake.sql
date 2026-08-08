-- 시험 단위를 버리고 **접수 단위**로 바꿉니다.
--
-- 처음에 "한 반이 같은 시험을 본다"고 놓고 짰는데 틀렸습니다.
-- 같은 반이라도 **학생마다 보는 시험이 다릅니다.** 조교는 시험지를 한 장씩
-- 받는 대로 채점을 걸고, 앞 학생이 채점되는 중에 다음 학생을 받습니다.
-- 조교 둘이 각자 그렇게 합니다.
--
-- 그러면 `exams`는 묶을 것이 없는 빈 껍데기입니다. 시험 이름은 어차피
-- 시험지 머리말에서 읽으므로, 그걸 답안지 행에 그대로 둡니다.
--
-- 0001·0002 위에 이것 하나만 돌리면 됩니다. 중간에 다른 걸 돌리셨어도
-- 전부 `if exists`라 그냥 지나갑니다.

-- 상태에 'uploading'을 넣습니다 ------------------------------------------------
-- 사진 행이 답안지 행을 가리켜야 하므로(FK) 행을 먼저 만들어야 하는데,
-- 그 사이에 'queued'면 **사진 없는 답안지를 채점하러 갑니다.**
alter table public.sheets drop constraint if exists sheets_status_check;
alter table public.sheets
  add constraint sheets_status_check
  check (status in ('uploading', 'queued', 'running', 'graded', 'failed', 'confirmed'));
alter table public.sheets alter column status set default 'uploading';

-- 시험 표를 없앱니다 ------------------------------------------------------------
drop view if exists public.exam_progress;
drop view if exists public.retest_roster;
drop view if exists public.wrong_items;
drop function if exists public.claim_sheets(uuid, int);
drop index if exists public.sheets_queue_idx;
drop index if exists public.sheets_review_idx;

alter table public.sheets
  -- 반. 조교가 한 번 골라두면 다음 학생부터 그대로 씁니다. 안 골라도 됩니다.
  add column if not exists class_name      text not null default '',
  -- 시험 이름. **머리말에서 읽습니다.** 학생마다 다릅니다.
  add column if not exists title           text not null default '',
  -- 커트라인 직접 입력. 빨간펜이 머리말을 덮었을 때만 씁니다.
  add column if not exists cut_line        text,
  add column if not exists strict_spelling boolean not null default false,
  -- 누가 받았나. 조교 둘이 같은 화면을 보므로 구분이 필요합니다.
  add column if not exists received_by     uuid references public.staff (id);

alter table public.sheets drop column if exists exam_id;
drop table if exists public.exams cascade;

create index sheets_queue_idx on public.sheets (status, created_at);
create index sheets_day_idx on public.sheets (created_at desc);

-- 큐 ---------------------------------------------------------------------------
--
-- 접수하는 즉시 그 답안지를 집어 채점합니다. 그런데 **그것만으로는 부족합니다** —
-- 조교가 채점 도중 창을 닫으면 그 한 장이 'running'인 채로 남습니다.
-- 그래서 두 가지를 둡니다.
--
--   claim_sheet(id)  방금 접수한 그 장을 집는다        ← 접수 직후
--   claim_next(n)    떠도는 것을 아무거나 집는다        ← 화면을 연 사람이 쓸어담음
--
-- 둘 다 `for update skip locked`라 조교 둘이 동시에 집어도 겹치지 않습니다.

/** 방금 접수한 답안지를 집습니다. 남이 이미 집었으면 아무것도 안 돌려줍니다. */
create or replace function public.claim_sheet(p_id uuid)
returns setof public.sheets
language sql
as $$
  update public.sheets s
     set status     = 'running',
         attempts   = s.attempts + 1,
         claimed_at = now(),
         claimed_by = auth.uid(),
         error      = null
   where s.id = (
     select id
       from public.sheets
      where id = p_id
        and (status = 'queued'
             -- 잡아놓고 죽은 것. 300초짜리 함수라 10분이면 확실히 끝났거나 죽었습니다.
             or (status = 'running' and claimed_at < now() - interval '10 minutes'))
        and attempts < 3
        for update skip locked
   )
  returning s.*;
$$;

/** 떠도는 것을 오래된 순으로 집습니다. 남의 것도 집습니다 — 채점은 누가 하든 같습니다. */
create or replace function public.claim_next(p_limit int default 1)
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
      where (status = 'queued'
             or (status = 'running' and claimed_at < now() - interval '10 minutes'))
        and attempts < 3
      order by created_at
        for update skip locked
      limit greatest(p_limit, 0)
   )
  returning s.*;
$$;

-- 화면이 쓰는 것 ---------------------------------------------------------------

-- 재시험 명단. 확정된 것만 나갑니다 — 검수 전 판정으로 학생을 남기지 않습니다.
create view public.retest_roster with (security_invoker = on) as
select s.id as sheet_id,
       s.created_at::date as received_on,
       s.class_name,
       s.student_name,
       s.title,
       s.n_wrong,
       s.cut,
       s.confirmed_at
  from public.sheets s
 where s.status = 'confirmed'
   and s.final_verdict = 'fail'
 order by s.class_name, s.student_name;

-- 오답 목록. 선생님이 고친 값을 반영합니다.
create view public.wrong_items with (security_invoker = on) as
select i.sheet_id,
       s.created_at::date as received_on,
       s.class_name,
       s.student_name,
       s.title,
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
 order by s.class_name, s.student_name, i.seq;
