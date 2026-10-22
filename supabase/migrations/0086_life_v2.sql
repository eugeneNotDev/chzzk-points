-- 유진 키우기 2차 — "가만히 보기만 하는 게임"에서 "키우는 게임"으로.
--  · 5년 계획(집중): 태어날 때와 5살마다 멈춰서 보호자가 앞으로 5년 동안 무엇에 집중할지 고름(공부·운동·창작…).
--    고른 집중은 해마다 능력치에 반영되고(70%), 그 집중일 때만 나오는 이벤트가 생김(flags의 focus_<id>로 조건 걸기).
--  · 해마다 능력치 기록(history): 화면이 한 해씩 넘기며 능력치를 실시간으로 바꿔 보여주고, 리포트의 인생 그래프에 씀.
--  · 기록 한 줄마다 능력치 변화량(d)과 그때 능력치(st)를 같이 담음 → 화면이 +/−를 색으로 구분.
--  · 같은 일상 이벤트가 연달아 나오지 않게(최근 10개 기록에 있던 건 제외).

alter table public.life_runs add column if not exists focus text;
alter table public.life_runs add column if not exists history jsonb not null default '[]';  -- [[나이, 건강, 지능, 매력, 재산, 행복, 끼], …]

create table if not exists public.life_focuses (
  id text primary key,
  name text not null,
  age_min integer not null,
  age_max integer not null,
  yearly jsonb not null default '{}',   -- 해마다 70% 확률
  side jsonb not null default '{}',     -- 해마다 30% 확률(대가)
  hint text not null,                   -- 고를 때 보이는 짧은 설명
  sort integer not null default 0
);
alter table public.life_focuses enable row level security;
revoke all on public.life_focuses from anon, authenticated;

-- 능력치 변화 적용 → 새 능력치, 표시용 문구, 실제로 바뀐 양(dd). (예전 life_apply_stats를 대신함)
create or replace function public.life_apply(st jsonb, d jsonb, out stats jsonb, out delta text, out dd jsonb)
language plpgsql immutable as $$
declare k text; v jsonb; cur int; nxt int; parts text[] := '{}';
begin
  stats := st; dd := '{}'::jsonb;
  if d is null or jsonb_typeof(d) <> 'object' then delta := ''; return; end if;
  for k, v in select * from jsonb_each(d) loop
    cur := coalesce((stats->>k)::int, 0);
    nxt := greatest(0, least(100, cur + v::int));
    stats := jsonb_set(stats, array[k], to_jsonb(nxt));
    if nxt <> cur then
      parts := parts || (public.life_stat_label(k) || ' ' || case when nxt > cur then '+' else '−' end || abs(nxt - cur)::text);
      dd := dd || jsonb_build_object(k, nxt - cur);
    end if;
  end loop;
  delta := array_to_string(parts, ' · ');
end $$;

create or replace function public.life_hist_row(age int, st jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_array(age, (st->>'health')::int, (st->>'intel')::int, (st->>'charm')::int,
                           (st->>'wealth')::int, (st->>'happy')::int, (st->>'talent')::int)
$$;

-- 5년 계획 선택지(그 나이에 고를 수 있는 집중들)
create or replace function public.life_plan_pending(p_age int, p_cur text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'kind', 'plan', 'id', 'plan',
    'text', case when p_age = 0 then '갓 태어난 유진, 어떻게 키울까요?'
                 when p_age = 20 then '스무 살이 됐어요. 어른이 된 유진은 무엇에 집중할까요?'
                 when p_age = 65 then '예순다섯, 인생 2막이에요. 무엇을 하며 지낼까요?'
                 else p_age || '세, 앞으로 5년 동안 무엇에 집중할까요?' end,
    'choices', coalesce((select jsonb_agg(jsonb_build_object('key', id, 'text', name, 'hint', hint, 'cur', id = p_cur) order by sort)
                 from public.life_focuses where p_age between age_min and age_max), '[]'))
$$;

create or replace function public.life_run_view(r public.life_runs, p_from integer default 0)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', r.id, 'worldNo', r.world_no, 'isTest', r.is_test, 'house', r.house,
    'houseName', (select name from public.life_houses where id = r.house),
    'status', r.status, 'age', r.age, 'stats', r.stats,
    'job', r.job, 'jobName', coalesce((select name from public.life_jobs where id = r.job), case r.job when 'student' then '학생' else null end),
    'focus', r.focus, 'focusName', (select name from public.life_focuses where id = r.focus),
    'itemsUsed', r.items_used, 'spent', r.spent,
    'logFrom', p_from,
    'log', coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(r.log) with ordinality as x(e, i) where i > p_from), '[]'),
    'logCount', jsonb_array_length(r.log),
    'history', r.history,
    'pending', r.pending,
    'ending', r.ending,
    'jobHistory', r.job_history,
    'diary', case when r.status = 'ended' then r.diary else null end
  )
