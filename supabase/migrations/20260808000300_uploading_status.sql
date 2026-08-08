-- 업로드 중인 답안지를 큐가 집어가면 안 됩니다.
--
-- 행을 먼저 만들어야 사진 행이 그걸 가리킬 수 있는데(FK), 그 사이에 상태가
-- 'queued'면 **사진이 하나도 없는 답안지를 채점하러 갑니다.**
-- 그래서 시작 상태를 'uploading'으로 두고, 사진이 다 올라간 뒤에 'queued'로 바꿉니다.
--
-- 사진 올리다 조교가 창을 닫으면 'uploading'인 채로 남습니다. 그건 그대로 둡니다 —
-- 큐가 안 집어가고, 화면에서 "올리다 만 것"으로 보여 지우면 됩니다.

alter table public.sheets drop constraint sheets_status_check;

alter table public.sheets
  add constraint sheets_status_check
  check (status in ('uploading', 'queued', 'running', 'graded', 'failed', 'confirmed'));

alter table public.sheets alter column status set default 'uploading';

-- 진행 표시에 '올리는 중'을 따로 셉니다. 채점 대기와 뜻이 다릅니다 —
-- 하나는 조교가 아직 하는 중이고, 하나는 기계가 할 차례입니다.
--
-- `create or replace`로는 칼럼을 중간에 못 끼웁니다. 끝에 붙이면 순서가
-- 뜻과 어긋나므로 지우고 다시 만듭니다.
drop view if exists public.exam_progress;

create view public.exam_progress with (security_invoker = on) as
select e.id as exam_id,
       count(s.id)                                              as total,
       count(*) filter (where s.status = 'uploading')            as uploading,
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
