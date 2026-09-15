-- 출석체크 기능. 하루에 한 번, 방송 중일 때만 체크할 수 있고 체크당 10포인트를 줌
-- (실제 방송 여부 확인 + 포인트 지급 로직은 supabase/functions/attendance-check).
--
-- unique (channel_id, attended_on)는 "오늘 이미 체크했는지"를 동시성까지 안전하게 걸러주는
-- 관문 역할 — attendance-check 함수가 이 제약을 이용해 중복 클릭/동시 요청에도 포인트가
-- 두 번 지급되지 않게 함.
create table if not exists public.attendance (
  id bigint generated always as identity primary key,
  channel_id text not null references public.users(channel_id) on delete cascade,
  attended_on date not null,
  created_at timestamptz not null default now(),
  unique (channel_id, attended_on)
);

-- points_ledger/spend_events와 같은 패턴: RLS는 켜두되 별도 정책은 만들지 않음
-- (anon/authenticated는 접근 불가, service_role만 — Edge Function이 service_role로 씀).
alter table public.attendance enable row level security;