$$;

create or replace function public.life_advance(p_run_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.life_runs;
  ev public.life_events;
  jb public.life_jobs;
  fz public.life_focuses;
  hist text[];
  recent text[];
  res record;
  v_logs jsonb;
  v_diary jsonb;
  v_hist jsonb;
  p_death double precision;
  cause text;
  n int := 0;
  m public.life_modifiers; f public.life_finales; sp public.life_special_endings;
  final_job text; final_job_name text; title text; moments jsonb;
begin
  select * into r from public.life_runs where id = p_run_id for update;
  if r.status <> 'playing' or r.pending is not null then return; end if;
  v_logs := r.log; v_diary := r.diary; v_hist := r.history;

  loop
    n := n + 1;
    exit when n > 120;
    r.age := r.age + 1;
    hist := public.life_arr(jsonb_path_query_array(r.job_history, '$[*].id'));

    -- 시기별 기본 변화
    if r.age = 8 then r.job := 'student'; end if;
    if r.age >= 55 and random() < 0.5 then
      select stats into r.stats from public.life_apply(r.stats, jsonb_build_object('health', case when r.age >= 75 then -2 else -1 end));
    end if;
    if random() < 0.5 and abs((r.stats->>'happy')::int - 50) > 10 then
      select stats into r.stats from public.life_apply(r.stats, jsonb_build_object('happy',
        case when (r.stats->>'happy')::int > 80 then -2 when (r.stats->>'happy')::int > 50 then -1 else 1 end));
    end if;
    if r.age >= 20 and random() < 0.2 and (r.stats->>'wealth')::int > 50 then
      select stats into r.stats from public.life_apply(r.stats, '{"wealth":-1}'::jsonb);
    end if;
    if r.job is not null and r.job <> 'student' and not ('retired' = any(r.flags)) and random() < 0.3 then
      select stats into r.stats from public.life_apply(r.stats, (select yearly from public.life_jobs where id = r.job));
    end if;
    -- 5년 계획(집중)
    if r.focus is not null then
      select * into fz from public.life_focuses where id = r.focus;
      if found then
        if random() < 0.7 then select stats into r.stats from public.life_apply(r.stats, fz.yearly); end if;
        if random() < 0.3 then select stats into r.stats from public.life_apply(r.stats, fz.side); end if;
      end if;
    end if;
    -- 첫 직업 / 이직
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
          'delta', '', 'd', '{}'::jsonb, 'st', r.stats, 'hl', true);
      end if;
    end if;
    if r.age = 65 and r.job is not null and r.job <> 'student' then
      r.flags := array_append(r.flags, 'retired');
      v_logs := v_logs || jsonb_build_object('age', r.age, 'kind', 'life', 'text', '일에서 물러나 은퇴했다.', 'delta', '', 'd', '{}'::jsonb, 'st', r.stats, 'hl', false);
    end if;

    -- 갈림길(해마다 25%) — 나오면 그해 기록을 남기고 멈춤
    if random() < 0.25 then
      select * into ev from public.life_events
       where active and kind = 'crossroad' and r.age between age_min and age_max
         and (not once or not (id = any(r.seen)))
         and public.life_cond_ok(cond, r.stats, r.flags, r.job, hist, r.house)
       order by -ln(1 - random()) / weight limit 1;
      if found then
        r.pending := jsonb_build_object('kind', 'event', 'id', ev.id, 'text', ev.text,
          'choices', (select jsonb_agg(jsonb_build_object('key', c->>'key', 'text', c->>'text', 'hint', coalesce(c->>'hint', '')))
                        from jsonb_array_elements(ev.choices) c));
        r.seen := array_append(r.seen, ev.id);
        v_hist := v_hist || jsonb_build_array(public.life_hist_row(r.age, r.stats));
        exit;
      end if;
    end if;

    -- 희귀(3%) 또는 일상(75%) — 최근 기록 10개에 있던 이벤트는 건너뜀
    recent := coalesce(array(select x->>'ref' from jsonb_array_elements(v_logs) with ordinality t(x, i)
                             where x ? 'ref' order by i desc limit 10), '{}');
    ev := null;
    if random() < 0.03 then
      select * into ev from public.life_events
       where active and kind = 'rare' and r.age between age_min and age_max
         and not (id = any(r.seen))
         and public.life_cond_ok(cond, r.stats, r.flags, r.job, hist, r.house)
       order by -ln(1 - random()) / weight limit 1;
    end if;
    if ev.id is null and random() < 0.75 then
      select * into ev from public.life_events
       where active and kind = 'daily' and r.age between age_min and age_max
         and (not once or not (id = any(r.seen)))
         and not (id = any(recent))
         and public.life_cond_ok(cond, r.stats, r.flags, r.job, hist, r.house)
       order by -ln(1 - random()) / weight limit 1;
    end if;
    if ev.id is not null then
      select * into res from public.life_apply(r.stats, ev.effects->'stats');
      r.stats := res.stats;
      r.flags := array(select distinct x from unnest(r.flags || public.life_arr(ev.effects->'add')) x
                       where not (x = any(public.life_arr(ev.effects->'remove'))));
      if ev.once or ev.kind = 'rare' then r.seen := array_append(r.seen, ev.id); end if;
      v_logs := v_logs || jsonb_build_object('age', r.age, 'kind', ev.kind, 'text', ev.text, 'delta', res.delta, 'd', res.dd,
                                             'st', r.stats, 'hl', ev.kind = 'rare', 'ref', ev.id);
      if ev.diary is not null then v_diary := v_diary || jsonb_build_object('age', r.age, 'text', ev.diary); end if;
    end if;

    v_hist := v_hist || jsonb_build_array(public.life_hist_row(r.age, r.stats));

    -- 생을 마칠지
    cause := null;
    if r.age >= 100 then
      cause := 'death_old';
    elsif (r.stats->>'health')::int <= 3 and r.age >= 30 and random() < 0.25 then
      cause := 'death_sick';
    elsif r.age >= 20 and random() < 0.001 then
      cause := 'death_accident';
    elsif r.age >= 60 then
      p_death := 0.004 * exp((r.age - 60) / 9.0) * (1.6 - (r.stats->>'health')::int / 100.0);
      if random() < p_death then cause := case when r.age < 75 and (r.stats->>'health')::int < 15 then 'death_sick' else 'death_old' end; end if;
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
      v_logs := v_logs || jsonb_build_object('age', r.age, 'kind', 'end', 'text', coalesce(f.text, '조용히 눈을 감았어요'),
                                             'delta', '', 'd', '{}'::jsonb, 'st', r.stats, 'hl', false);
      r.status := 'ended';
      r.ended_at := now();

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

    -- 5살마다 5년 계획
    if r.age % 5 = 0 then
      r.pending := public.life_plan_pending(r.age, r.focus);
      exit;
    end if;
  end loop;

  update public.life_runs set age = r.age, stats = r.stats, flags = r.flags, job = r.job, job_history = r.job_history,
    seen = r.seen, log = v_logs, diary = v_diary, history = v_hist, pending = r.pending, status = r.status,
    ending = r.ending, ended_at = r.ended_at
  where id = r.id;
