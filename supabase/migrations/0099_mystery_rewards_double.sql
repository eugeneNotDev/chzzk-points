-- 미스테리 라디오 기본 보상 상향: 맞힌 개수 1/2/3개 → 250/500/1,000P (하나 더 맞힐 때마다 2배). 아직 안 연 회차(ready)도 새 값으로.
alter table public.mystery_sets alter column base_rewards set default '{0,250,500,1000}';
update public.mystery_sets set base_rewards = '{0,250,500,1000}' where status = 'ready';
