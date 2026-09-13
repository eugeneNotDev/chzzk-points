-- 초기 스키마. channelId(치지직 채널 ID)를 유저 식별자로 사용한다.

create table if not exists users (
  channel_id text primary key,
  channel_name text,
  is_public boolean not null default false,   -- 마이페이지 공개 설정
  created_at timestamptz not null default now()
);

create table if not exists points_ledger (
  id bigint generated always as identity primary key,
  channel_id text not null references users(channel_id),
  amount integer not null,                     -- 양수: 적립, 음수: 소모
  reason text not null,                        -- 'chat' | 'attendance' | 'donation' | 'spend:<소모처id>'
  created_at timestamptz not null default now()
);

create table if not exists spend_events (
  id bigint generated always as identity primary key,
  channel_id text not null references users(channel_id),
  item_id text not null,                       -- 소모처 id
  created_at timestamptz not null default now()
);

-- RLS(Row Level Security)
-- 이 프로젝트는 Supabase Auth를 쓰지 않고 자체 세션(치지직 OAuth)을 쓰기 때문에,
-- "본인 행만" 같은 정책을 anon 키로는 검증할 방법이 없다.
-- 그래서 원칙을 이렇게 잡는다:
--   - 프론트엔드(anon key, 브라우저)는 "공개해도 되는 것만" 읽을 수 있다 (아래 select 정책).
--   - 쓰기(insert/update/delete)는 전부 막는다 — anon용 정책을 아예 만들지 않음.
--     실제 쓰기는 Edge Function이 service_role 키로 수행하고, service_role은 RLS를 우회한다.
--   - points_ledger는 원장 원본이라 아직 공개 정책 없음 (익명 조회 불가).
--     랭킹은 나중에 집계용 view를 따로 만들어서, 그 view에만 읽기 정책을 연다.

alter table users enable row level security;
alter table points_ledger enable row level security;
alter table spend_events enable row level security;

-- users: is_public = true로 설정한 사람만 마이페이지 공개 정보 노출
create policy "users_public_read" on users
  for select
  using (is_public = true);

-- spend_events: 오버레이(OBS)가 Realtime으로 구독해야 하므로 전체 공개 읽기
create policy "spend_events_public_read" on spend_events
  for select
  using (true);

-- points_ledger: 정책 없음 = anon/authenticated 모두 읽기/쓰기 불가 (service_role만 접근)
