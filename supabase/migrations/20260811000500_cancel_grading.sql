-- 채점 중단.
--
-- 조교가 **뒷장을 안 찍고 접수하는 일**이 생깁니다. 지금은 되돌릴 방법이
-- 없어서, 잘못 올린 줄 알면서도 끝날 때까지 지켜봐야 했습니다. 그 사이 돈은
-- 나가고, 결과는 어차피 버릴 것이고, 조교는 다음 학생을 못 받습니다.
--
-- 상태를 하나 늘립니다. 'cancelled'는 **다시 안 집힙니다** —
-- `claim_sheet`·`claim_next`가 'queued'와 오래된 'running'만 보기 때문에
-- 함수는 손댈 것이 없습니다.
--
-- 🔴 **아직 안 집힌 것을 중단하면 돈이 한 푼도 안 나갑니다.** 이미 도는 것을
-- 중단하면 모델 호출은 못 멈춥니다 — 결과를 안 쓸 뿐이고, 그때까지 쓴 돈은
-- 그대로 기록에 남습니다. 화면이 그 차이를 말해야 합니다.
alter table public.sheets drop constraint if exists sheets_status_check;
alter table public.sheets
  add constraint sheets_status_check
  check (status in ('uploading', 'queued', 'running', 'cancelled', 'graded', 'failed', 'confirmed'));
