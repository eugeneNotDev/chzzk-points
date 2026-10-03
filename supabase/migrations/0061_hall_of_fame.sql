-- 명예의 전당 — 매달 1일 0시(KST)에 지난달 1위(last_month_champion과 같은 기준: 지난달 말 보유 포인트 1위,
-- 관리자·차단 유저 제외)를 기록해 둠. last_month_champion이 2026-11-01부터 동작하므로 첫 기록은 2026년 10월.
create table if not exists public.monthly_champions (
  month date primary key,                 -- 그 달 1일 (예: 2026-10-01 = 10월 1위)
  channel_id text not null references public.users(channel_id) on delete cascade,
  points bigint not null,                 -- 그 달 말 보유 포인트
  recorded_at timestamptz not null default now()
);
alter table public.monthly_champions enable row level security;

-- 지난달 1위를 기록(이미 있으면 그대로). 매일 00:05 KST에 돌려서 1일에 한 번 실제로 들어감.
create or replace function public.record_monthly_champion()
returns void
language sql
security definer
set search_path = public
as $$
  with b as (
    select (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as m
  ), c as (
    select public.last_month_champion() as cid
  )
  insert into public.monthly_champions (month, channel_id, points)
  select ((b.m at time zone 'Asia/Seoul') - interval '1 month')::date,
         c.cid,
         u.balance - coalesce((select sum(l.amount) from public.points_ledger l where l.channel_id = c.cid and l.created_at >= b.m), 0)
  from b, c join public.users u on u.channel_id = c.cid
  where c.cid is not null
  on conflict (month) do nothing;
$$;
revoke all on function public.record_monthly_champion() from public, anon, authenticated;

-- 랭킹 페이지용(anon). 비공개 유저는 랭킹과 같이 이름을 가림(지금 공개 여부 기준 — 나중에 공개로 바꾸면 보임).
create or replace function public.hall_of_fame()
returns table (month date, channel_name text, points bigint, is_public boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.month,
         case when u.is_public then u.channel_name else null end,
         m.points,
         u.is_public
  from public.monthly_champions m
  join public.users u on u.channel_id = m.channel_id
  order by m.month desc
  limit 24;
$$;
revoke all on function public.hall_of_fame() from public;
grant execute on function public.hall_of_fame() to anon, authenticated;

select cron.schedule('monthly-champion', '5 15 * * *', $$select public.record_monthly_champion();$$);
