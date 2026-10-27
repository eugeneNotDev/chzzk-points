-- 0102 — 이스터에그 삭제 (1/2)
-- 홀짝 쪽지(minigame_note)·방송 코드 문서(stream_code_doc)·진행 기록(egg_progress)을 전부 없앰.
-- 이번 단계는 지금 배포된 함수가 깨지지 않는 것만:
--   홀짝 함수에서 쪽지 부분 빼기, 문서 함수는 항상 null(빈 껍데기), 쪽지·진행 표시 함수 삭제, 관련 비밀값·진행 기록 삭제.
-- 테이블(egg_progress)과 빈 껍데기 함수는 새 함수 배포 뒤 0103에서 지움.

create or replace function public.odd_even_play(p_channel_id text, p_bet bigint, p_pick text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance bigint;
  v_max bigint;
  v_banned boolean;
  v_required bigint;
  v_last timestamptz;
  v_card int;
  v_result text;
  v_payout bigint;
  v_net bigint;
begin
  -- 상한 4억은 포인트 기록 칸(integer) 범위를 넘지 않게 하려는 기술적 한계일 뿐(실제로 닿을 일 없음).
  if p_bet is null or p_bet < 100 or p_bet > 400000000 then
    raise exception 'invalid_bet';
  end if;
  if p_pick is null or p_pick not in ('odd', 'even') then
    raise exception 'invalid_pick';
  end if;

  select balance, max_balance_reached, banned into v_balance, v_max, v_banned
  from public.users where channel_id = p_channel_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if v_banned then raise exception 'banned'; end if;

  select coalesce(min(min_points), 0) into v_required from public.titles where kind = 'tier';
  if v_max < v_required then raise exception 'tier_required'; end if;

  select created_at into v_last from public.odd_even_games
  where channel_id = p_channel_id order by created_at desc limit 1;
  if v_last is not null and v_last > now() - interval '3 seconds' then
    raise exception 'cooldown:%', greatest(1, ceil(extract(epoch from (v_last + interval '3 seconds' - now())))::int);
  end if;

  if v_balance < p_bet then raise exception 'insufficient_balance'; end if;

  v_card := 1 + floor(random() * 10)::int;

  if (v_card % 2 = 1) = (p_pick = 'odd') then
    v_result := 'win';
    v_payout := floor(p_bet * 1.9)::bigint; -- ODD_EVEN_WIN_MULTIPLIER
  else
    v_result := 'lose';
    v_payout := 0;
  end if;
  v_net := v_payout - p_bet;

  insert into public.points_ledger (channel_id, amount, reason)
  values (
    p_channel_id,
    v_net,
    format('홀짝 %s (%s, %sP 걸음)', case v_result when 'win' then '맞힘' else '틀림' end,
           case p_pick when 'odd' then '홀' else '짝' end, p_bet)
  );

  insert into public.odd_even_games (channel_id, bet, pick, card, result, payout)
  values (p_channel_id, p_bet, p_pick, v_card, v_result, v_payout);

  select balance into v_balance from public.users where channel_id = p_channel_id;

  return jsonb_build_object(
    'card', v_card,
    'result', v_result,
    'payout', v_payout,
    'net', v_net,
    'balance', v_balance
  );
end;
$function$;

-- 지금 배포된 stream-code 함수가 아직 부르니까 0103 전까지는 항상 null만 돌려주는 껍데기로 둠
create or replace function public.stream_code_doc(p_channel_id text, p_code text)
returns jsonb language sql stable security definer set search_path to 'public' as $$ select null::jsonb $$;

drop function if exists public.minigame_note(text);
drop function if exists public.egg_progress_mark(text, integer);

delete from public.app_secrets where name in ('mg_note_seq', 'mg_note_text', 'code_doc_key', 'code_doc');
delete from public.egg_progress;
