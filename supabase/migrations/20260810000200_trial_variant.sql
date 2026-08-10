-- 실험에 **출력 형식** 축을 하나 더 둡니다.
--
-- 지금까지 `/bench`가 잴 수 있는 것은 모델과 사고 강도뿐이었습니다. 그런데
-- 비용의 70%는 출력 토큰이고, 거기서 가장 큰 덩어리는 모델이 아니라
-- **우리가 요구한 JSON 모양**입니다 — 문항 하나의 58%가 필드 이름입니다
-- (docs/13 §13.21).
--
-- 그걸 줄이는 것은 모델을 바꾸는 것보다 안전하지만 **공짜는 아닙니다.**
-- 모델은 글을 쓰면서 생각하는 부분이 있어, 이름이 짧아지면 읽기가 나빠질
-- 수도 있습니다. 그래서 모델을 재던 방식 그대로 잽니다 — 잡음 바닥과
-- 구별되지 않으면 그때 기본값을 옮깁니다.
--
-- 기본값이 'full'인 이유: 지금까지 쌓인 실험 기록은 전부 그 형식입니다.

alter table public.model_trials
  add column if not exists variant text not null default 'full';

alter table public.model_trials
  add constraint model_trials_variant_known
  check (variant in ('full', 'compact'));
