-- 미스테리 라디오(현야기담) 베팅 상한: 이야기 한 편당 한 사람 최대 3,000P (여러 번 나눠 걸어도 합계 기준)
alter table public.mystery_sets add column if not exists bet_max integer not null default 3000;

create or replace function public.mystery_place_bet(p_set_id bigint, p_channel_id text, p_amount integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_set public.mystery_sets%rowtype;
  v_balance bigint;
  v_total integer;
  v_prev integer;
begin
  if p_amount is null or p_amount < 100 then return jsonb_build_object('error', 'amount_too_small'); end if;
  select * into v_set from public.mystery_sets where id = p_set_id for update;
  if not found then return jsonb_build_object('error', 'set_not_found'); end if;
  if v_set.status <> 'open' or v_set.bet_closed then return jsonb_build_object('error', 'bet_closed'); end if;

  select coalesce((select amount from public.mystery_bets where set_id = p_set_id and channel_id = p_channel_id), 0) into v_prev;
  if v_prev + p_amount > v_set.bet_max then
    return jsonb_build_object('error', 'bet_limit', 'max', v_set.bet_max, 'remaining', greatest(v_set.bet_max - v_prev, 0));
  end if;

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
$function$;
