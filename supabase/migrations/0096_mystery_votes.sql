-- 미스테리 라디오 연속 투표 — 이야기 한 편(set)에 투표 여러 개(보통 3개: 예측 ① ② + 최종 진실/거짓)를 이어서 열고,
-- 몇 개 맞혔는지로 보상을 줌.
--   · 무료 참여: 맞힌 개수별 기본 보상(base_rewards, 0개부터 — 기본 0/100/150/300P)
--   · 선택 베팅: 이야기마다 한 번(같은 이야기엔 추가로 더 걸 수 있음) 걸고, 맞힌 개수별 배수(bet_multipliers, 기본 0/0.5/1.5/3배)로 돌려받음
--     베팅은 첫 번째 투표가 마감되기 전까지만(bet_closed).
--   · 진행(열기·마감·정답 공개·지급·취소)은 미스테리 리모컨(로컬 파일)이 mystery-remote 함수로 함.
--   · 테스트 회차(is_test): 베팅해도 포인트가 안 빠지고, 지급해도 실제 포인트는 안 들어가고 내역만 기록.
-- 상태: ready(리모컨이 대본을 불러와 만들어 둠, 시청자에겐 안 보임) → open(첫 투표를 열면) → revealed(정답 공개)
--       → paid(지급 완료) / cancelled(취소 — 베팅 환불)

