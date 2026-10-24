-- 특수 칭호 장착 방식 변경 (0054_special_titles.sql 이어서)
--  · 예전: 가진 특수 칭호가 전부 닉네임 위에 자동으로 붙음(유저가 못 끔). "지난달 1위"는 저장 없이 매번 계산.
--  · 이제: 특수 칭호도 마이페이지에서 하나 골라 장착(users.selected_special_id). 랭킹엔 장착한 하나만 보임.
--    - 관리자가 "고정"으로 준 칭호(forced)는 항상 그게 보이고, 유저가 해제하거나 바꿀 수 없음(고정이 여러 개면 최근 것).
--    - 지난달 1·2·3위 칭호(source='monthly')는 매달 1일 0시 5분(KST)에 user_special_titles에 지급 — 자동 장착은 안 함.
--      다음 달 지급 때 이전 달 것은 회수(그 달 동안만 "지난달 N위"). 2026-11-01부터.
--  · 원래 있던 관리자 특수 칭호는 그대로 보이게 장착 상태로 옮겨둠.

alter table public.user_special_titles
  add column if not exists forced boolean not null default false,
  add column if not exists source text not null default 'admin' check (source in ('admin', 'monthly')),
  add column if not exists rank smallint;

alter table public.users
  add column if not exists selected_special_id bigint references public.user_special_titles(id) on delete set null;

-- 기존 칭호는 지금처럼 보이게: 장착된 게 없는 유저는 가장 최근 칭호를 장착
update public.users u
set selected_special_id = s.id
from (
  select distinct on (channel_id) channel_id, id
  from public.user_special_titles
  order by channel_id, id desc
) s
where s.channel_id = u.channel_id and u.selected_special_id is null;

-- 지난달 1~3위(지난달 말 보유 포인트 기준, last_month_champion과 같은 대상·순서)
create or replace function public.last_month_top3()
returns table (channel_id text, rank int, points bigint)
language sql stable security definer set search_path = public
as $$
  with b as (
    select (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as m
  ), r as (
    select u.channel_id,
           (u.balance - x.s)::bigint as points,
           row_number() over (order by (u.balance - x.s) desc, u.created_at asc)::int as rank
    from public.users u
    cross join b
    left join lateral (
      select coalesce(sum(l.amount), 0) as s
      from public.points_ledger l
      where l.channel_id = u.channel_id and l.created_at >= b.m
    ) x on true
    where now() >= timestamptz '2026-11-01 00:00:00+09'
      and u.banned = false
      and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts)
      and (u.balance - x.s) > 0
  )
  select r.channel_id, r.rank, r.points from r where r.rank <= 3 order by r.rank;
$$;
revoke all on function public.last_month_top3() from public, anon, authenticated;
grant execute on function public.last_month_top3() to service_role;

-- 매일 00:05 KST(cron 'monthly-champion')에 돌아감. 그 달 기록이 새로 들어간 날(= 매달 1일)에만
-- 명예의 전당 기록 + 지난달 1~3위 특수 칭호 교체.
create or replace function public.record_monthly_champion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month')::date;
  v_new int;
begin
  insert into public.monthly_champions (month, channel_id, points)
  select v_month, t.channel_id, t.points from public.last_month_top3() t where t.rank = 1
  on conflict (month) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return;
  end if;

  delete from public.user_special_titles where source = 'monthly';
  insert into public.user_special_titles (channel_id, name, color, source, rank)
  select t.channel_id,
         '지난달 ' || t.rank || '위',
         case t.rank when 1 then 'shine-crown-d4af37' when 2 then 'shine-medal-c0c7d1' else 'shine-medal-cd7f32' end,
         'monthly',
         t.rank
  from public.last_month_top3() t;
end;
$$;
revoke all on function public.record_monthly_champion() from public, anon, authenticated;

-- 유저별 보여줄 특수 칭호(하나): 고정 칭호가 있으면 그것(최근 것), 없으면 장착한 것.
-- 관리자 랭킹(admin-ranking)용. 화면 쪽 모양은 그대로(배열) 둠.
create or replace function public.ranking_special_titles()
returns table (channel_id text, titles jsonb)
language sql stable security definer set search_path = public
as $$
  select u.channel_id, jsonb_build_array(jsonb_build_object('name', t.name, 'color', t.color))
  from public.users u
  join lateral (
    select s.name, s.color
    from public.user_special_titles s
    where s.channel_id = u.channel_id and (s.forced or s.id = u.selected_special_id)
    order by s.forced desc, s.id desc
    limit 1
  ) t on true;
$$;
revoke all on function public.ranking_special_titles() from public, anon, authenticated;
grant execute on function public.ranking_special_titles() to service_role;

-- 공개 랭킹 뷰 — special_titles만 위 규칙으로 바꿈(나머지는 0054 그대로).
create or replace view public.ranking as
 SELECT
        CASE WHEN u.is_public THEN u.channel_id ELSE u.rank_key::text END AS channel_id,
        CASE WHEN u.is_public THEN u.channel_name ELSE '비공개'::text END AS channel_name,
    u.balance AS total_points,
    u.is_public,
        CASE WHEN u.is_public THEN tier.name ELSE NULL::text END AS tier_title_name,
        CASE WHEN u.is_public THEN tier.color ELSE NULL::text END AS tier_title_color,
        CASE WHEN u.is_public THEN shop.name ELSE NULL::text END AS shop_title_name,
        CASE WHEN u.is_public THEN shop.color ELSE NULL::text END AS shop_title_color,
        CASE WHEN u.is_public AND sp.name IS NOT NULL
             THEN jsonb_build_array(jsonb_build_object('name', sp.name, 'color', sp.color))
             ELSE NULL::jsonb END AS special_titles
   FROM users u
     LEFT JOIN LATERAL ( SELECT t.name,
            t.color
           FROM titles t
          WHERE t.kind = 'tier'::text AND t.min_points <= u.max_balance_reached
          ORDER BY t.min_points DESC
         LIMIT 1) tier ON true
     LEFT JOIN titles shop ON shop.id = u.selected_title_id
     LEFT JOIN LATERAL ( SELECT s.name,
            s.color
           FROM user_special_titles s
          WHERE s.channel_id = u.channel_id AND (s.forced OR s.id = u.selected_special_id)
          ORDER BY s.forced DESC, s.id DESC
         LIMIT 1) sp ON true
  WHERE u.banned = false AND u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f'::text
  ORDER BY u.balance DESC, u.created_at;
