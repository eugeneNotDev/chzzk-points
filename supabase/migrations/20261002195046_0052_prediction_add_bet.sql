-- 투표 추가 베팅 (0030_predictions.sql 이어서).
-- 이미 건 사람은 처음 건 항목에만 더 걸 수 있음(다른 항목으로 바꾸기 불가). 한 사람당 prediction_bets 행은 그대로
-- 하나라서 amount에 더해 넣고, 정산(admin 함수)은 그 합친 금액 기준으로 그대로 동작함.
-- 베팅 행 갱신 + 포인트 차감을 한 트랜잭션에서 처리(predictions 함수가 이걸 부름) — 연타/동시 요청에도 금액이 안 꼬임.
--
-- 결과 jsonb — 성공 { ok, optionId, amount(합계), added(추가 베팅이었는지), balance }
--   실패 { error }: prediction_not_found / prediction_closed / invalid_option / amount_too_small
--                   / different_option / insufficient_balance / user_not_found
create or replace function public.place_prediction_bet(
  p_prediction_id bigint, p_option_id bigint, p_channel_id text, p_amount integer
)
returns jsonb as $$
declare
  v_prediction public.predictions%rowtype;
  v_label text;
  v_bet public.prediction_bets%rowtype;
  v_balance bigint;
begin
  if p_amount is null or p_amount < 100 then return jsonb_build_object('error', 'amount_too_small'); end if;

  select * into v_prediction from public.predictions where id = p_prediction_id;
  if not found then return jsonb_build_object('error', 'prediction_not_found'); end if;
  if v_prediction.status <> 'open' or v_prediction.closes_at <= now() then
    return jsonb_build_object('error', 'prediction_closed');
  end if;

  select label into v_label from public.prediction_options where id = p_option_id and prediction_id = p_prediction_id;
  if not found then return jsonb_build_object('error', 'invalid_option'); end if;

  -- 잔액 잠금(같은 사람의 동시 요청은 여기서 줄 세워짐).
  select balance into v_balance from public.users where channel_id = p_channel_id and banned = false for update;
  if not found then return jsonb_build_object('error', 'user_not_found'); end if;
  if v_balance < p_amount then return jsonb_build_object('error', 'insufficient_balance'); end if;

  select * into v_bet from public.prediction_bets
  where prediction_id = p_prediction_id and channel_id = p_channel_id for update;

  if found then
    if v_bet.option_id <> p_option_id then return jsonb_build_object('error', 'different_option'); end if;
    update public.prediction_bets set amount = amount + p_amount where id = v_bet.id returning * into v_bet;
    insert into public.points_ledger (channel_id, amount, reason)
    values (p_channel_id, -p_amount, format('투표 추가 베팅: %s - %s', v_prediction.title, v_label));
  else
    insert into public.prediction_bets (prediction_id, option_id, channel_id, amount)
    values (p_prediction_id, p_option_id, p_channel_id, p_amount)
    returning * into v_bet;
    insert into public.points_ledger (channel_id, amount, reason)
    values (p_channel_id, -p_amount, format('투표 베팅: %s - %s', v_prediction.title, v_label));
  end if;

  select balance into v_balance from public.users where channel_id = p_channel_id;
  return jsonb_build_object('ok', true, 'optionId', v_bet.option_id, 'amount', v_bet.amount,
                            'added', v_bet.amount > p_amount, 'balance', v_balance);
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.place_prediction_bet(bigint, bigint, text, integer) from public, anon, authenticated;
grant execute on function public.place_prediction_bet(bigint, bigint, text, integer) to service_role;
