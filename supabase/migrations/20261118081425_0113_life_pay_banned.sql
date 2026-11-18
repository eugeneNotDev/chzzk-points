-- 우진 키우기: life_pay에 밴 확인 추가(life_begin·life_donate와 똑같이) — 판 도중 밴된 사람이 포인트로 계속 사는 일 방지
create or replace function public.life_pay(p_channel_id text, p_life_id bigint, p_ver integer, p_amount integer, p_reason text, p_state jsonb, p_log jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.life_settings; l public.life_lives; u public.users;
begin
  select * into s from public.life_settings;
  select * into l from public.life_lives where id = p_life_id and channel_id = p_channel_id for update;
  if not found or l.status <> 'playing' then return jsonb_build_object('error', 'not_playing'); end if;
  if l.ver <> p_ver then return jsonb_build_object('error', 'busy'); end if;
  if l.points_used >= s.item_limit then return jsonb_build_object('error', 'item_limit'); end if;
  if not l.is_test and p_amount > 0 then
    select * into u from public.users where channel_id = p_channel_id for update;
    if not found or u.banned then return jsonb_build_object('error', 'user_not_found'); end if;
    if u.balance < p_amount then return jsonb_build_object('error', 'insufficient_balance'); end if;
    insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, -p_amount, '우진 키우기 · ' || p_reason);
  end if;
  update public.life_lives
     set state = p_state, log = p_log, ver = ver + 1, points_used = points_used + 1,
         spent = spent + case when l.is_test then 0 else p_amount end
   where id = p_life_id;
  return jsonb_build_object('ok', true, 'balance', (select balance from public.users where channel_id = p_channel_id));
end $function$;