create table if not exists public.mystery_sets (
  id bigint generated always as identity primary key,
  client_key text not null unique,           -- 리모컨이 붙이는 식별자(대본 파일 + 테스트 여부) — 같은 대본을 다시 불러와도 같은 회차
  title text not null,
  status text not null default 'ready' check (status in ('ready', 'open', 'revealed', 'paid', 'cancelled')),
  is_test boolean not null default false,
  bet_closed boolean not null default false,
  base_rewards integer[] not null default '{0,100,150,300}',
  bet_multipliers numeric[] not null default '{0,0.5,1.5,3}',
  pay_log jsonb,
  opened_at timestamptz,
  revealed_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mystery_questions (
  id bigint generated always as identity primary key,
  set_id bigint not null references public.mystery_sets(id) on delete cascade,
  position integer not null,
  prompt text not null,
  options text[] not null,
  answer integer not null,                   -- options 안의 순서(0부터). 시청자에겐 정답 공개 전까지 절대 안 내려줌
  status text not null default 'pending' check (status in ('pending', 'open', 'closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  unique (set_id, position),
  check (answer >= 0 and answer < cardinality(options))
);

create table if not exists public.mystery_votes (
  question_id bigint not null references public.mystery_questions(id) on delete cascade,
  channel_id text not null references public.users(channel_id) on delete cascade,
  choice integer not null,
  created_at timestamptz not null default now(),
  primary key (question_id, channel_id)
);

create table if not exists public.mystery_bets (
  set_id bigint not null references public.mystery_sets(id) on delete cascade,
  channel_id text not null references public.users(channel_id) on delete cascade,
  amount integer not null check (amount > 0),
  payout integer,
  created_at timestamptz not null default now(),
  primary key (set_id, channel_id)
);

-- 개별 투표·베팅은 함수(service_role) 밖에서 아무도 못 봄
alter table public.mystery_sets enable row level security;
alter table public.mystery_questions enable row level security;
alter table public.mystery_votes enable row level security;
alter table public.mystery_bets enable row level security;
revoke all on public.mystery_sets, public.mystery_questions, public.mystery_votes, public.mystery_bets from anon, authenticated;

-- 실시간 신호(quiz_pings와 같은 방식 — 내용 없이 종류만)
--   kind = 'state' : 회차·문항이 바뀜(열기/마감/공개/지급) · kind = 'vote' : 투표·베팅이 들어옴
create table if not exists public.mystery_pings (
  id bigint generated always as identity primary key,
  set_id bigint,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table public.mystery_pings enable row level security;
create policy mystery_pings_public_read on public.mystery_pings for select to anon, authenticated using (true);
revoke insert, update, delete on public.mystery_pings from anon, authenticated;

create or replace function public.ping_mystery_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set bigint;
  v_id bigint;
begin
  if tg_table_name = 'mystery_sets' then
    v_set := coalesce(new.id, old.id);
  elsif tg_table_name = 'mystery_votes' then
    select set_id into v_set from public.mystery_questions where id = coalesce(new.question_id, old.question_id);
  else
    v_set := coalesce(new.set_id, old.set_id);
  end if;
  insert into public.mystery_pings (set_id, kind) values (v_set, tg_argv[0]) returning id into v_id;
  if v_id % 200 = 0 then
    delete from public.mystery_pings where created_at < now() - interval '1 day';
  end if;
  return null;
end;
$$;
revoke all on function public.ping_mystery_change() from public, anon, authenticated;

create trigger mystery_sets_ping after insert or update or delete on public.mystery_sets
  for each row execute function public.ping_mystery_change('state');
create trigger mystery_questions_ping after insert or update or delete on public.mystery_questions
  for each row execute function public.ping_mystery_change('state');
create trigger mystery_votes_ping after insert or update on public.mystery_votes
  for each row execute function public.ping_mystery_change('vote');
create trigger mystery_bets_ping after insert or update on public.mystery_bets
  for each row execute function public.ping_mystery_change('vote');

alter publication supabase_realtime add table public.mystery_pings;

-- 투표(한 사람 한 표, 그 투표가 마감되기 전까지는 바꿀 수 있음). 포인트가 마이너스인 사람도 참여 가능.
create or replace function public.mystery_cast_vote(p_question_id bigint, p_channel_id text, p_choice integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.mystery_questions%rowtype;
  v_set_status text;
begin
  select * into v_q from public.mystery_questions where id = p_question_id;
  if not found then return jsonb_build_object('error', 'question_not_found'); end if;
  select status into v_set_status from public.mystery_sets where id = v_q.set_id;
  if v_set_status <> 'open' or v_q.status <> 'open' then return jsonb_build_object('error', 'vote_closed'); end if;
  if p_choice is null or p_choice < 0 or p_choice >= cardinality(v_q.options) then return jsonb_build_object('error', 'invalid_choice'); end if;
  perform 1 from public.users where channel_id = p_channel_id and banned = false;
  if not found then return jsonb_build_object('error', 'user_not_found'); end if;

  insert into public.mystery_votes (question_id, channel_id, choice) values (p_question_id, p_channel_id, p_choice)
  on conflict (question_id, channel_id) do update set choice = excluded.choice, created_at = now();
  return jsonb_build_object('ok', true, 'choice', p_choice);
end;
$$;

-- 베팅(이야기마다 한 번, 같은 이야기엔 더 걸 수 있음). 첫 투표 마감 전까지만. 테스트 회차는 포인트가 안 빠짐.
create or replace function public.mystery_place_bet(p_set_id bigint, p_channel_id text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.mystery_sets%rowtype;
  v_balance bigint;
  v_total integer;
begin
  if p_amount is null or p_amount < 100 then return jsonb_build_object('error', 'amount_too_small'); end if;
  select * into v_set from public.mystery_sets where id = p_set_id for update;
  if not found then return jsonb_build_object('error', 'set_not_found'); end if;
  if v_set.status <> 'open' or v_set.bet_closed then return jsonb_build_object('error', 'bet_closed'); end if;

  select balance into v_balance from public.users where channel_id = p_channel_id and banned = false for update;
  if not found then return jsonb_build_object('error', 'user_not_found'); end if;
  if v_balance < p_amount then return jsonb_build_object('error', 'insufficient_balance'); end if;

  insert into public.mystery_bets (set_id, channel_id, amount) values (p_set_id, p_channel_id, p_amount)
  on conflict (set_id, channel_id) do update set amount = public.mystery_bets.amount + excluded.amount
  returning amount into v_total;

  if not v_set.is_test then
    insert into public.points_ledger (channel_id, amount, reason)
    values (p_channel_id, -p_amount, format('미스테리 라디오 베팅: %s', v_set.title));
  end if;

  select balance into v_balance from public.users where channel_id = p_channel_id;
  return jsonb_build_object('ok', true, 'amount', v_total, 'balance', v_balance, 'test', v_set.is_test);
end;
$$;

-- 지급: 참여자(한 표라도 던졌거나 베팅한 사람)마다 맞힌 개수를 세서 기본 보상 + 베팅 배수 지급.
create or replace function public.mystery_pay(p_set_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.mystery_sets%rowtype;
  v_n integer;
  r record;
  v_base integer;
  v_bet_pay integer;
  v_log jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_total bigint := 0;
begin
  select * into v_set from public.mystery_sets where id = p_set_id for update;
  if not found then return jsonb_build_object('error', 'set_not_found'); end if;
  if v_set.status = 'paid' then return jsonb_build_object('error', 'already_paid'); end if;
  if v_set.status <> 'revealed' then return jsonb_build_object('error', 'not_revealed'); end if;

  select count(*) into v_n from public.mystery_questions where set_id = p_set_id;
  if cardinality(v_set.base_rewards) <> v_n + 1 or cardinality(v_set.bet_multipliers) <> v_n + 1 then
    return jsonb_build_object('error', 'reward_table_mismatch');
  end if;

  for r in
    with people as (
      select v.channel_id from public.mystery_votes v join public.mystery_questions q on q.id = v.question_id where q.set_id = p_set_id
      union
      select b.channel_id from public.mystery_bets b where b.set_id = p_set_id
    )
    select p.channel_id,
           (select count(*) from public.mystery_votes v join public.mystery_questions q on q.id = v.question_id
             where q.set_id = p_set_id and v.channel_id = p.channel_id and v.choice = q.answer)::integer as correct,
           (select amount from public.mystery_bets b where b.set_id = p_set_id and b.channel_id = p.channel_id) as bet
    from people p
  loop
    v_base := v_set.base_rewards[r.correct + 1];
    v_bet_pay := case when r.bet is null then null else floor(r.bet * v_set.bet_multipliers[r.correct + 1])::integer end;

    if not v_set.is_test then
      if v_base > 0 then
        insert into public.points_ledger (channel_id, amount, reason)
        values (r.channel_id, v_base, format('미스테리 라디오 보상: %s (%s개 적중)', v_set.title, r.correct));
      end if;
      if coalesce(v_bet_pay, 0) > 0 then
        insert into public.points_ledger (channel_id, amount, reason)
        values (r.channel_id, v_bet_pay, format('미스테리 라디오 베팅 정산: %s (%s개 적중)', v_set.title, r.correct));
      end if;
    end if;
    if r.bet is not null then
      update public.mystery_bets set payout = v_bet_pay where set_id = p_set_id and channel_id = r.channel_id;
    end if;

    v_log := v_log || jsonb_build_object('channelId', r.channel_id, 'correct', r.correct, 'base', v_base, 'bet', r.bet, 'betPayout', v_bet_pay);
    v_count := v_count + 1;
    v_total := v_total + v_base + coalesce(v_bet_pay, 0);
  end loop;

  update public.mystery_sets set status = 'paid', paid_at = now(), pay_log = v_log where id = p_set_id;
  return jsonb_build_object('ok', true, 'test', v_set.is_test, 'count', v_count, 'total', v_total);
end;
$$;

-- 취소: 베팅 환불(테스트 회차는 애초에 안 빠졌으니 환불도 없음). 지급 끝난 회차는 취소 불가.
create or replace function public.mystery_cancel(p_set_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.mystery_sets%rowtype;
  r record;
  v_count integer := 0;
begin
  select * into v_set from public.mystery_sets where id = p_set_id for update;
  if not found then return jsonb_build_object('error', 'set_not_found'); end if;
  if v_set.status in ('paid', 'cancelled') then return jsonb_build_object('error', 'not_cancellable'); end if;
  if not v_set.is_test then
    for r in select channel_id, amount from public.mystery_bets where set_id = p_set_id loop
      insert into public.points_ledger (channel_id, amount, reason)
      values (r.channel_id, r.amount, format('미스테리 라디오 베팅 환불: %s', v_set.title));
      v_count := v_count + 1;
    end loop;
  end if;
  update public.mystery_questions set status = 'closed', closed_at = coalesce(closed_at, now()) where set_id = p_set_id and status <> 'closed';
  update public.mystery_sets set status = 'cancelled', cancelled_at = now() where id = p_set_id;
  return jsonb_build_object('ok', true, 'refunded', v_count);
end;
$$;

-- 리모컨 키(로컬 리모컨·방송화면 파일에 넣어 쓰는 관리자 키) — 원문은 저장 안 하고 sha256 해시만.
-- 키 발급/교체는 SQL로 직접(이 파일엔 키를 안 적음).
create table if not exists public.mystery_remote_keys (
  key_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.mystery_remote_keys enable row level security;
revoke all on public.mystery_remote_keys from anon, authenticated;

revoke all on function public.mystery_cast_vote(bigint, text, integer) from public, anon, authenticated;
revoke all on function public.mystery_place_bet(bigint, text, integer) from public, anon, authenticated;
revoke all on function public.mystery_pay(bigint) from public, anon, authenticated;
revoke all on function public.mystery_cancel(bigint) from public, anon, authenticated;
grant execute on function public.mystery_cast_vote(bigint, text, integer) to service_role;
grant execute on function public.mystery_place_bet(bigint, text, integer) to service_role;
grant execute on function public.mystery_pay(bigint) to service_role;
grant execute on function public.mystery_cancel(bigint) to service_role;
