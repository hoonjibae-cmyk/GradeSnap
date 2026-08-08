-- 🔴 `staff` 정책이 자기 자신을 조회해 무한 재귀에 빠졌습니다.
--
-- 0002에서 admin만 명부를 고칠 수 있게 이렇게 썼습니다.
--
--   create policy staff_write on public.staff
--     using (exists (select 1 from public.staff where id = auth.uid() and role = 'admin'));
--
-- `staff`를 읽으려면 이 정책을 따져야 하고, 따지려면 `staff`를 읽어야 합니다.
-- `for all`이라 SELECT에도 걸리므로 **로그인 직후 직원 확인부터 막혔습니다.**
--
--   직원 확인: infinite recursion detected in policy for relation "staff"
--
-- 고치는 법은 `is_staff()`와 같습니다. **security definer 함수 안에서 읽으면**
-- 표 소유자 자격으로 도는 것이라 RLS를 다시 타지 않습니다.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid() and role = 'admin');
$$;

drop policy if exists staff_write on public.staff;

create policy staff_write on public.staff
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 사진 삭제 정책도 같은 모양이었습니다. 재귀는 아니지만 `staff`의 정책을
-- 다시 타므로 같은 자리에서 터집니다. 함수로 바꿉니다.
drop policy if exists sheets_bucket_delete on storage.objects;

create policy sheets_bucket_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'sheets' and public.is_admin());
