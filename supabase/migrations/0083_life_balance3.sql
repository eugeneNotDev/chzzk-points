-- 유진 키우기 밸런스 3차: 행복이 80 넘게 쌓이던 문제 — 50에서 10 이상 벗어나면 해마다 50% 확률로 1~2씩 돌아오게.
-- 75세 이상 노환은 건강과 상관없이 '천수'로 판정.
do $$
declare d text; o1 text; o2 text;
begin
  d := pg_get_functiondef('public.life_advance(bigint)'::regprocedure);
  o1 := $x$    if random() < 0.3 and (r.stats->>'happy')::int <> 50 then
      select stats into r.stats from public.life_apply_stats(r.stats, jsonb_build_object('happy', sign(50 - (r.stats->>'happy')::int)::int));
    end if;$x$;
  if position(o1 in d) = 0 then raise exception 'happy block not found'; end if;
  d := replace(d, o1, $x$    if random() < 0.5 and abs((r.stats->>'happy')::int - 50) > 10 then
      select stats into r.stats from public.life_apply_stats(r.stats, jsonb_build_object('happy',
        case when (r.stats->>'happy')::int > 80 then -2 when (r.stats->>'happy')::int > 50 then -1 else 1 end));
    end if;$x$);
  o2 := $x$cause := case when (r.stats->>'health')::int < 15 then 'death_sick' else 'death_old' end;$x$;
  if position(o2 in d) = 0 then raise exception 'cause block not found'; end if;
  d := replace(d, o2, $x$cause := case when r.age < 75 and (r.stats->>'health')::int < 15 then 'death_sick' else 'death_old' end;$x$);
  execute d;
end $$;
