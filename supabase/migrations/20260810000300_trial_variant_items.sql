-- 압축을 **단계별로** 나눕니다.
--
-- 2026-08-10 실측에서 `compact`(전사·판정 둘 다 압축)를 돌렸더니
--
--   전사가 다른 칸   4   ← 잡음 바닥 9보다 낮음. 멀쩡합니다
--   문항 불일치      6   ← 잡음 바닥 1. 그리고 방향이 6:0
--
-- 이었습니다. 특히 김예지는 **전사가 완전히 같은데 판정만 4건** 갈렸고
-- 전부 '오답을 놓치는' 쪽이었습니다. 손해는 판정 단계에서 났습니다.
--
-- 그래서 `items`를 둡니다 — **전사만 압축하고 판정은 원래대로.**
-- 아낄 수 있는 쪽만 아끼고, 손해 보는 쪽은 안 건드립니다.

alter table public.model_trials
  drop constraint if exists model_trials_variant_known;

alter table public.model_trials
  add constraint model_trials_variant_known
  check (variant in ('full', 'items', 'compact'));
