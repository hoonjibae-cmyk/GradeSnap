# Supabase 준비

설계 근거는 [docs/13 §13.9](../docs/13-phase1-plan.md)에 있습니다. 여기는 **손으로 할 일**만 적습니다.

## 1. 마이그레이션 적용

Supabase 대시보드 → **SQL Editor**에서 파일을 **순서대로** 붙여넣고 실행합니다.

```
migrations/20260808000100_init.sql              -- 표 · 뷰 · 큐 함수
migrations/20260808000200_rls.sql               -- 접근 제어 · 사진 버킷
migrations/20260808000300_intake.sql            -- 시험 묶음을 버리고 접수 단위로
migrations/20260808000400_fix_staff_recursion.sql  -- 직원 정책 무한 재귀 수정
migrations/20260808000500_unconfirm.sql         -- 확정 취소 시 기록도 지움
migrations/20260808000600_model_trials.sql      -- 모델 비교 실험 기록
migrations/20260808000700_users_usage.sql       -- 직원 켜고 끄기 · 근무 시간 · 사용 기록
migrations/20260809000100_work_hours.sql        -- 근무 시간을 요일별로
migrations/20260810000100_grading_model.sql     -- 채점 모델을 관리 화면에서 고름
migrations/20260810000200_trial_variant.sql     -- 실험에 '출력 형식' 축 추가
migrations/20260810000300_trial_variant_items.sql  -- 압축을 전사/판정으로 나눔
migrations/20260811000100_trial_edge.sql        -- 실험에 '사진 해상도' 축 추가
migrations/20260811000200_exam_refs.sql         -- 같은 시험 참조 (기본 꺼짐)
migrations/20260811000300_self_signup.sql       -- 셀프 가입 + 관리자 승인
migrations/20260811000400_assistant_confirm.sql -- 확정을 조교에게도 엶
```

시험 참조를 **켜는** 것은 마이그레이션과 별개입니다. 관리 화면의 스위치를
누르거나, SQL Editor에서:

```sql
update public.settings set use_exam_refs = true;
```

끄는 것도 같은 자리입니다(`false`). 끄면 즉시 예전 방식으로 돌아갑니다.

`grading_model` 마이그레이션을 안 돌리면 **채점이 멈춥니다.** 모르는 설정으로 돈을 쓰지 않으려고
일부러 그렇게 두었습니다(docs/13 §13.20). 관리 화면이 무엇이 빠졌는지 알려줍니다.

CLI를 쓴다면 `supabase db push`도 같은 일을 합니다.

## 1.5 셀프 가입이 되려면 (Supabase 설정)

대시보드 → **Authentication → Sign In / Up** 에서:

1. **Email 가입이 켜져 있는지** 확인합니다 (Enable email sign-ups).
2. **Confirm email은 끄기를 권합니다.** 어차피 관리자 승인 없이는 아무것도
   못 보므로 이중 관문이고, Supabase 기본 메일은 시간당 몇 통으로 묶여 있어
   조교 여럿이 같은 날 가입하면 확인 메일이 안 나갑니다.
   켜두어도 앱은 동작합니다 — 메일 확인 후 로그인하면 신청 화면이 이어집니다.

## 2. 첫 직원 넣기

**자기 자신을 admin으로 올리는 경로를 앱에 두지 않았습니다.** 첫 사람은 여기서 넣습니다.

1. 대시보드 → **Authentication → Users → Add user**로 계정을 만듭니다.
2. 그 사용자의 UUID를 복사해 SQL Editor에서:

```sql
insert into public.staff (id, name, role)
values ('붙여넣은-uuid', '원장', 'admin');
```

그다음부터는 admin이 **`/admin` 화면에서** 직원을 추가합니다. SQL은 첫 사람 한 번뿐입니다.

| 역할 | 할 수 있는 것 |
|---|---|
| `assistant` (조교) | 사진 올리기 · 결과 보기 · 문항 고치기 |
| `teacher` (선생님) | 위 전부 + **확정** (PASS/FAIL 최종 결정) |
| `admin` | 위 전부 + 직원 관리 |

## 3. 환경 변수

Vercel 프로젝트 → Settings → Environment Variables. `.env.example`과 같은 이름입니다.

| 이름 | 어디서 | 노출 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | 브라우저에 나갑니다 (정상) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 같은 곳 | 브라우저에 나갑니다 (정상 — RLS가 막습니다) |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 곳 · **service_role** | 🔴 **서버 전용.** RLS를 통째로 우회합니다 |
| `ANTHROPIC_API_KEY` | console.anthropic.com | 🔴 서버 전용 |

`SUPABASE_SERVICE_ROLE_KEY`는 **90일 지난 사진을 지우는 정리 작업에서만** 씁니다.
편하다고 채점 라우트에서 쓰면 RLS가 꺼지고 "누가 확정했나"가 전부 null이 됩니다.

## 4. 확인

```sql
select public.is_staff();                      -- 로그인한 채로 true여야 합니다
select public.is_admin();                      -- 첫 직원이면 true
select * from public.staff;                    -- 여기서 안 멈추면 재귀가 풀린 것입니다
select count(*) from public.sheets;            -- 0이 나오면 정상
select to_regclass('public.exams') is null;    -- t 여야 합니다 (0003이 없앱니다)
```

## 사진 보관 — 90일

`sheets` 버킷은 **비공개**입니다. 화면에는 서명 URL로만 띄웁니다.

90일이 지난 사진은 **매일 새벽 3시(KST)** 에 Vercel Cron이 지웁니다
(`vercel.json` → `/api/retention`). 파일을 먼저 지우고 `sheet_pages.purged_at`을
찍습니다 — **행은 남습니다.** 무엇이 있었는지는 기록입니다.

돌리려면 환경 변수 하나가 더 필요합니다.

| 이름 | 값 | 왜 |
|---|---|---|
| `CRON_SECRET` | 아무 긴 무작위 문자열 | Vercel Cron만 부를 수 있게 막습니다 |

**`SUPABASE_SERVICE_ROLE_KEY`가 실제로 쓰이는 곳이 여기 하나입니다.**
정리 작업은 부르는 사람의 세션이 없어 RLS를 통과할 수 없습니다.

확인은 `/admin`에서 합니다 — 갖고 있는 사진 수, 지워야 할 사진 수, 가장
오래된 사진 날짜가 나오고 손으로 돌리는 버튼도 있습니다.

```sql
-- 지울 것이 남아 있는가 (0이어야 정상)
select count(*) from public.expired_pages;
```