end $$;

create or replace function public.life_start(p_channel_id text, p_house text, p_test boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.life_settings; h public.life_houses; u public.users;
  used int; rid bigint; base jsonb; k text; r public.life_runs;
begin
  select * into s from public.life_settings;
  select * into h from public.life_houses where id = p_house;
  if not found then return jsonb_build_object('error', 'bad_house'); end if;
  select * into u from public.users where channel_id = p_channel_id for update;
  if not found or u.banned then return jsonb_build_object('error', 'user_not_found'); end if;
  if exists (select 1 from public.life_runs where channel_id = p_channel_id and status = 'playing') then
    return jsonb_build_object('error', 'in_progress');
  end if;
  if not p_test then
    select count(*) into used from public.life_runs
     where channel_id = p_channel_id and not is_test and kst_date = (now() at time zone 'Asia/Seoul')::date;
    if used >= s.daily_limit then return jsonb_build_object('error', 'daily_limit'); end if;
    if h.price > 0 then
      if u.balance < h.price then return jsonb_build_object('error', 'insufficient_balance'); end if;
      insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, -h.price, '유진 키우기 · ' || h.name);
    end if;
  end if;

  base := '{}'::jsonb;
  foreach k in array array['health','intel','charm','wealth','happy','talent'] loop
    base := base || jsonb_build_object(k, case when k = 'health' then 50 else 35 end + floor(random() * 21)::int);
  end loop;
  select stats into base from public.life_apply(base, h.bonus);

  insert into public.life_runs (channel_id, world_no, is_test, house, spent, stats, flags, log, history, pending)
  values (p_channel_id, case when p_test then null else nextval('public.life_world_seq') end, p_test, h.id,
          case when p_test then 0 else h.price end, base, array['house_' || h.id],
          jsonb_build_array(jsonb_build_object('age', 0, 'kind', 'life', 'text', h.name || '에서 유진이 태어났다.', 'delta', '', 'd', '{}'::jsonb, 'st', base, 'hl', false)),
          jsonb_build_array(public.life_hist_row(0, base)),
          public.life_plan_pending(0, null))
  returning id into rid;

  select * into r from public.life_runs where id = rid;
  return jsonb_build_object('run', public.life_run_view(r, 0), 'balance', (select balance from public.users where channel_id = p_channel_id));
