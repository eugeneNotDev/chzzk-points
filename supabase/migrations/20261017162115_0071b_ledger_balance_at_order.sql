-- DB에는 적용돼 있었는데 저장소에 파일이 없던 변경 — DB 기록(supabase_migrations)에서 그대로 옮겨옴.
-- ledger_balance_at: 넘겨준 시각 순서 그대로 돌려주게(order by x.n)
create or replace function public.ledger_balance_at(p_channel text, p_times timestamptz[])
returns table (t timestamptz, balance bigint)
language sql stable security definer set search_path = public
as $$
  select x.t,
         (select coalesce(sum(l.amount), 0) from public.points_ledger l where l.channel_id = p_channel and l.created_at <= x.t)::bigint
  from unnest(p_times) with ordinality as x(t, n)
  order by x.n;
$$;
