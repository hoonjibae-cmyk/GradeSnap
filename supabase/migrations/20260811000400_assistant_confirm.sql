-- 확정을 조교에게 엽니다.
--
-- 처음에는 teacher 이상만 확정할 수 있었습니다(0001). "학생을 재시험에
-- 남기는 결정이라 선생님이 한다"는 이유였는데, **실제 운영이 다릅니다** —
-- 원장님: "확정도 조교가 할 일이야."
--
-- 막을 근거도 얇았습니다. 조교는 이미 문항의 ○/✗를 전부 뒤집을 수
-- 있고 오답 수가 곧 판정입니다. 마지막 단추만 잠그는 것은 결정을 막는 게
-- 아니라 결정을 다른 사람 이름으로 남기게 만드는 것이었습니다.
--
-- 🔴 여전히 막는 것: **승인되지 않은 계정.** `active`는 그대로 요구합니다.
-- 지금은 is_staff()와 같은 조건이지만 함수는 남겨둡니다 — 나중에 다시
-- 좁힐 때 고칠 곳이 한 군데라야 합니다.
create or replace function public.can_confirm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active);
$$;

-- 0005와 같은 함수인데 **오류 문구만** 바꿉니다. 이제 역할이 아니라
-- 승인 여부로 갈리므로 "선생님만"은 틀린 안내입니다.
create or replace function public.guard_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.final_verdict is distinct from old.final_verdict)
     or (new.status = 'confirmed' and old.status is distinct from 'confirmed') then
    if not public.can_confirm() then
      raise exception '확정은 승인된 직원만 할 수 있습니다.' using errcode = '42501';
    end if;
    if new.final_verdict is null then
      new.confirmed_by := null;
      new.confirmed_at := null;
    else
      new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
      new.confirmed_at := coalesce(new.confirmed_at, now());
    end if;
  end if;
  return new;
end;
$$;
