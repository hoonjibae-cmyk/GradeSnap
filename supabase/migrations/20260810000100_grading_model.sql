-- 채점 모델을 환경 변수에서 **설정 화면으로** 옮깁니다.
--
-- 지금까지는 `GRADING_MODEL` · `GRADING_EFFORT` 환경 변수였습니다. 되돌릴 수
-- 있게 하려고 코드 밖에 뒀던 것인데, 되돌리려면 여전히 Vercel에 들어가
-- 재배포해야 했습니다. 원장님이 직접 못 바꾸면 "되돌릴 수 있다"가 아닙니다.
--
-- 옮기면서 생기는 더 중요한 것: **조교 화면에 지금 어떤 모델로 채점되는지
-- 띄울 수 있습니다.** 환경 변수는 서버만 알아서 화면이 말할 수가 없었습니다.

alter table public.settings
  add column if not exists grading_model  text not null default 'claude-opus-5',
  add column if not exists grading_effort text not null default 'low';

-- 🔴 **동의서 선을 저장소에서 지킵니다.**
--
-- 개인정보 동의서에 적은 국외 이전 대상은 Anthropic PBC 하나입니다
-- (docs/14 §14.8). 실제 채점이 다른 회사로 나가는 것은 화면의 선택지나
-- 코드의 if 하나로 막을 일이 아닙니다 — 그 둘은 나중에 누가 고칩니다.
-- 여기서 막으면 **어떤 경로로 들어와도** 안 들어갑니다.
alter table public.settings
  add constraint settings_grading_model_anthropic
  check (grading_model like 'claude-%');

-- 사고 강도는 아는 값만. 오타로 엉뚱한 값이 들어가면 채점이 통째로 멈춥니다.
alter table public.settings
  add constraint settings_grading_effort_known
  check (grading_effort in ('low', 'medium', 'high', 'xhigh', 'max'));

-- 기본값은 지금 돌고 있는 설정 그대로입니다(docs/13 §13.15 실측).
-- 마이그레이션이 채점 결과를 바꾸면 안 됩니다.
