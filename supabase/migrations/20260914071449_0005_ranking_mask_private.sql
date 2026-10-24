-- 비공개 유저를 랭킹에서 아예 빼는 대신, 전부 포함하되 이름만 "비공개"로 가림.
-- (프론트에서 본인 행은 로컬에 저장된 본인 channelName으로 다시 덮어써서 표시함)
-- is_public 컬럼은 기존 컬럼 순서(channel_id, channel_name, total_points) 뒤에 추가해야
-- CREATE OR REPLACE VIEW로 컬럼 이름이 안 바뀜.
create or replace view public.ranking as
select
  u.channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  coalesce(sum(pl.amount), 0) as total_points,
  u.is_public
from users u
left join points_ledger pl on pl.channel_id = u.channel_id
group by u.channel_id, u.channel_name, u.is_public
order by total_points desc;

grant select on public.ranking to anon, authenticated;
