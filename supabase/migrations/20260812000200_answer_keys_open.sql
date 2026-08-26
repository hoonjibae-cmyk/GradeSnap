-- 정답지 등록을 **조교에게 엽니다.**
--
-- 처음에는 확정과 같은 문(can_confirm)을 달았습니다. "정답지가 틀리면 반
-- 전체가 틀리게 채점된다"는 이유였는데, 실제 운영이 다릅니다 —
--
-- > 원장: "정답지는 어차피 각 선생님들이 만들어서 출력해두는 것이기 때문에,
-- > 조교가 사진을 찍어서 업로드한다고 해서 특별히 문제가 될 사항은 없어."
--
-- 정답을 **정하는** 사람은 선생님입니다. 조교가 하는 일은 그 종이를 찍어
-- 올리는 것뿐입니다. 그리고 이 프로그램은 **채점이 밀릴 때** 쓰는 도구라,
-- 정답지 등록에 관리자를 기다려야 하면 밀리는 그 시간에 못 씁니다.
--
-- 누가 올렸는지는 `created_by`에 그대로 남습니다.
drop policy if exists answer_keys_write on public.answer_keys;
create policy answer_keys_write on public.answer_keys
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
