-- 1) 마이페이지 포인트 내역의 "보유 포인트"(그 내역이 반영된 직후 잔액).
--    users.balance가 points_ledger 합계와 항상 같아서, 시간순(created_at, id) 누적합 = 그 시점 잔액.
create or replace function public.points_balance_after(p_channel text, p_ids bigint[])
returns table (id bigint, balance_after bigint)
language sql stable
set search_path = public
as $$
  select r.id, r.bal
  from (
    select l.id, sum(l.amount) over (order by l.created_at, l.id) as bal
    from points_ledger l
    where l.channel_id = p_channel
  ) r
  where r.id = any(p_ids);
$$;
revoke all on function public.points_balance_after(text, bigint[]) from public, anon, authenticated;

-- 2) 방종곡 신청 리스트(songs 함수 전용 — RLS 켜고 정책 없음 = service_role만).
--    status: pending(대기) / played(틀었음) / cancelled(본인 취소) / deleted(관리자 삭제)
--    하루 1곡(한국시간 날짜 기준) — 취소·삭제돼도 그날 기회는 다시 안 생김.
--    중복: 대기 중인 곡끼리만 비교(norm_key = 제목|가수 소문자·공백 제거). 틀고 나면 다시 신청 가능.
create table if not exists public.song_requests (
  id bigint generated always as identity primary key,
  channel_id text not null references public.users(channel_id) on delete cascade,
  requester_name text,
  title text not null,
  artist text not null,
  norm_key text not null,
  request_day date not null,
  status text not null default 'pending' check (status in ('pending', 'played', 'cancelled', 'deleted')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table public.song_requests enable row level security;

create unique index if not exists song_requests_one_per_day on public.song_requests (channel_id, request_day);
create unique index if not exists song_requests_pending_unique on public.song_requests (norm_key) where status = 'pending';
create index if not exists song_requests_pending_idx on public.song_requests (created_at) where status = 'pending';
create index if not exists song_requests_played_idx on public.song_requests (closed_at desc) where status = 'played';
