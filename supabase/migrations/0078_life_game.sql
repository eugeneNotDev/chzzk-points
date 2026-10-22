-- 유진 키우기 — 평행세계의 유진을 키우는 텍스트 인생 게임.
-- 시청자 화면 life.html → life-game 함수(세션 확인) → 아래 DB 함수들(service_role 전용).
-- 인생 진행은 전부 서버(여기)에서 함: 시작·선택·아이템 요청이 오면 다음 갈림길이나 엔딩까지 몇 년치를 한 번에 계산해서
-- 기록(log)으로 돌려주고, 화면은 그 기록을 속도에 맞춰 한 줄씩 보여주기만 함 → 브라우저에서 결과 조작 불가.
--
-- 포인트는 쓰기만 함(시작할 때 집 등급, 진행 중 보호자 아이템). 결과로 포인트를 돌려주는 일은 없음.
-- 테스트 모드(life_settings.is_open = false): 주인 계정만 플레이 가능, 판은 is_test로 기록되고 포인트 차감·하루 제한 없음.
--
-- 내용(직업·수식어·마무리·이벤트·특수 엔딩)은 전부 테이블 데이터 — 코드 수정 없이 행만 추가하면 됨.
-- 조건(cond) 형식(모든 테이블 공통, 전부 생략 가능):
--   {"min": {"intel": 60}, "max": {"wealth": 30},          능력치 이상/이하 (health intel charm wealth happy talent, 0~100)
--    "flags": ["mic"], "anyflags": ["a","b"], "noflags": ["corp"],   겪은 일(플래그) 전부 있음 / 하나라도 있음 / 하나도 없음
--    "job": ["office"], "nojob": ["student"], "hadjob": ["office"],  현재 직업 / 현재 직업 아님 / 거쳐간 적 있음
--    "house": ["rich"]}                                               태어난 집
-- 효과(effects) 형식: {"stats": {"happy": 4, "wealth": -3}, "add": ["mic"], "remove": ["sick"], "job": "vtuber" | "auto"}

-- ── 설정 ──
create table if not exists public.life_settings (
  id boolean primary key default true check (id),
  is_open boolean not null default false,   -- false = 테스트 모드(주인만)
  daily_limit integer not null default 3,   -- 하루 판수(한국 시간 자정 초기화)
  item_limit integer not null default 3     -- 한 판에 쓸 수 있는 보호자 아이템 수
);
insert into public.life_settings (id) values (true) on conflict do nothing;

create table if not exists public.life_houses (
  id text primary key,
  name text not null,
  price integer not null default 0 check (price >= 0),
  bonus jsonb not null default '{}',        -- 시작 능력치 보정 {"wealth":25,...}
  sort integer not null default 0
);

create table if not exists public.life_items (
  id text primary key,
  name text not null,
  price integer not null check (price >= 0),
  effects jsonb not null default '{}',
  log_text text not null,                   -- 진행 기록에 남는 문장
  sort integer not null default 0
);

-- ── 내용 ──
create table if not exists public.life_jobs (
  id text primary key,
  name text not null,
  category text not null,                   -- 도감 계열 묶음
  cond jsonb not null default '{}',
  age_min integer not null default 20,
  weight integer not null default 10 check (weight > 0),
  yearly jsonb not null default '{}',       -- 이 직업으로 지내는 동안 해마다(50%) 바뀌는 능력치
  hint text,                                -- 도감에서 못 모았을 때 보이는 힌트
  active boolean not null default true
);

create table if not exists public.life_modifiers (
  id text primary key,
  text text not null,                       -- "가난해도 웃음 많은"
  cond jsonb not null default '{}',
  priority integer not null default 0,      -- 조건 맞는 것 중 높은 것 우선
  hint text,
  active boolean not null default true
);

create table if not exists public.life_finales (
  id text primary key,
  text text not null,                       -- "무대 위에서 마지막 인사를 했어요"
  cond jsonb not null default '{}',         -- 사망 원인 플래그(death_old / death_sick / death_accident)도 조건으로 씀
  priority integer not null default 0,
  active boolean not null default true
);

