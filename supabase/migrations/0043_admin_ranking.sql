-- 관리자(채널 주인)가 보는 랭킹 — 비공개 유저도 실제 이름/칭호 그대로.
-- 공개 랭킹(public.ranking 뷰)은 누구나 읽을 수 있어서 비공개 유저 이름을 "비공개"로 가려서 내림.
-- 관리자는 한눈에 전체 순위를 보고 싶어서, 가리기 전 값을 돌려주는 함수를 따로 둠.
-- 순서/대상(밴 제외, 관리자 계정 제외)은 public.ranking과 똑같음 — 뷰를 고치면 여기도 같이 고칠 것.
-- anon/authenticated는 못 부르고 service_role(Edge Function admin-ranking — 세션 토큰으로 관리자 확인)만 부름.
create or replace function public.admin_ranking(p_limit int default 50)
returns table (
  channel_id text,
  channel_name text,
  total_points bigint,
  is_public boolean,
  tier_title_name text,
  tier_title_color text,
  shop_title_name text,
  shop_title_color text
) as $$
  select
    u.channel_id,
    u.channel_name,
    u.balance,
    u.is_public,
    tier.name,
    tier.color,
    shop.name,
    shop.color
  from public.users u
  left join lateral (
    select t.name, t.color from public.titles t
    where t.kind = 'tier' and t.min_points <= u.max_balance_reached
    order by t.min_points desc limit 1
  ) tier on true
  left join public.titles shop on shop.id = u.selected_title_id
  where u.banned = false
    and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts), 관리자 계정 제외
  order by u.balance desc, u.created_at asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$ language sql stable security definer set search_path = public;

revoke all on function public.admin_ranking(int) from public, anon, authenticated;
grant execute on function public.admin_ranking(int) to service_role;
