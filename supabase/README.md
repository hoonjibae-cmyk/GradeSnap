# Supabase 준비

설계 근거는 [docs/13 §13.9](../docs/13-phase1-plan.md)에 있습니다. 여기는 **손으로 할 일**만 적습니다.

## 1. 마이그레이션 적용

Supabase 대시보드 → **SQL Editor**에서 세 파일을 **순서대로** 붙여넣고 실행합니다.

```
migrations/20260808000100_init.sql       -- 표 · 뷰 · 큐 함수
migrations/20260808000200_rls.sql        -- 접근 제어 · 사진 버킷
migrations/20260808000300_intake.sql     -- 시험 묶음을 버리고 접수 단위로
```

CLI를 쓴다면 `supabase db push`도 같은 일을 합니다.

## 2. 첫 직원 넣기

**자기 자신을 admin으로 올리는 경로를 앱에 두지 않았습니다.** 첫 사람은 여기서 넣습니다.

1. 대시보드 → **Authentication → Users → Add user**로 계정을 만듭니다.
2. 그 사용자의 UUID를 복사해 SQL Editor에서:

```sql
insert into public.staff (id, name, role)
values ('붙여넣은-uuid', '원장', 'admin');
```

그다음부터는 admin이 화면에서 직원을 추가합니다.

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
select count(*) from public.sheets;            -- 0이 나오면 정상
select to_regclass('public.exams') is null;    -- t 여야 합니다 (0003이 없앱니다)
```

## 사진 보관

`sheets` 버킷은 **비공개**입니다. 화면에는 서명 URL로만 띄웁니다.
90일이 지난 사진은 앱이 지우고 `sheet_pages.purged_at`을 찍습니다 —
**행은 남습니다.** 무엇이 있었는지는 기록입니다.
