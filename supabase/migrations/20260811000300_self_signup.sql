-- 셀프 가입 + 관리자 승인 (docs/13 §13.31)
--
-- 지금까지는 관리자가 이메일·임시 비밀번호를 만들어 건넸습니다. 운영에
-- 들어가면 조교가 직접 가입하고 관리자가 승인하는 쪽이 맞습니다 —
-- 임시 비밀번호를 카톡으로 보내는 것보다 안전하기도 합니다.
--
-- 승인은 새 개념이 아닙니다. **비활성 직원 행이 곧 신청서**입니다:
--
--   가입 → 자기 행을 active=false로 넣음 → 관리자가 People에서 켬 = 승인
--
-- 안전한 이유: is_staff()·is_admin()·can_confirm()이 전부 active를
-- 요구하므로(0700), 승인 전 계정은 답안지·사진·채점 어디에도 못 닿습니다.
-- 스팸 가입이 생겨도 꺼진 행 하나일 뿐이고, 관리자가 지우면 됩니다.

-- 자기 행은 읽을 수 있어야 합니다. 없으면 "승인 대기 중"과 "명부에 없음"을
-- 화면이 구분할 수 없습니다. (staff_read는 is_staff()라 비활성은 못 읽습니다.)
-- auth.uid() 비교뿐이라 staff를 되묻지 않습니다 — 0004의 재귀와 무관합니다.
create policy staff_read_self on public.staff
  for select to authenticated using (id = auth.uid());

-- 🔴 자기 행을 **비활성 조교로만** 넣을 수 있습니다.
--   active=false  스스로 승인하는 길을 막습니다
--   role='assistant'  스스로 관리자가 되는 길을 막습니다
-- 역할 승격과 켜기는 staff_write(관리자 전용)만 할 수 있습니다.
create policy staff_self_register on public.staff
  for insert to authenticated
  with check (id = auth.uid() and active = false and role = 'assistant');
