-- 보안 점검 후속 정리(비공개 설정 누출 막기 + 권한 정리).
--
-- 1) 랭킹: 비공개 유저의 치지직 채널 ID를 내보내지 않음
--    공개 랭킹(public.ranking)은 이름만 "비공개"로 가리고 channel_id는 그대로 내려줬는데, 채널 ID는
--    chzzk.naver.com/<채널ID>로 들어가면 누군지 바로 보이는 값이라 사실상 비공개가 안 됐음.
--    그래서 유저마다 채널 ID와 상관없는 무작위 값(rank_key)을 하나씩 두고, 비공개 유저 행은 channel_id
--    칸에 그 값을 대신 넣음. 본인 줄 "(나)" 표시는 /me 응답의 rankKey(본인에게만 알려줌)로 맞춤.
--    공개 유저는 전처럼 진짜 channel_id 그대로.
alter table public.users add column if not exists rank_key uuid not null default gen_random_uuid();
create unique index if not exists users_rank_key_idx on public.users (rank_key);

create or replace view public.ranking as
select
  case when u.is_public then u.channel_id else u.rank_key::text end as channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  u.balance as total_points,
  u.is_public,
  case when u.is_public then tier.name end as tier_title_name,
  case when u.is_public then tier.color end as tier_title_color,
  case when u.is_public then shop.name end as shop_title_name,
  case when u.is_public then shop.color end as shop_title_color
from public.users u
left join lateral (
  select t.name, t.color from public.titles t
  where t.kind = 'tier' and t.min_points <= u.max_balance_reached
  order by t.min_points desc limit 1
) tier on true
left join public.titles shop on shop.id = u.selected_title_id
where u.banned = false
  and u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f' -- OWNER_CHANNEL_ID (config.ts), 관리자 계정 제외 (0017 참고)
order by u.balance desc, u.created_at asc;

-- 2) 오버레이: 상점 사용 기록(spend_events)을 더 이상 공개하지 않음
--    spend_events는 비공개 유저도 실제 이름·채널 ID가 저장되는데 누구나 읽고 실시간 구독할 수 있었음
--    (오버레이 화면에서만 "익명"으로 바꿔 보여줬을 뿐). 이제 spend_events는 서버 전용으로 닫고,
--    오버레이가 보는 건 표시용 이름만 담은 overlay_events로 따로 둠 — spend_events에 한 줄 들어갈 때
--    트리거가 자동으로 만듦(비공개 유저면 display_name이 null → 오버레이가 "익명"으로 표시).
--    오버레이는 방금 들어온 알림만 띄우면 돼서, 하루 지난 줄은 새 줄이 들어올 때 같이 지움.
create table if not exists public.overlay_events (
  id bigint generated always as identity primary key,
  display_name text,
  item_name text not null,
  created_at timestamptz not null default now()
);
alter table public.overlay_events enable row level security;
drop policy if exists "overlay_events_public_read" on public.overlay_events;
create policy "overlay_events_public_read" on public.overlay_events for select using (true);
grant select on public.overlay_events to anon, authenticated;
alter publication supabase_realtime add table public.overlay_events;

create or replace function public.spend_events_to_overlay()
returns trigger as $$
begin
  insert into public.overlay_events (display_name, item_name)
  values (case when new.is_public then new.channel_name end, coalesce(new.item_name, new.item_id));
  delete from public.overlay_events where created_at < now() - interval '1 day';
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists spend_events_to_overlay on public.spend_events;
create trigger spend_events_to_overlay
  after insert on public.spend_events
  for each row execute function public.spend_events_to_overlay();

drop policy if exists "spend_events_public_read" on public.spend_events;
alter publication supabase_realtime drop table public.spend_events;

-- 3) 권한 정리 — 브라우저(anon/authenticated)는 "공개 정책이 있는 것 읽기"만 할 수 있게
--    지금도 테이블마다 걸린 RLS가 쓰기를 막고 있어서 뚫린 건 아니지만, 권한 자체를 회수해서 두 겹으로 막음.
--    실제 쓰기는 전부 Edge Function(service_role)이 하므로 영향 없음.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- 공개 읽기 정책이 없는(서버 전용) 테이블은 읽기 권한도 회수
revoke select on
  public.attendance, public.odd_even_games, public.points_ledger, public.prediction_bets,
  public.roulette_outcomes, public.roulette_spins, public.rps_games, public.user_purchased_titles,
  public.spend_events
from anon, authenticated;
-- 트리거 전용 함수는 외부(/rest/v1/rpc)에서 부를 일이 없음(트리거 동작에는 실행 권한이 필요 없음)
revoke execute on function public.apply_points_ledger_to_balance() from public, anon, authenticated;
revoke execute on function public.guard_users_balance() from public, anon, authenticated;
revoke execute on function public.spend_events_to_overlay() from public, anon, authenticated;

-- 앞으로 새로 만드는 테이블/시퀀스/함수도 기본으로는 브라우저에 쓰기·실행 권한을 안 줌
-- (읽기가 필요한 공개 테이블은 지금처럼 RLS 정책으로 열고, 함수는 service_role에만 grant).
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
