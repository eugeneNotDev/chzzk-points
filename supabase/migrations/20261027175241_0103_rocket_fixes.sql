-- 0103 — 양 로켓 검수 반영 + 룰렛 베팅 상한
-- 1) rocket_mult: 오래 방치한 판에서 exp()가 넘치지 않게 경과 시간을 100초로 자름(최대 배수 x200은 약 41초라 영향 없음)
-- 2) rocket_settle_all: 창을 닫고 떠난 판을 1분마다 정리(자동 내리기 당첨금이 다음 로켓 날까지 밀리지 않게)
-- 3) 룰렛 한 판 최대 2억P — x10이 나오면 포인트 기록 칸(integer, 약 21억)을 넘지 않게

create or replace function public.rocket_mult(p_elapsed double precision)
returns numeric language sql immutable set search_path = public as $$
  select (floor(exp(0.13 * least(greatest(p_elapsed, 0), 100)) * 100) / 100)::numeric
$$;

create or replace function public.rocket_settle_all()
returns integer language plpgsql security definer set search_path = public as $$
declare
  c text;
  n integer := 0;
begin
  for c in
    select distinct channel_id from public.rocket_rounds
    where status = 'flying'
      and now() >= public.rocket_time_of(started_at, case when auto_at is not null and auto_at < crash_at then auto_at else crash_at end)
  loop
    perform 1 from public.users where channel_id = c for update;
    perform public.rocket_settle_due(c);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.rocket_settle_all() from public, anon, authenticated;

select cron.schedule('rocket-settle', '* * * * *', 'select public.rocket_settle_all();');

do $$
declare d text;
begin
  d := pg_get_functiondef('public.roulette_spin(text, bigint)'::regprocedure);
  if position('p_bet > 400000000' in d) = 0 then raise exception 'roulette_spin 상한 문구를 못 찾음'; end if;
  d := replace(d, 'p_bet > 400000000', 'p_bet > 200000000');
  d := replace(d, '-- 상한 4억은 포인트 기록 칸(integer) 범위를 넘지 않게 하려는 기술적 한계일 뿐(실제로 닿을 일 없음).',
                  '-- 상한 2억은 x10 당첨이 포인트 기록 칸(integer) 범위를 넘지 않게 하려는 기술적 한계일 뿐(실제로 닿을 일 없음).');
  execute d;
end $$;
