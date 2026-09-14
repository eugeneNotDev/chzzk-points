-- (1) 랭킹에서 관리자(채널 주인) 계정 제외.
--
-- "유진 알파" 계정은 _shared/config.ts의 OWNER_CHANNEL_ID와 동일한 관리자 전용 계정이라
-- 랭킹에 같이 뜨면 이상하다 — 관리자가 스스로에게 포인트를 지급/차감하며 테스트하는 계정이
-- 시청자 랭킹에 섞여 나오는 걸 막는다. SQL view라 TS 상수를 직접 참조할 수 없어서 리터럴로
-- 하드코딩한다 — 나중에 OWNER_CHANNEL_ID가 바뀌면 (그럴 일은 거의 없지만) 여기도 같이 고칠 것.
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
  and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts), 관리자 계정 제외
group by u.channel_id, u.channel_name, u.is_public, u.created_at, t.name
order by total_points desc, u.created_at asc;

grant select on public.ranking to anon, authenticated;

-- (2) 임시 상점 상품 6개 채워넣기.
--
-- 이름/가격/설명 전부 임시값 — 나중에 실제 상품으로 교체할 때 코드/배포 없이 Table Editor에서
-- 행만 고치면 된다 (0010_shop_items.sql과 같은 이유). 기존 'water'(sort_order=1) 다음
-- 순서로 채워넣는다.
insert into public.shop_items (id, name, cost, description, requires_live, is_active, sort_order)
values
  ('temp1', '상품1', 200, '임시 상품이에요. 나중에 실제 상품으로 교체될 예정이에요.', false, true, 2),
  ('temp2', '상품2', 500, '임시 상품이에요. 나중에 실제 상품으로 교체될 예정이에요.', false, true, 3),
  ('temp3', '상품3', 1000, '임시 상품이에요. 나중에 실제 상품으로 교체될 예정이에요.', false, true, 4),
  ('temp4', '상품4', 2000, '임시 상품이에요. 나중에 실제 상품으로 교체될 예정이에요.', false, true, 5),
  ('temp5', '상품5', 5000, '임시 상품이에요. 나중에 실제 상품으로 교체될 예정이에요.', false, true, 6),
  ('temp6', '상품6', 10000, '임시 상품이에요. 나중에 실제 상품으로 교체될 예정이에요.', false, true, 7)
on conflict (id) do nothing;
