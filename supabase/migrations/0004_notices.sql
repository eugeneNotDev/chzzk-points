-- 공지사항 (스케줄/방송 일정 등). 채널 주인만 쓸 수 있고, 읽기는 전체 공개.
-- 쓰기 권한 체크는 RLS로 못 함 (Supabase Auth를 안 써서 anon 요청은 전부 같은 role이라
-- "이 요청이 채널 주인인지" 구분이 안 됨) — 그래서 insert 정책은 아예 안 만들고,
-- supabase/functions/notices에서 세션 토큰의 channelId를 직접 확인한 뒤 service_role로 씀.

create table if not exists notices (
  id bigint generated always as identity primary key,
  content text not null,
  created_at timestamptz not null default now()
);

alter table notices enable row level security;

create policy "notices_public_read" on notices
  for select
  using (true);

-- insert/update/delete: 정책 없음 = anon/authenticated 전부 불가, service_role(Edge Function)만 가능
