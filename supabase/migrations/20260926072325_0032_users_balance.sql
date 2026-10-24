-- 유저 잔액을 users.balance 컬럼에 저장해둠.
--
-- 전에는 잔액을 따로 저장하지 않고 매번 points_ledger 합계로 계산했는데, 문제가 두 가지 있었음:
--   1) Edge Function이 한 사람의 기록을 전부 불러와서 JS로 더했는데, Supabase API는 한 번에
--      최대 1000행만 돌려줌 — 기록이 1000건을 넘는 유저는 잔액이 실제보다 적게 계산됨.
--   2) "잔액 확인 → 차감 기록 추가"가 두 단계라 같은 유저가 아주 빠르게 연타하면 둘 다 통과할 틈이 있었음.
-- 그리고 Supabase 테이블 화면에서 잔액이 바로 안 보여서 관리하기 불편했음.
--
-- 구조:
--   - points_ledger는 그대로 "모든 포인트 변동 기록"이고, 잔액의 근거임(지우거나 고치지 않음).
--   - users.balance는 그 합계를 들고 있는 칸. points_ledger에 행이 추가/수정/삭제될 때마다
--     트리거가 자동으로 맞춰줌 — 포인트를 주는 경로(출석/상점/투표/관리자/채팅 리스너 등)가
--     어디든 코드 수정 없이 항상 맞음.
--   - users.balance를 직접 UPDATE하는 건 막아둠(기록과 어긋나니까). 포인트 조정은 관리자
--     페이지(= points_ledger에 기록 추가)로만 함.
--   - 유저가 포인트를 "쓰는" 경로(상점 구매, 투표 베팅)는 debit_points() 함수로 잔액 확인과
--     차감을 한 번에 처리함(행 잠금) — 연타해도 잔액 이상은 절대 못 씀. 관리자 차감/실행취소/
--     밴 초기화는 이 제한 없이 그냥 기록을 추가함(관리자 판단으로 음수가 될 수도 있어야 해서).

alter table public.users add column if not exists balance bigint not null default 0;

-- points_ledger 변동 → users.balance 반영. 트랜잭션 로컬 플래그(chzzk.balance_sync)를 켠 상태에서만
-- users.balance를 바꿀 수 있게 아래 가드 트리거가 막고 있음.
create or replace function public.apply_points_ledger_to_balance() returns trigger as $$
begin
  perform set_config('chzzk.balance_sync', 'on', true);
  if tg_op = 'INSERT' then
    update public.users set balance = balance + new.amount where channel_id = new.channel_id;
  elsif tg_op = 'DELETE' then
    update public.users set balance = balance - old.amount where channel_id = old.channel_id;
  elsif tg_op = 'UPDATE' then
    update public.users set balance = balance - old.amount where channel_id = old.channel_id;
    update public.users set balance = balance + new.amount where channel_id = new.channel_id;
  end if;
  perform set_config('chzzk.balance_sync', 'off', true);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

-- 트리거를 백필보다 먼저 만듦 — create trigger가 points_ledger에 잠금을 걸어서, 이 마이그레이션이
-- 끝날 때까지 다른 곳에서 들어오는 포인트 기록이 대기함(백필과 트리거 사이에 기록이 새는 일 없음).
-- 이름이 points_ledger_sync_max_balance보다 알파벳순으로 앞이라 먼저 실행됨(같은 시점 트리거는 이름순).
drop trigger if exists points_ledger_apply_balance on public.points_ledger;
create trigger points_ledger_apply_balance
after insert or delete or update of amount, channel_id on public.points_ledger
for each row execute function public.apply_points_ledger_to_balance();

-- 지금까지의 기록으로 잔액 채워넣기.
select set_config('chzzk.balance_sync', 'on', true);
update public.users u
set balance = coalesce((select sum(pl.amount) from public.points_ledger pl where pl.channel_id = u.channel_id), 0);
select set_config('chzzk.balance_sync', 'off', true);

-- users.balance 직접 수정 금지.
create or replace function public.guard_users_balance() returns trigger as $$
begin
  if new.balance is distinct from old.balance
     and coalesce(current_setting('chzzk.balance_sync', true), 'off') <> 'on' then
    raise exception 'users.balance는 직접 수정할 수 없음. 포인트 조정은 관리자 페이지(points_ledger 기록 추가)로 해야 함.';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists users_guard_balance on public.users;
create trigger users_guard_balance
before update of balance on public.users
for each row execute function public.guard_users_balance();

-- 최고 보유 포인트 트리거도 이제 매번 기록 전체를 합산할 필요 없이 users.balance를 씀
-- (위 잔액 트리거가 이름순으로 먼저 돌아서 이 시점엔 이미 갱신돼 있음).
create or replace function public.sync_max_balance_reached() returns trigger as $$
begin
  update public.users
  set max_balance_reached = greatest(max_balance_reached, balance)
  where channel_id = new.channel_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 유저가 포인트를 쓸 때(상점 구매, 투표 베팅) 쓰는 함수. 유저 행을 잠근 채로 잔액을 확인하고
-- 차감 기록을 추가해서, 같은 유저의 동시 요청은 한 줄로 세워짐. 잔액이 모자라면
-- 'insufficient_balance' 예외. 차감 후 잔액을 돌려줌.
create or replace function public.debit_points(p_channel_id text, p_amount bigint, p_reason text)
returns bigint as $$
declare
  current_balance bigint;
  new_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select balance into current_balance from public.users where channel_id = p_channel_id for update;
  if not found then
    raise exception 'user_not_found';
  end if;
  if current_balance < p_amount then
    raise exception 'insufficient_balance';
  end if;

  insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, -p_amount, p_reason);

  select balance into new_balance from public.users where channel_id = p_channel_id;
  return new_balance;
end;
$$ language plpgsql security definer set search_path = public;

-- 관리자 현황 요약의 "전체 발행 포인트"(전 유저 잔액 합계).
create or replace function public.total_points_issued() returns bigint as $$
  select coalesce(sum(balance), 0)::bigint from public.users;
$$ language sql stable security definer set search_path = public;

-- 두 함수는 Edge Function(service_role)만 호출 가능 — anon 키로 브라우저에서 부를 수 없게.
revoke all on function public.debit_points(text, bigint, text) from public, anon, authenticated;
grant execute on function public.debit_points(text, bigint, text) to service_role;
revoke all on function public.total_points_issued() from public, anon, authenticated;
grant execute on function public.total_points_issued() to service_role;
