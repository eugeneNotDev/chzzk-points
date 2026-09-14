-- 칭호(title) 시스템 1차(임시) 버전.
--
-- 규칙: "지금까지 한 번이라도 도달한 최고 보유 포인트"를 기준으로 잠금 해제된다 — 즉 나중에
-- 상점에서 포인트를 쓰거나 관리자가 차감해서 잔액이 줄어도, 한 번 찍은 칭호는 계속 유지된다
-- (업적/도전과제 방식). 마이페이지에서 잠금 해제된 칭호 중 하나를 "장착"할 수 있고, 장착한
-- 칭호는 랭킹에 "[칭호1] 이름" 형태로 붙어서 보인다.
--
-- 이름/필요 포인트/개수는 전부 임시값이고 나중에 디자인과 함께 바뀔 예정이라, shop_items와
-- 같은 패턴으로 테이블로 뺐다 — 배포 없이 Table Editor에서 이름/금액/순서를 바로 조정 가능.

create table if not exists public.titles (
  id text primary key,                 -- 소문자-하이픈 슬러그
  name text not null,                  -- 화면에 보일 이름 (예: "칭호1")
  min_points bigint not null,          -- 이 금액을 한 번이라도 찍으면 잠금 해제
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.titles enable row level security;

-- 상점 상품 목록과 같은 패턴 — 마이페이지가 Edge Function 없이 바로 조회해서 그린다.
create policy "titles_public_read" on public.titles
  for select
  using (true);

insert into public.titles (id, name, min_points, sort_order) values
  ('title1', '칭호1', 100, 1),
  ('title2', '칭호2', 1000, 2),
  ('title3', '칭호3', 10000, 3),
  ('title4', '칭호4', 100000, 4),
  ('title5', '칭호5', 1000000, 5)
on conflict (id) do nothing;

-- 유저별: 지금까지 한 번이라도 도달한 최고 보유 포인트(잠금해제 판정 기준) + 현재 장착한 칭호.
alter table public.users
  add column if not exists max_balance_reached bigint not null default 0,
  add column if not exists selected_title_id text references public.titles(id) on delete set null;

-- 기존 유저들 백필: points_ledger를 id(=시간) 순으로 누적합을 구해서, 그 누적합의 최댓값을
-- "이제까지의 진짜 최고 보유 포인트"로 채워넣는다 (현재 잔액만 쓰면, 과거에 더 많이 모았다가
-- 상점에서 써서 지금은 줄어든 유저의 경우 실제보다 낮게 잡혀버림).
update public.users u
set max_balance_reached = sub.peak
from (
  select channel_id, max(running_sum) as peak
  from (
    select channel_id, sum(amount) over (partition by channel_id order by id) as running_sum
    from public.points_ledger
  ) t
  group by channel_id
) sub
where u.channel_id = sub.channel_id;

-- points_ledger에 행이 추가될 때마다(적립이든 차감이든, 어느 함수가 넣었든 상관없이) 그 유저의
-- 현재 잔액을 다시 계산해서 max_balance_reached보다 크면 갱신한다. 이렇게 트리거로 처리해두면
-- 나중에 포인트를 주는 경로(채팅/후원 등)가 늘어나도 그쪽 코드를 따로 안 건드려도 된다.
create or replace function public.sync_max_balance_reached() returns trigger as $$
declare
  current_balance bigint;
begin
  select coalesce(sum(amount), 0) into current_balance
  from public.points_ledger
  where channel_id = new.channel_id;

  update public.users
  set max_balance_reached = greatest(max_balance_reached, current_balance)
  where channel_id = new.channel_id;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists points_ledger_sync_max_balance on public.points_ledger;
create trigger points_ledger_sync_max_balance
after insert on public.points_ledger
for each row execute function public.sync_max_balance_reached();

-- 랭킹에 장착 칭호 이름을 같이 보여주기 위해 view 갱신. 기존 컬럼 구성(0008_ranking_tiebreak_join_order.sql
-- 기준: channel_id, channel_name, total_points, is_public)은 그대로 유지하고 title_name만 추가.
create or replace view public.ranking as
select
  u.channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  coalesce(sum(pl.amount), 0) as total_points,
  u.is_public,
  t.name as title_name
from users u
left join points_ledger pl on pl.channel_id = u.channel_id
left join titles t on t.id = u.selected_title_id
where u.banned = false
group by u.channel_id, u.channel_name, u.is_public, u.created_at, t.name
order by total_points desc, u.created_at asc;

grant select on public.ranking to anon, authenticated;
