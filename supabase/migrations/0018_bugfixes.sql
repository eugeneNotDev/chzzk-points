-- 이번 점검에서 발견한 버그/개선점 3개 모음.

-- (1) 오버레이가 아이템 "이름" 대신 내부 슬러그(item_id)를 그대로 보여주던 문제.
-- channel_name처럼 spend_events에 item_name 스냅샷을 추가해서 spend-points가 지급 시점의
-- 상품명을 같이 기록하게 함 — 나중에 shop_items.name이 바뀌어도 과거 기록은 그대로 남음
-- (channel_name과 같은 이유, 0011_spend_events_channel_name.sql 참고).
alter table public.spend_events add column if not exists item_name text;

-- 기존 행 백필 — 지금 남아있는 테스트 데이터 몇 건 정도라 shop_items 현재 이름으로 채워도 무방.
update public.spend_events se
set item_name = si.name
from public.shop_items si
where se.item_id = si.id
  and se.item_name is null;

-- (2) sync_max_balance_reached() 트리거 함수가 SECURITY DEFINER라서 PostgREST가 자동으로
-- /rest/v1/rpc/sync_max_balance_reached 엔드포인트로 노출해버림 — anon/authenticated 누구나
-- 직접 호출 가능한 상태였음(Supabase 보안 점검에서 WARN). 트리거 안에서만 쓰는 new 레코드를
-- 참조하는 함수라 직접 호출하면 에러로 끝나긴 하지만, 트리거 실행 자체엔 이 권한이 필요 없으니
-- (트리거는 테이블 소유자 권한으로 도니까) 그냥 막아둠.
revoke execute on function public.sync_max_balance_reached() from public, anon, authenticated;

-- (3) 랭킹 뷰가 users.selected_title_id로 titles와 join하는데 이 컬럼(FK)에 인덱스가 없어서
-- 성능 점검에서 걸림 — 지금 유저 수에선 체감 차이 없지만 미리 걸어둠.
create index if not exists users_selected_title_id_idx on public.users(selected_title_id);
