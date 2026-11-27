-- 방종곡 신청 받기/안 받기(주인이 신청 페이지에서 켜고 끔). 한 줄짜리 설정, songs 함수(service_role)만 읽고 씀.
create table if not exists public.song_settings (
  id boolean primary key default true check (id),
  is_open boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.song_settings (id) values (true) on conflict do nothing;
alter table public.song_settings enable row level security;
revoke all on public.song_settings from anon, authenticated;
