-- 랭킹 동점자 처리: 포인트가 같으면(특히 신규 가입자 전원 0포인트) 가입이 빠른 사람이
-- 위로 오게 한다. u.created_at은 GROUP BY에만 추가하면 된다(channel_id가 users PK라
-- functional dependency로 SELECT 목록엔 안 넣어도 ORDER BY에서 쓸 수 있음) — 기존 view의
-- 출력 컬럼(channel_id, channel_name, total_points, is_public) 순서/구성은 그대로 유지해야
-- CREATE OR REPLACE VIEW가 깨지지 않는다 (0005_ranking_mask_private.sql 참고).
create or replace view public.ranking as
select
  u.channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  coalesce(sum(pl.amount), 0) as total_points,
  u.is_public
from users u
left join points_ledger pl on pl.channel_id = u.channel_id
where u.banned = false
group by u.channel_id, u.channel_name, u.is_public, u.created_at
order by total_points desc, u.created_at asc;
