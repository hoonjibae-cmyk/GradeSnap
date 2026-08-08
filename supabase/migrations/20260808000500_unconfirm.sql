-- 확정을 취소하면 확정 기록도 지워져야 합니다.
--
-- 0002의 트리거가 `coalesce(new.confirmed_by, auth.uid())`로 도장을 찍습니다.
-- 확정할 때는 맞지만, **취소할 때도 다시 찍힙니다** — 앱이 null을 넣어도
-- coalesce가 덮어씁니다. 그러면 확정되지 않은 답안지에 "누가 언제 확정했다"가
-- 남아, 나중에 기록을 읽는 사람이 잘못 믿습니다.
--
-- 판정이 사라지는 방향일 때는 도장도 지웁니다.

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
      raise exception '확정은 선생님만 할 수 있습니다.' using errcode = '42501';
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
