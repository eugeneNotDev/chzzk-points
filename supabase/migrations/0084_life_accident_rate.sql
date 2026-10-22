-- 유진 키우기: 사고사 확률 절반으로(해마다 0.2% → 0.1%). 테스트에서 10% 가까이 나와서.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.life_advance(bigint)'::regprocedure);
  if position('r.age >= 20 and random() < 0.002' in d) = 0 then raise exception 'accident line not found'; end if;
  execute replace(d, 'r.age >= 20 and random() < 0.002', 'r.age >= 20 and random() < 0.001');
end $$;