end $$;

create or replace function public.life_choose(p_channel_id text, p_run_id bigint, p_key text, p_from integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.life_runs; ev public.life_events; c jsonb; res record; jb public.life_jobs; fz public.life_focuses;
        extra jsonb := '[]'::jsonb; hist jsonb;
begin
  select * into r from public.life_runs where id = p_run_id and channel_id = p_channel_id for update;
  if not found or r.status <> 'playing' or r.pending is null then return jsonb_build_object('error', 'no_pending'); end if;

  -- 5년 계획
  if r.pending->>'kind' = 'plan' then
    select * into fz from public.life_focuses where id = p_key and r.age between age_min and age_max;
    if not found then return jsonb_build_object('error', 'bad_choice'); end if;
    update public.life_runs set
      focus = fz.id, pending = null,
      flags = array(select x from unnest(flags) x where x not like 'focus\_%') || ('focus_' || fz.id),
      log = log || jsonb_build_object('age', r.age, 'kind', 'plan',
        'text', case when r.age = 0 then '「' || fz.name || '」 위주로 키우기로 했다.'
                     else '앞으로 5년은 「' || fz.name || '」에 집중하기로 했다.' end,
        'delta', '', 'd', '{}'::jsonb, 'st', r.stats, 'hl', false)
    where id = r.id;
    perform public.life_advance(r.id);
    select * into r from public.life_runs where id = p_run_id;
    return jsonb_build_object('run', public.life_run_view(r, p_from));
  end if;

  -- 갈림길
  select * into ev from public.life_events where id = r.pending->>'id';
  select x into c from jsonb_array_elements(ev.choices) x where x->>'key' = p_key;
  if c is null then return jsonb_build_object('error', 'bad_choice'); end if;

  select * into res from public.life_apply(r.stats, c->'effects'->'stats');
  r.flags := array(select distinct x from unnest(r.flags || public.life_arr(c->'effects'->'add')) x
                   where not (x = any(public.life_arr(c->'effects'->'remove'))));
  hist := r.job_history;
  if c->'effects' ? 'job' then
    select * into jb from public.life_jobs where id = c->'effects'->>'job';
    if found and jb.id is distinct from r.job then
      r.job := jb.id;
      hist := hist || jsonb_build_object('id', jb.id, 'name', jb.name, 'age', r.age);
      extra := jsonb_build_array(jsonb_build_object('age', r.age, 'kind', 'job',
        'text', case when jsonb_array_length(hist) = 1 then jb.name || '(으)로 사회생활을 시작했다.' else jb.name || '(으)로 일을 바꿨다.' end,
        'delta', '', 'd', '{}'::jsonb, 'st', res.stats, 'hl', false));
    end if;
  end if;

  update public.life_runs set
    stats = res.stats, flags = r.flags, pending = null, job = r.job, job_history = hist,
    log = log || jsonb_build_object('age', r.age, 'kind', 'choice', 'text', ev.text || ' → ' || coalesce(c->>'result', c->>'text'),
                                    'delta', res.delta, 'd', res.dd, 'st', res.stats, 'hl', true) || extra,
    diary = case when c ? 'diary' then diary || jsonb_build_object('age', r.age, 'text', c->>'diary') else diary end
  where id = r.id;

  perform public.life_advance(r.id);
  select * into r from public.life_runs where id = p_run_id;
  return jsonb_build_object('run', public.life_run_view(r, p_from));
end $$;

create or replace function public.life_use_item(p_channel_id text, p_run_id bigint, p_item text, p_from integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.life_settings; r public.life_runs; it public.life_items; u public.users; res record;
begin
  select * into s from public.life_settings;
  select * into it from public.life_items where id = p_item;
  if not found then return jsonb_build_object('error', 'bad_item'); end if;
  select * into r from public.life_runs where id = p_run_id and channel_id = p_channel_id for update;
  if not found or r.status <> 'playing' then return jsonb_build_object('error', 'not_playing'); end if;
  if r.items_used >= s.item_limit then return jsonb_build_object('error', 'item_limit'); end if;
  if not r.is_test and it.price > 0 then
    select * into u from public.users where channel_id = p_channel_id for update;
    if u.balance < it.price then return jsonb_build_object('error', 'insufficient_balance'); end if;
    insert into public.points_ledger (channel_id, amount, reason) values (p_channel_id, -it.price, '유진 키우기 · ' || it.name);
  end if;
  select * into res from public.life_apply(r.stats, it.effects->'stats');
  update public.life_runs set
    stats = res.stats,
    flags = array(select distinct x from unnest(flags || public.life_arr(it.effects->'add')) x where not (x = any(public.life_arr(it.effects->'remove')))),
    items_used = items_used + 1,
    spent = spent + case when is_test then 0 else it.price end,
    log = log || jsonb_build_object('age', r.age, 'kind', 'item', 'text', it.log_text, 'delta', res.delta, 'd', res.dd, 'st', res.stats, 'hl', false)
  where id = r.id;
  select * into r from public.life_runs where id = p_run_id;
  return jsonb_build_object('run', public.life_run_view(r, p_from), 'balance', (select balance from public.users where channel_id = p_channel_id));
end $$;

do $$
declare f text;
begin
  foreach f in array array['life_apply(jsonb,jsonb)','life_hist_row(integer,jsonb)','life_plan_pending(integer,text)',
    'life_run_view(public.life_runs,integer)','life_advance(bigint)','life_start(text,text,boolean)',
    'life_choose(text,bigint,text,integer)','life_use_item(text,bigint,text,integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
