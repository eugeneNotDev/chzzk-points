-- 유진 키우기: 버튜버 루트 포인트 후원(100/300/500P). 상점 포인트 구매와 달리 판당 횟수 제한 없이 후원 이벤트 때만.
-- 잔액 확인 → 차감 → 바뀐 판 저장을 한 번에(ver가 다르면 전부 취소). 테스트 판은 포인트 안 빠짐.
create or replace function public.life_donate(p_channel_id text, p_life_id bigint, p_ver int, p_amount int,
                                              p_state jsonb, p_log jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.life_lives; u public.users;
begin
  if p_amount not in (100, 300, 500) then return jsonb_build_object('error', 'bad_choice'); end if;
  select * into l from public.life_lives where id = p_life_id and channel_id = p_channel_id for update;
  if not found or l.status <> 'playing' then return jsonb_build_object('error', 'not_playing'); end if;
  if l.ver <> p_ver then return jsonb_build_object('error', 'busy'); end if;
  if not l.is_test then
    select * into u from public.users where channel_id = p_channel_id for update;
    if not found or u.banned then return jsonb_build_object('error', 'user_not_found'); end if;
    if u.balance < p_amount then return jsonb_build_object('error', 'insufficient_balance'); end if;
    insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, -p_amount, '유진 키우기 · 후원');
  end if;
  update public.life_lives
     set state = p_state, log = p_log, ver = ver + 1, age = coalesce((p_state->>'age')::int, age),
         spent = spent + case when l.is_test then 0 else p_amount end
   where id = p_life_id;
  return jsonb_build_object('ok', true, 'balance', (select balance from public.users where channel_id = p_channel_id));
end $$;

revoke all on function public.life_donate(text, bigint, int, int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.life_donate(text, bigint, int, int, jsonb, jsonb) to service_role;
