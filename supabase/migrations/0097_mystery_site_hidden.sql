-- 미스테리 라디오 — 리모컨에서 팬보드 투표 탭 카드를 직접 내리기/다시 올리기(site_hidden=true면 시청자에게 안 보임)
alter table public.mystery_sets add column if not exists site_hidden boolean not null default false;