create table if not exists public.life_events (
  id text primary key,
  kind text not null check (kind in ('daily', 'crossroad', 'rare')),
  age_min integer not null default 0,
  age_max integer not null default 100,
  cond jsonb not null default '{}',
  weight integer not null default 10 check (weight > 0),
  once boolean not null default true,       -- 한 판에 한 번만
  text text not null,
  effects jsonb not null default '{}',      -- daily/rare 효과
  choices jsonb,                            -- crossroad: [{"key":"A","text","hint","result","effects"}]
  diary text,                               -- 일어나면 유진의 일기장에 남는 한 줄(선택)
  hint text,                                -- rare 도감 힌트
  active boolean not null default true
);

create table if not exists public.life_special_endings (
  id text primary key,
  title text not null,                      -- "아무도 몰랐던 늑대 유진"
  text text not null,
  cond jsonb not null default '{}',
  priority integer not null default 0,
  hint text,
  active boolean not null default true
);

-- ── 플레이 기록 ──
create sequence if not exists public.life_world_seq;

create table if not exists public.life_runs (
  id bigint generated always as identity primary key,
  channel_id text not null references public.users (channel_id) on delete cascade,
  world_no integer,                         -- 평행세계 번호(테스트 판은 null)
  is_test boolean not null default false,
  house text not null references public.life_houses (id),
  spent integer not null default 0,         -- 이 판에 쓴 포인트 합
  status text not null default 'playing' check (status in ('playing', 'ended')),
  age integer not null default 0,
  stats jsonb not null,
  flags text[] not null default '{}',
  job text,                                 -- 현재 직업 id(학생 시기는 'student')
  job_history jsonb not null default '[]',  -- [{"id","name","age"}]
  seen text[] not null default '{}',        -- 한 번만 나오는 이벤트 중 이미 겪은 것
  log jsonb not null default '[]',          -- [{"age","kind","text","delta","hl"}]
  diary jsonb not null default '[]',        -- [{"age","text"}]
  pending jsonb,                            -- 지금 기다리는 갈림길 {"id","text","choices":[{"key","text","hint"}]}
  items_used integer not null default 0,
  ending jsonb,
  kst_date date not null default (now() at time zone 'Asia/Seoul')::date,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists life_runs_user_idx on public.life_runs (channel_id, created_at desc);
create index if not exists life_runs_today_idx on public.life_runs (kst_date, ended_at desc) where status = 'ended';
create unique index if not exists life_runs_one_playing on public.life_runs (channel_id) where status = 'playing';

create table if not exists public.life_collection (
  channel_id text not null references public.users (channel_id) on delete cascade,
  is_test boolean not null default false,
  kind text not null check (kind in ('job', 'modifier', 'event', 'special')),
  ref_id text not null,
  first_run_id bigint references public.life_runs (id) on delete set null,
  first_at timestamptz not null default now(),
  primary key (channel_id, is_test, kind, ref_id)
);

do $$
declare t text;
begin
  foreach t in array array['life_settings','life_houses','life_items','life_jobs','life_modifiers','life_finales',
                           'life_events','life_special_endings','life_runs','life_collection'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.life_world_seq from anon, authenticated;

-- ── 내부 도우미 ──
create or replace function public.life_arr(j jsonb) returns text[]
language sql immutable as $$ select coalesce(array(select jsonb_array_elements_text(j)), '{}') $$;

create or replace function public.life_cond_ok(c jsonb, st jsonb, fl text[], job text, hist text[], house text)
returns boolean language plpgsql immutable as $$
declare k text; v jsonb;
begin
  if c is null or c = '{}'::jsonb then return true; end if;
  if c ? 'min' then
    for k, v in select * from jsonb_each(c->'min') loop
      if coalesce((st->>k)::int, 0) < v::int then return false; end if;
    end loop;
  end if;
  if c ? 'max' then
    for k, v in select * from jsonb_each(c->'max') loop
      if coalesce((st->>k)::int, 0) > v::int then return false; end if;
    end loop;
  end if;
  if c ? 'flags' and not (fl @> public.life_arr(c->'flags')) then return false; end if;
  if c ? 'anyflags' and not (fl && public.life_arr(c->'anyflags')) then return false; end if;
  if c ? 'noflags' and (fl && public.life_arr(c->'noflags')) then return false; end if;
  if c ? 'job' and (job is null or not (job = any(public.life_arr(c->'job')))) then return false; end if;
  if c ? 'nojob' and job is not null and job = any(public.life_arr(c->'nojob')) then return false; end if;
  if c ? 'hadjob' and not (hist && public.life_arr(c->'hadjob')) then return false; end if;
  if c ? 'house' and not (house = any(public.life_arr(c->'house'))) then return false; end if;
  return true;
end $$;

create or replace function public.life_stat_label(k text) returns text
language sql immutable as $$
  select case k when 'health' then '건강' when 'intel' then '지능' when 'charm' then '매력'
                when 'wealth' then '재산' when 'happy' then '행복' when 'talent' then '끼' else k end
$$;

-- 능력치 변화 적용(0~100으로 자름) → 새 능력치와 "행복 +4 · 재산 −3" 같은 표시용 문구.
create or replace function public.life_apply_stats(st jsonb, d jsonb, out stats jsonb, out delta text)
language plpgsql immutable as $$
declare k text; v jsonb; cur int; nxt int; parts text[] := '{}';
begin
  stats := st;
  if d is null then delta := ''; return; end if;
  for k, v in select * from jsonb_each(d) loop
    cur := coalesce((stats->>k)::int, 0);
    nxt := greatest(0, least(100, cur + v::int));
    stats := jsonb_set(stats, array[k], to_jsonb(nxt));
    if nxt <> cur then
      parts := parts || (public.life_stat_label(k) || ' ' || case when nxt > cur then '+' else '−' end || abs(nxt - cur)::text);
    end if;
  end loop;
  delta := array_to_string(parts, ' · ');
end $$;

-- 판 하나의 화면용 요약(시청자에게 보내는 모양). p_from: 이 번호부터의 기록만(새로 생긴 부분).
create or replace function public.life_run_view(r public.life_runs, p_from integer default 0)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', r.id, 'worldNo', r.world_no, 'isTest', r.is_test, 'house', r.house,
    'houseName', (select name from public.life_houses where id = r.house),
    'status', r.status, 'age', r.age, 'stats', r.stats,
    'job', r.job, 'jobName', coalesce((select name from public.life_jobs where id = r.job), case r.job when 'student' then '학생' else null end),
    'itemsUsed', r.items_used, 'spent', r.spent,
    'logFrom', p_from,
    'log', coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(r.log) with ordinality as x(e, i) where i > p_from), '[]'),
    'logCount', jsonb_array_length(r.log),
    'pending', r.pending,
    'ending', r.ending,
    'jobHistory', r.job_history,
    'diary', case when r.status = 'ended' then r.diary else null end
  )
