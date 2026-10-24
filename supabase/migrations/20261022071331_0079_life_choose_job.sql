-- 유진 키우기: 갈림길 선택지가 직업을 바로 바꿀 수 있게("effects": {"job": "vtuber"}). 예) 버추얼 데뷔 제안 → 데뷔한다.
create or replace function public.life_choose(p_channel_id text, p_run_id bigint, p_key text, p_from integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.life_runs; ev public.life_events; c jsonb; res record; jb public.life_jobs; extra jsonb := '[]'::jsonb; hist jsonb;
begin
  select * into r from public.life_runs where id = p_run_id and channel_id = p_channel_id for update;
  if not found or r.status <> 'playing' or r.pending is null then return jsonb_build_object('error', 'no_pending'); end if;
  select * into ev from public.life_events where id = r.pending->>'id';
  select x into c from jsonb_array_elements(ev.choices) x where x->>'key' = p_key;
  if c is null then return jsonb_build_object('error', 'bad_choice'); end if;

  select * into res from public.life_apply_stats(r.stats, c->'effects'->'stats');
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
        'delta', '', 'hl', false));
    end if;
  end if;

  update public.life_runs set
    stats = res.stats, flags = r.flags, pending = null, job = r.job, job_history = hist,
    log = log || jsonb_build_object('age', r.age, 'kind', 'choice', 'text', ev.text || ' → ' || coalesce(c->>'result', c->>'text'), 'delta', res.delta, 'hl', true) || extra,
    diary = case when c ? 'diary' then diary || jsonb_build_object('age', r.age, 'text', c->>'diary') else diary end
  where id = r.id;

  perform public.life_advance(r.id);
  select * into r from public.life_runs where id = p_run_id;
  return jsonb_build_object('run', public.life_run_view(r, p_from));
end $$;
revoke all on function public.life_choose(text, bigint, text, integer) from public, anon, authenticated;
grant execute on function public.life_choose(text, bigint, text, integer) to service_role;
