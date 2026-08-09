-- 근무 시간을 요일마다 따로 둡니다.
--
-- 처음에는 시작·끝 한 쌍에 근무 요일 목록을 붙였습니다. 그러면 **모든 요일이
-- 같은 시간**이어야 하는데, 학원은 그렇지 않습니다 — 토요일만 오전에 하거나
-- 금요일만 늦게 끝나는 일이 흔합니다.
--
-- 그 상태로 두면 '근무 시간 외'가 틀리게 세어지고, 그 숫자는 직원을 의심하는
-- 데 쓰입니다. **틀린 기준으로 사람을 보게 두면 안 됩니다.**
--
-- 요일마다 칼럼을 열넷 파는 대신 jsonb 배열 하나로 둡니다.
--
--   [null, {"start":17,"end":22}, …]   0=일 … 6=토, null이면 근무일 아님

alter table public.settings add column if not exists work_hours jsonb;

-- 지금 설정을 그대로 옮깁니다. 관리자가 다시 입력할 이유가 없습니다.
update public.settings
   set work_hours = (
     select jsonb_agg(
              case when d = any(work_days)
                   then jsonb_build_object('start', work_start, 'end', work_end)
                   else 'null'::jsonb end
              order by d)
       from generate_series(0, 6) as d
   )
 where work_hours is null;

alter table public.settings alter column work_hours set not null;

-- 기본값은 월~토 13~23시. 학원은 토요일에도 돕니다.
alter table public.settings alter column work_hours set default
  '[null,
    {"start":13,"end":23},
    {"start":13,"end":23},
    {"start":13,"end":23},
    {"start":13,"end":23},
    {"start":13,"end":23},
    {"start":13,"end":23}]'::jsonb;

-- 배열이 아니거나 길이가 7이 아니면 요일과 칸이 어긋납니다. 그건 조용히
-- 틀리는 종류라 DB에서 막습니다.
alter table public.settings
  add constraint settings_work_hours_shape
  check (jsonb_typeof(work_hours) = 'array' and jsonb_array_length(work_hours) = 7);

alter table public.settings
  drop column if exists work_start,
  drop column if exists work_end,
  drop column if exists work_days;