$$;

-- 갈림길이 나오거나 생을 마칠 때까지 해마다 진행. (life_start / life_choose / life_use_item 안에서만 부름)
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
    if r.age >= 50 and random() < 0.6 then
      select stats into r.stats from public.life_apply_stats(r.stats, jsonb_build_object('health', case when r.age >= 70 then -2 else -1 end));
    end if;
    -- 직업 연봉·만족도
    if r.job is not null and r.job <> 'student' and not ('retired' = any(r.flags)) and random() < 0.5 then
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
    elsif (r.stats->>'health')::int <= 5 and r.age >= 20 and random() < 0.35 then
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

-- ── 시청자가 부르는 함수 (life-game 함수에서 service_role로만) ──

-- 새 판 시작. p_test: 테스트 판(포인트 차감·하루 제한 없음) — 테스트 모드에서 주인만(함수에서 판단).
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
    base := base || jsonb_build_object(k, 35 + floor(random() * 21)::int);
  end loop;
  select stats into base from public.life_apply_stats(base, h.bonus);

  insert into public.life_runs (channel_id, world_no, is_test, house, spent, stats, flags, log)
  values (p_channel_id, case when p_test then null else nextval('public.life_world_seq') end, p_test, h.id,
          case when p_test then 0 else h.price end, base, array['house_' || h.id],
          jsonb_build_array(jsonb_build_object('age', 0, 'kind', 'life', 'text', h.name || '에서 유진이 태어났다.', 'delta', '', 'hl', false)))
  returning id into rid;

  perform public.life_advance(rid);
  select * into r from public.life_runs where id = rid;
  return jsonb_build_object('run', public.life_run_view(r, 0), 'balance', (select balance from public.users where channel_id = p_channel_id));
end $$;

