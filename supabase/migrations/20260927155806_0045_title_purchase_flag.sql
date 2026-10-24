-- 상점 내역(관리자 페이지)에서 칭호 상점 구매는 "처리 완료" 체크가 필요 없음 — 칭호는 사는 순간
-- 자동으로 지급돼서(spend-points가 user_purchased_titles에 바로 기록) 방송에서 따로 처리할 게 없음.
-- 그래서 포인트 기록에 "칭호 구매였는지" 표시(title_purchase)를 두고, 관리자 화면은 이 줄엔 체크박스/
-- 처리 버튼 대신 "자동 지급" 표시만 보여줌.
--
-- 기록 문구("포인트 상점 사용: <상품명>")만으로는 칭호 상품인지 알 수 없어서(상품명은 자유 입력),
-- 기록이 들어가는 순간 그 이름의 칭호 상품(shop_items.grants_title_id가 있는 것)이 있으면 표시해 둠.
-- 나중에 상품 이름을 바꾸거나 지워도 이미 남은 표시는 그대로라 과거 기록도 안 흔들림.
alter table public.points_ledger add column if not exists title_purchase boolean not null default false;

-- 기존 기록 채우기 — 지금 있는 칭호 상품 이름과 같은 기록 + 예전 형식("칭호 : [이름]") 기록.
update public.points_ledger pl
set title_purchase = true
where pl.reason like '포인트 상점 사용: %'
  and (
    pl.reason like '포인트 상점 사용: 칭호 : %'
    or exists (
      select 1 from public.shop_items si
      where si.grants_title_id is not null and pl.reason = '포인트 상점 사용: ' || si.name
    )
  );

create or replace function public.points_ledger_mark_title_purchase()
returns trigger as $$
begin
  if new.reason like '포인트 상점 사용: %' and exists (
    select 1 from public.shop_items si
    where si.grants_title_id is not null and new.reason = '포인트 상점 사용: ' || si.name
  ) then
    new.title_purchase := true;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.points_ledger_mark_title_purchase() from public, anon, authenticated;

drop trigger if exists points_ledger_mark_title_purchase on public.points_ledger;
create trigger points_ledger_mark_title_purchase
  before insert on public.points_ledger
  for each row execute function public.points_ledger_mark_title_purchase();
