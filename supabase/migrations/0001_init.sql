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

-- TODO: RLS(Row Level Security) 정책 추가
--   - users: 본인 행만 수정 가능, is_public=true인 행은 누구나 읽기 가능
--   - points_ledger: 본인 합계만 조회 가능하도록 view 분리 고려
--   - spend_events: 누구나 읽기 가능(오버레이가 구독), 쓰기는 Edge Function(service_role)만