-- 갈림길 선택. p_from: 화면이 이미 받은 기록 수(그 뒤 새 기록만 돌려줌).
create or replace function public.life_choose(p_channel_id text, p_run_id bigint, p_key text, p_from integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.life_runs; ev public.life_events; c jsonb; res record;
begin
  select * into r from public.life_runs where id = p_run_id and channel_id = p_channel_id for update;
  if not found or r.status <> 'playing' or r.pending is null then return jsonb_build_object('error', 'no_pending'); end if;
  select * into ev from public.life_events where id = r.pending->>'id';
  select x into c from jsonb_array_elements(ev.choices) x where x->>'key' = p_key;
  if c is null then return jsonb_build_object('error', 'bad_choice'); end if;

  select * into res from public.life_apply_stats(r.stats, c->'effects'->'stats');
  r.flags := array(select distinct x from unnest(r.flags || public.life_arr(c->'effects'->'add')) x
                   where not (x = any(public.life_arr(c->'effects'->'remove'))));
  update public.life_runs set
    stats = res.stats, flags = r.flags, pending = null,
    log = log || jsonb_build_object('age', r.age, 'kind', 'choice', 'text', ev.text || ' → ' || coalesce(c->>'result', c->>'text'), 'delta', res.delta, 'hl', true),
    diary = case when c ? 'diary' then diary || jsonb_build_object('age', r.age, 'text', c->>'diary') else diary end
  where id = r.id;

  perform public.life_advance(r.id);
  select * into r from public.life_runs where id = p_run_id;
  return jsonb_build_object('run', public.life_run_view(r, p_from));
end $$;

-- 보호자 아이템. 진행 중(갈림길 대기 포함)에만, 한 판에 item_limit회까지.
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
  select * into res from public.life_apply_stats(r.stats, it.effects->'stats');
  update public.life_runs set
    stats = res.stats,
    flags = array(select distinct x from unnest(flags || public.life_arr(it.effects->'add')) x where not (x = any(public.life_arr(it.effects->'remove')))),
    items_used = items_used + 1,
    spent = spent + case when is_test then 0 else it.price end,
    log = log || jsonb_build_object('age', r.age, 'kind', 'item', 'text', it.log_text, 'delta', res.delta, 'hl', false)
  where id = r.id;
  select * into r from public.life_runs where id = p_run_id;
  return jsonb_build_object('run', public.life_run_view(r, p_from), 'balance', (select balance from public.users where channel_id = p_channel_id));
end $$;

-- 로비 화면 한 번에: 설정·집·아이템·진행 중인 판·오늘 남은 횟수·도감 요약·오늘의 유진들·지난 판.
create or replace function public.life_lobby(p_channel_id text, p_test boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.life_settings; r public.life_runs; used int;
begin
  select * into s from public.life_settings;
  select * into r from public.life_runs where channel_id = p_channel_id and status = 'playing';
  select count(*) into used from public.life_runs
   where channel_id = p_channel_id and not is_test and kst_date = (now() at time zone 'Asia/Seoul')::date;
  return jsonb_build_object(
    'isOpen', s.is_open, 'isTest', p_test, 'dailyLimit', s.daily_limit, 'usedToday', used, 'itemLimit', s.item_limit,
    'nextWorldNo', (select coalesce(max(world_no), 0) + 1 from public.life_runs),
    'myRuns', (select count(*) from public.life_runs where channel_id = p_channel_id and status = 'ended' and is_test = p_test),
    'balance', (select balance from public.users where channel_id = p_channel_id),
    'houses', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'bonus', bonus) order by sort) from public.life_houses),
    'items', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'effects', effects->'stats') order by sort) from public.life_items),
    'playing', case when r.id is null then null else public.life_run_view(r, 0) end,
    'last', (select jsonb_build_object('id', id, 'title', ending->>'title', 'worldNo', world_no) from public.life_runs
              where channel_id = p_channel_id and status = 'ended' and is_test = p_test order by ended_at desc limit 1),
    'dex', jsonb_build_object(
      'got', (select count(*) from public.life_collection where channel_id = p_channel_id and is_test = p_test),
      'total', (select count(*) from public.life_jobs where active) + (select count(*) from public.life_modifiers where active)
             + (select count(*) from public.life_events where active and kind = 'rare') + (select count(*) from public.life_special_endings where active)),
    'today', coalesce((select jsonb_agg(t) from (
      select jsonb_build_object('id', lr.id, 'worldNo', lr.world_no, 'title', lr.ending->>'title', 'age', (lr.ending->>'age')::int,
               'special', lr.ending->>'specialId' is not null,
               'channelName', case when u.is_public then u.channel_name else null end) t
        from public.life_runs lr join public.users u on u.channel_id = lr.channel_id
       where lr.status = 'ended' and lr.is_test = p_test and lr.kst_date = (now() at time zone 'Asia/Seoul')::date
       order by lr.ended_at desc limit 20) x), '[]'),
    'todayCount', (select count(*) from public.life_runs where status = 'ended' and is_test = p_test and kst_date = (now() at time zone 'Asia/Seoul')::date)
  );
