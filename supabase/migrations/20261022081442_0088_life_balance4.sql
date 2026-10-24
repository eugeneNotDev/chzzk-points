-- 유진 키우기 밸런스 4차(5년 계획 넣은 뒤): 능력치가 대부분 80~100으로 쏠림.
--  · 집중 효과에 한계 체감: 그 능력치가 60 미만이면 70%, 80 미만이면 40%, 80 이상이면 15% 확률로만 오름.
--  · 높은 능력치는 조금씩 빠짐: 지능·매력·끼가 70을 넘으면 해마다 25% 확률로 −1.
--  · 행복은 70을 넘으면 해마다 60% 확률로 −2(그 아래는 예전처럼 천천히 50으로).
do $$
declare d text; o1 text; o2 text;
begin
  d := pg_get_functiondef('public.life_advance(bigint)'::regprocedure);
  o1 := $x$        if random() < 0.7 then select stats into r.stats from public.life_apply(r.stats, fz.yearly); end if;$x$;
  if position(o1 in d) = 0 then raise exception 'focus block not found'; end if;
  d := replace(d, o1, $x$        if random() < (select case when coalesce((r.stats->>k)::int, 0) < 60 then 0.7
                                   when coalesce((r.stats->>k)::int, 0) < 80 then 0.4 else 0.15 end
                            from jsonb_object_keys(fz.yearly) k limit 1) then
          select stats into r.stats from public.life_apply(r.stats, fz.yearly);
        end if;$x$);
  o2 := $x$    if random() < 0.5 and abs((r.stats->>'happy')::int - 50) > 10 then
      select stats into r.stats from public.life_apply(r.stats, jsonb_build_object('happy',
        case when (r.stats->>'happy')::int > 80 then -2 when (r.stats->>'happy')::int > 50 then -1 else 1 end));
    end if;$x$;
  if position(o2 in d) = 0 then raise exception 'happy block not found'; end if;
  d := replace(d, o2, $x$    if (r.stats->>'happy')::int > 70 and random() < 0.6 then
      select stats into r.stats from public.life_apply(r.stats, '{"happy":-2}'::jsonb);
    elsif random() < 0.5 and abs((r.stats->>'happy')::int - 50) > 10 then
      select stats into r.stats from public.life_apply(r.stats, jsonb_build_object('happy', case when (r.stats->>'happy')::int > 50 then -1 else 1 end));
    end if;
    if (r.stats->>'intel')::int > 70 and random() < 0.25 then select stats into r.stats from public.life_apply(r.stats, '{"intel":-1}'::jsonb); end if;
    if (r.stats->>'charm')::int > 70 and random() < 0.25 then select stats into r.stats from public.life_apply(r.stats, '{"charm":-1}'::jsonb); end if;
    if (r.stats->>'talent')::int > 70 and random() < 0.25 then select stats into r.stats from public.life_apply(r.stats, '{"talent":-1}'::jsonb); end if;$x$);
  execute d;
end $$;
