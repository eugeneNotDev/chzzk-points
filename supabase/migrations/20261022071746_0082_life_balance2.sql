-- 유진 키우기 밸런스 2차: 시작 건강을 조금 높이고(50~70), 노년 사망 중 '병사' 판정 기준을 건강 15 미만으로.
-- 늑대 히든 루트를 더 드물게, '행복하게 산'·'부자가 된' 수식어 기준을 85로.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.life_start(text,text,boolean)'::regprocedure);
  d := replace(d, 'base := base || jsonb_build_object(k, 35 + floor(random() * 21)::int);',
                  'base := base || jsonb_build_object(k, case when k = ''health'' then 50 else 35 end + floor(random() * 21)::int);');
  execute d;
  d := pg_get_functiondef('public.life_advance(bigint)'::regprocedure);
  d := replace(d, '< 30 then ''death_sick''', '< 15 then ''death_sick''');
  execute d;
end $$;
update public.life_events set weight = 1, age_min = 12, age_max = 25 where id = 'd_wolf1';
update public.life_events set weight = 1, age_min = 16, age_max = 35 where id = 'd_wolf2';
update public.life_events set weight = 3, age_min = 18, age_max = 40 where id = 'c_wolf';
update public.life_modifiers set cond = '{"min": {"happy": 85}}' where id = 'happy';
update public.life_modifiers set cond = '{"min": {"wealth": 85}}' where id = 'rich';
