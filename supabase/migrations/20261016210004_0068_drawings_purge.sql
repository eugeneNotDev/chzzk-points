-- 그림 후원 파일 정리 — 후원 안 하고 만료된 그림은 만료 뒤, 방송에 나간(또는 관리자가 내린) 그림은 6개월 뒤(획 기록은 뜨고 5분 뒤)
-- drawings 함수가 그림 파일(이미지·획 기록)을 지우고 purged_at을 찍음. 기록 줄은 남김(누가 언제 얼마 후원했는지).
alter table public.drawings add column if not exists purged_at timestamptz;
create index if not exists drawings_purge_idx on public.drawings (status, expires_at) where purged_at is null;
