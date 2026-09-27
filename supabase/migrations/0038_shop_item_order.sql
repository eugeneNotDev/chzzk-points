-- 상점 상품 순서를 관리자가 직접 정할 수 있게 함(상점 페이지의 "순서 변경" 드래그).
--
-- 정렬 기준: sort_order 오름차순 → 같으면 등록 순서(created_at, id).
-- 지금까지는 sort_order를 안 쓰고 등록 순서로만 보여줬으니, 처음엔 그 순서 그대로 번호를 매겨서
-- 적용하자마자 순서가 바뀌는 일이 없게 함. 새로 추가하는 상품은 shop-items 함수가 맨 뒤 번호를 줌.

update public.shop_items s
set sort_order = r.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.shop_items
) r
where s.id = r.id;

-- 한 탭(일반 상품 또는 칭호 상품)의 순서를 한 번에 저장. p_ids는 그 탭의 상품 id 전부를 원하는 순서대로
-- (판매 중인 것 + 판매 중지된 것 모두). 일부만 오거나 다른 탭 상품이 섞이면 거부 — 그 사이 상품이
-- 추가/삭제됐다면 화면을 새로고침해서 다시 하게 함(stale_order).
-- 번호는 그 탭 안에서 1, 2, 3...으로 새로 매김(두 탭은 따로 보여주니 번호가 겹쳐도 상관없음).
create or replace function public.reorder_shop_items(p_ids text[])
returns void as $$
declare
  v_len int := coalesce(array_length(p_ids, 1), 0);
  v_found int;
  v_title_kinds int;
  v_is_title boolean;
  v_tab_total int;
begin
  if v_len = 0 then raise exception 'invalid_order'; end if;
  if (select count(distinct x) from unnest(p_ids) x) <> v_len then raise exception 'invalid_order'; end if;

  select count(*), count(distinct (grants_title_id is not null)), bool_or(grants_title_id is not null)
  into v_found, v_title_kinds, v_is_title
  from public.shop_items where id = any(p_ids);
  if v_found <> v_len or v_title_kinds <> 1 then raise exception 'invalid_order'; end if;

  select count(*) into v_tab_total
  from public.shop_items where (grants_title_id is not null) = v_is_title;
  if v_tab_total <> v_len then raise exception 'stale_order'; end if;

  update public.shop_items s
  set sort_order = t.pos
  from unnest(p_ids) with ordinality as t(id, pos)
  where s.id = t.id;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.reorder_shop_items(text[]) from public, anon, authenticated;
grant execute on function public.reorder_shop_items(text[]) to service_role;