end $$;

-- 도감: 종류별 전체 목록 + 내가 모은 것(못 모은 건 이름 대신 힌트).
create or replace function public.life_dex(p_channel_id text, p_test boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (select kind, ref_id, first_at from public.life_collection where channel_id = p_channel_id and is_test = p_test)
  select jsonb_build_object(
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'category', j.category,
              'name', case when m.ref_id is not null then j.name end, 'hint', case when m.ref_id is null then j.hint end, 'gotAt', m.first_at)
              order by j.category, j.name) from public.life_jobs j left join mine m on m.kind = 'job' and m.ref_id = j.id where j.active), '[]'),
    'modifiers', coalesce((select jsonb_agg(jsonb_build_object('id', x.id,
              'name', case when m.ref_id is not null then x.text end, 'hint', case when m.ref_id is null then x.hint end, 'gotAt', m.first_at)
              order by x.priority desc, x.id) from public.life_modifiers x left join mine m on m.kind = 'modifier' and m.ref_id = x.id where x.active), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id,
              'name', case when m.ref_id is not null then e.text end, 'hint', case when m.ref_id is null then e.hint end, 'gotAt', m.first_at)
              order by e.id) from public.life_events e left join mine m on m.kind = 'event' and m.ref_id = e.id where e.active and e.kind = 'rare'), '[]'),
    'specials', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id,
              'name', case when m.ref_id is not null then sp.title end, 'hint', case when m.ref_id is null then sp.hint end, 'gotAt', m.first_at)
              order by sp.priority desc, sp.id) from public.life_special_endings sp left join mine m on m.kind = 'special' and m.ref_id = sp.id where sp.active), '[]')
  )
$$;

-- 지난 판 리포트(본인 것만).
create or replace function public.life_get_run(p_channel_id text, p_run_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.life_run_view(r, 0) from public.life_runs r where r.id = p_run_id and r.channel_id = p_channel_id
$$;

do $$
declare f text;
begin
  foreach f in array array['life_arr(jsonb)','life_cond_ok(jsonb,jsonb,text[],text,text[],text)','life_stat_label(text)',
    'life_apply_stats(jsonb,jsonb)','life_run_view(public.life_runs,integer)','life_advance(bigint)',
    'life_start(text,text,boolean)','life_choose(text,bigint,text,integer)','life_use_item(text,bigint,text,integer)',
    'life_lobby(text,boolean)','life_dex(text,boolean)','life_get_run(text,bigint)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── 기본 설정값 ──
insert into public.life_houses (id, name, price, bonus, sort) values
  ('poor',   '단칸방',      0,    '{}', 1),
  ('normal', '평범한 가정', 300,  '{"wealth":10,"happy":5}', 2),
  ('comfy',  '여유 있는 집', 1000, '{"wealth":25,"intel":5,"happy":5}', 3),
  ('rich',   '재벌가',      3000, '{"wealth":50,"intel":10,"happy":-5}', 4)
on conflict (id) do nothing;

insert into public.life_items (id, name, price, effects, log_text, sort) values
  ('allowance', '용돈',  200, '{"stats":{"wealth":6,"happy":4}}', '보호자가 용돈을 챙겨줬다.', 1),
  ('tutor',     '과외',  300, '{"stats":{"intel":8,"happy":-1}}', '보호자가 과외 선생님을 붙여줬다.', 2),
  ('hospital',  '병원',  500, '{"stats":{"health":15},"remove":["sick"]}', '보호자 손에 이끌려 병원에 다녀왔다.', 3)
on conflict (id) do nothing;
