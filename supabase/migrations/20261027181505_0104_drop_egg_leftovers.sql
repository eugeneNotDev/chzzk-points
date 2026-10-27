-- 0104 — 이스터에그 삭제 (2/2): stream-code·admin-backup 새 함수 배포 뒤 적용
drop function if exists public.stream_code_doc(text, text);
drop table if exists public.egg_progress;
