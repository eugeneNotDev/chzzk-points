-- DB에는 적용돼 있었는데 저장소에 파일이 없던 변경 — DB 기록(supabase_migrations)에서 그대로 옮겨옴.
alter function public.donation_points(integer) set search_path = public;
