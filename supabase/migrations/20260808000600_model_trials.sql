-- 값싼 모델로 같은 답안지를 다시 채점해 본 기록.
--
-- **채점 결과를 덮지 않습니다.** `sheets`·`items`는 실제로 나가는 결과이고,
-- 여기는 "만약 다른 모델이었다면"입니다. 섞으면 학생에게 나간 판정이
-- 실험 때문에 바뀝니다.
--
-- 같은 답안지·같은 모델을 여러 번 돌릴 수 있게 유일 제약을 두지 않습니다 —
-- 같은 조건에서 두 번 돌려 답이 흔들리는지 보는 것도 실험입니다.

create table public.model_trials (
  id       uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.sheets (id) on delete cascade,
  model    text not null,
  /** 사고 강도. 같은 모델도 이걸 낮추면 싸집니다 — 그것도 '하위 단계'입니다. */
  effort   text not null default 'high',

  transcript jsonb,
  results    jsonb,
  warnings   jsonb not null default '[]'::jsonb,
  missing       int,
  cut           int,
  n_wrong       int,
  verdict       text check (verdict in ('pass', 'fail')),
  near_boundary boolean,
  margin        int,

  token_usage jsonb,
  cost_usd    numeric(10, 4),
  latency_ms  int,
  /** 값싼 모델이 스키마를 못 맞추거나 거절하는 것도 결과입니다. 지우지 않고 남깁니다. */
  error       text,

  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id)
);

create index model_trials_sheet_idx on public.model_trials (sheet_id, created_at desc);
create index model_trials_model_idx on public.model_trials (model, effort);

alter table public.model_trials enable row level security;

-- 돈이 나가는 실험이라 아무나 돌리지 않습니다.
create policy model_trials_read on public.model_trials
  for select to authenticated using (public.is_staff());

create policy model_trials_write on public.model_trials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
