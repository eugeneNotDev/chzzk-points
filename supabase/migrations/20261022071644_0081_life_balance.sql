-- 유진 키우기 밸런스 조정(테스트 30판 결과): 건강이 너무 빨리 깎여 50~60대 병사가 대부분이었고,
-- 재산·행복이 한쪽으로만 쌓였고, 늑대 히든 엔딩이 너무 흔했음.
create or replace function public.life_advance(p_run_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.life_runs;
  ev public.life_events;
  jb public.life_jobs;
  hist text[];
  res record;
  v_logs jsonb;
  v_diary jsonb;
  p_death double precision;
  cause text;
  n int := 0;
  m public.life_modifiers; f public.life_finales; sp public.life_special_endings;
  final_job text; final_job_name text; title text; moments jsonb;
begin
  select * into r from public.life_runs where id = p_run_id for update;
  if r.status <> 'playing' or r.pending is not null then return; end if;
  v_logs := r.log; v_diary := r.diary;

  loop
    n := n + 1;
    exit when n > 120;
    r.age := r.age + 1;
    hist := public.life_arr(jsonb_path_query_array(r.job_history, '$[*].id'));

    -- 시기별 기본 변화
    if r.age = 8 then
      r.job := 'student';
    end if;
    if r.age >= 55 and random() < 0.5 then
      select stats into r.stats from public.life_apply_stats(r.stats, jsonb_build_object('health', case when r.age >= 75 then -2 else -1 end));
    end if;
    -- 행복·재산은 가만두면 조금씩 보통(50) 쪽으로 돌아감 — 한쪽으로만 쌓이지 않게
    if random() < 0.3 and (r.stats->>'happy')::int <> 50 then
      select stats into r.stats from public.life_apply_stats(r.stats, jsonb_build_object('happy', sign(50 - (r.stats->>'happy')::int)::int));
    end if;
    if r.age >= 20 and random() < 0.2 and (r.stats->>'wealth')::int > 50 then
      select stats into r.stats from public.life_apply_stats(r.stats, '{"wealth":-1}'::jsonb);
    end if;
    -- 직업 연봉·만족도
    if r.job is not null and r.job <> 'student' and not ('retired' = any(r.flags)) and random() < 0.3 then
      select stats into r.stats from public.life_apply_stats(r.stats, (select yearly from public.life_jobs where id = r.job));
    end if;
    -- 첫 직업(20세) / 이직(22~60세, 해마다 5%)
    if (r.age >= 20 and (r.job is null or r.job = 'student'))
       or (r.age between 22 and 60 and r.job <> 'student' and random() < 0.05) then
      select * into jb from public.life_jobs
       where active and age_min <= r.age and id is distinct from r.job
         and public.life_cond_ok(cond, r.stats, r.flags, r.job, hist, r.house)
       order by -ln(1 - random()) / weight limit 1;
      if found then
        r.job := jb.id;
        r.job_history := r.job_history || jsonb_build_object('id', jb.id, 'name', jb.name, 'age', r.age);
        v_logs := v_logs || jsonb_build_object('age', r.age, 'kind', 'job',
          'text', case when jsonb_array_length(r.job_history) = 1 then jb.name || '(으)로 사회생활을 시작했다.' else jb.name || '(으)로 일을 바꿨다.' end,
          'delta', '', 'hl', true);
      end if;
    end if;
    if r.age = 65 and r.job is not null and r.job <> 'student' then
      r.flags := array_append(r.flags, 'retired');
      v_logs := v_logs || jsonb_build_object('age', r.age, 'kind', 'life', 'text', '일에서 물러나 은퇴했다.', 'delta', '', 'hl', false);
    end if;

    -- 갈림길(해마다 30%) — 나오면 여기서 멈추고 보호자의 선택을 기다림
    if random() < 0.30 then
      select * into ev from public.life_events
       where active and kind = 'crossroad' and r.age between age_min and age_max
         and (not once or not (id = any(r.seen)))
         and public.life_cond_ok(cond, r.stats, r.flags, r.job, hist, r.house)
       order by -ln(1 - random()) / weight limit 1;
      if found then
        r.pending := jsonb_build_object('id', ev.id, 'text', ev.text,
          'choices', (select jsonb_agg(jsonb_build_object('key', c->>'key', 'text', c->>'text', 'hint', coalesce(c->>'hint', '')))
                        from jsonb_array_elements(ev.choices) c));
        r.seen := array_append(r.seen, ev.id);
        exit;
      end if;
    end if;

    -- 희귀 이벤트(3%) 또는 일상 이벤트(70%)
    ev := null;
    if random() < 0.03 then
      select * into ev from public.life_events
       where active and kind = 'rare' and r.age between age_min and age_max
         and not (id = any(r.seen))
         and public.life_cond_ok(cond, r.stats, r.flags, r.job, hist, r.house)
       order by -ln(1 - random()) / weight limit 1;
    end if;
    if ev.id is null and random() < 0.70 then
      select * into ev from public.life_events
       where active and kind = 'daily' and r.age between age_min and age_max
         and (not once or not (id = any(r.seen)))
         and public.life_cond_ok(cond, r.stats, r.flags, r.job, hist, r.house)
       order by -ln(1 - random()) / weight limit 1;
    end if;
    if ev.id is not null then
      select * into res from public.life_apply_stats(r.stats, ev.effects->'stats');
      r.stats := res.stats;
      r.flags := array(select distinct x from unnest(r.flags || public.life_arr(ev.effects->'add')) x
                       where not (x = any(public.life_arr(ev.effects->'remove'))));
      if ev.once or ev.kind = 'rare' then r.seen := array_append(r.seen, ev.id); end if;
      v_logs := v_logs || jsonb_build_object('age', r.age, 'kind', ev.kind, 'text', ev.text, 'delta', res.delta, 'hl', ev.kind = 'rare', 'ref', ev.id);
      if ev.diary is not null then v_diary := v_diary || jsonb_build_object('age', r.age, 'text', ev.diary); end if;
    end if;

    -- 생을 마칠지
    cause := null;
    if r.age >= 100 then
      cause := 'death_old';
    elsif (r.stats->>'health')::int <= 3 and r.age >= 30 and random() < 0.25 then
      cause := 'death_sick';
    elsif r.age >= 20 and random() < 0.002 then
      cause := 'death_accident';
    elsif r.age >= 60 then
      p_death := 0.004 * exp((r.age - 60) / 9.0) * (1.6 - (r.stats->>'health')::int / 100.0);
      if random() < p_death then cause := case when (r.stats->>'health')::int < 30 then 'death_sick' else 'death_old' end; end if;
    end if;

    if cause is not null then
      r.flags := array_append(r.flags, cause);
      hist := public.life_arr(jsonb_path_query_array(r.job_history, '$[*].id'));
      select j->>'id', j->>'name' into final_job, final_job_name
        from jsonb_array_elements(r.job_history) j order by (j->>'age')::int desc limit 1;
      final_job := coalesce(final_job, 'none'); final_job_name := coalesce(final_job_name, '백수');

      select * into m from public.life_modifiers
       where active and public.life_cond_ok(cond, r.stats, r.flags, final_job, hist, r.house)
       order by priority desc, random() limit 1;
      select * into f from public.life_finales
       where active and public.life_cond_ok(cond, r.stats, r.flags, final_job, hist, r.house)
       order by priority desc, random() limit 1;
      select * into sp from public.life_special_endings
       where active and public.life_cond_ok(cond, r.stats, r.flags, final_job, hist, r.house)
       order by priority desc limit 1;

      title := case when sp.id is not null then sp.title
                    else coalesce(m.text || ' ', '') || final_job_name || ' 유진' end;
      moments := coalesce((select jsonb_agg(e) from (
                   select e from jsonb_array_elements(v_logs) e where (e->>'hl')::boolean order by random() limit 5) s), '[]');
      moments := coalesce((select jsonb_agg(e order by (e->>'age')::int) from jsonb_array_elements(moments) e), '[]');

      r.ending := jsonb_build_object(
        'title', title, 'age', r.age, 'cause', cause,
        'modifierId', m.id, 'modifier', m.text,
        'jobId', final_job, 'job', final_job_name,
        'finaleId', f.id, 'finale', coalesce(f.text, '조용히 눈을 감았어요'),
        'specialId', sp.id, 'specialText', sp.text,
        'moments', moments);
      v_logs := v_logs || jsonb_build_object('age', r.age, 'kind', 'end', 'text', coalesce(f.text, '조용히 눈을 감았어요'), 'delta', '', 'hl', false);
      r.status := 'ended';
      r.ended_at := now();

      -- 도감 기록
      insert into public.life_collection (channel_id, is_test, kind, ref_id, first_run_id)
      select r.channel_id, r.is_test, k, ref, r.id from (
        select 'job' k, j->>'id' ref from jsonb_array_elements(r.job_history) j
        union select 'modifier', m.id where m.id is not null
        union select 'special', sp.id where sp.id is not null
        union select 'event', e.id from public.life_events e where e.kind = 'rare' and e.id = any(r.seen)
      ) s
      on conflict do nothing;
      exit;
    end if;
  end loop;

  update public.life_runs set age = r.age, stats = r.stats, flags = r.flags, job = r.job, job_history = r.job_history,
    seen = r.seen, log = v_logs, diary = v_diary, pending = r.pending, status = r.status, ending = r.ending, ended_at = r.ended_at
  where id = r.id;
end $$;


revoke all on function public.life_advance(bigint) from public, anon, authenticated;
grant execute on function public.life_advance(bigint) to service_role;

-- 내용 밸런스: 건강 깎는 반복 이벤트 줄이고, 늑대 히든 루트를 훨씬 드물게.
update public.life_events set weight = 4 where id = 'd_overtime';
update public.life_events set weight = 3 where id = 'd_sick';
update public.life_events set weight = 1, age_max = 30 where id = 'd_wolf1';
update public.life_events set weight = 2 where id = 'd_wolf2';
update public.life_events set weight = 8 where id = 'c_wolf';
