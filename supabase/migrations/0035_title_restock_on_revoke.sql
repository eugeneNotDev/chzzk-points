-- 상점에서 산 칭호를 회수하면(관리자 회수, 밴 초기화 등으로 보유 기록이 지워지면) 한정 수량 상품의
-- 재고가 다시 1개 늘어나게 함.
--
-- 관리자가 그냥 지급한 칭호는 애초에 재고를 안 썼으니 회수해도 재고가 늘면 안 됨 — 그래서 보유 기록에
-- 어떻게 얻었는지(source)를 남김: 'purchase'(상점에서 구매) / 'admin'(관리자 지급).
-- 기본값은 'admin'이고 상점 구매(spend-points 함수)만 'purchase'로 넣음 — 모르는 경로로 들어온
-- 기록이 실수로 재고를 늘리는 일이 없게 보수적으로 잡음.

alter table public.user_purchased_titles
  add column if not exists source text not null default 'admin';

alter table public.user_purchased_titles drop constraint if exists user_purchased_titles_source_check;
alter table public.user_purchased_titles
  add constraint user_purchased_titles_source_check check (source in ('purchase', 'admin'));

-- 기존 기록 채우기: 상점 칭호인데 그 유저가 그 상품을 산 포인트 기록이 있으면 'purchase'.
update public.user_purchased_titles u
set source = 'purchase'
where exists (
  select 1
  from public.shop_items si
  join public.points_ledger l
    on l.channel_id = u.channel_id and l.reason = '포인트 상점 사용: ' || si.name
  where si.grants_title_id = u.title_id
);

-- 보유 기록이 지워질 때 상점 구매분이면 그 칭호를 파는 한정 수량 상품의 판매 개수를 1 줄임(= 재고 +1).
-- 회수(admin 함수 revoke-title), 밴 초기화, 어디서 지워지든 여기서 한 번에 처리됨.
create or replace function public.restock_title_item_on_revoke() returns trigger as $$
begin
  if old.source = 'purchase' then
    update public.shop_items
    set sold_count = greatest(sold_count - 1, 0)
    where grants_title_id = old.title_id
      and stock_limit is not null
      and sold_count > 0;
  end if;
  return old;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.restock_title_item_on_revoke() from public, anon, authenticated;

drop trigger if exists user_purchased_titles_restock on public.user_purchased_titles;
create trigger user_purchased_titles_restock
after delete on public.user_purchased_titles
for each row execute function public.restock_title_item_on_revoke();

-- 이 기능 전에 회수된 칭호 몫도 맞춰줌: 한정 수량 칭호 상품의 판매 개수 = 지금 그 칭호를 산 채로
-- 가지고 있는 사람 수. (예: [감마]를 사고 회수했는데 판매 개수가 1로 남아서 품절로 보이던 것)
update public.shop_items si
set sold_count = (
  select count(*) from public.user_purchased_titles u
  where u.title_id = si.grants_title_id and u.source = 'purchase'
)
where si.grants_title_id is not null
  and si.stock_limit is not null;
