-- 미스테리 라디오 진행 여부를 메뉴 "진행 중" 표시에 쓰려고 id·status·site_hidden 열만 공개 읽기 허용(제목·문항·정답·투표는 계속 비공개)
grant select (id, status, site_hidden) on public.mystery_sets to anon, authenticated;
create policy mystery_sets_public_status on public.mystery_sets for select to anon, authenticated using (true);
