-- 방종곡 신청에 추천 사유(선택, 80자) 추가
alter table public.song_requests add column if not exists reason text check (reason is null or char_length(reason) <= 80);
