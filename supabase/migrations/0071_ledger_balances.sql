-- 잔액 표시 + 지난달 순위 칭호 모양 (0070 이어서)
--  · ledger_balance_after(ids): 포인트 기록 줄마다 "그 줄이 반영된 직후 잔액" — 관리자 포인트 로그·유저 상세에서 씀.
--  · ledger_balance_at(channel, times): 그 시각 잔액 — 미니게임 최근 기록에서 씀(게임 기록과 포인트 기록은 같은
--    트랜잭션이라 created_at이 같음. 비김·x1처럼 포인트 기록이 없는 판도 그 시각 잔액이 나옴).
--    둘 다 ledger-balance 함수(서비스 롤)만 부름.
--  · 지난달 1~3위 칭호: 금속 광택 + 왕관 아이콘, 색은 칭호 꾸미기 팔레트의 금(f2c230)·은(c9d1d9)·동(cd7f32)(지급될 때 트리거가 맞춰 줌).

create or replace function public.ledger_balance_after(p_ids bigint[])
returns table (id bigint, channel_id text, balance_after bigint)
language sql stable security definer set search_path = public
as $$
  select l.id, l.channel_id,
         (select coalesce(sum(l2.amount), 0)
          from public.points_ledger l2
          where l2.channel_id = l.channel_id
            and (l2.created_at < l.created_at or (l2.created_at = l.created_at and l2.id <= l.id)))::bigint
  from public.points_ledger l
  where l.id = any(p_ids);
$$;

create or replace function public.ledger_balance_at(p_channel text, p_times timestamptz[])
returns table (t timestamptz, balance bigint)
language sql stable security definer set search_path = public
as $$
  select x.t,
         (select coalesce(sum(l.amount), 0) from public.points_ledger l where l.channel_id = p_channel and l.created_at <= x.t)::bigint
  from unnest(p_times) with ordinality as x(t, n)
  order by x.n;
$$;

revoke all on function public.ledger_balance_after(bigint[]) from public, anon, authenticated;
revoke all on function public.ledger_balance_at(text, timestamptz[]) from public, anon, authenticated;
grant execute on function public.ledger_balance_after(bigint[]) to service_role;
grant execute on function public.ledger_balance_at(text, timestamptz[]) to service_role;

-- 지난달 순위 칭호: 보너스(0070) + 모양(왕관 금·은·동)
create or replace function public.monthly_title_bonus()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'monthly' then
    if coalesce(new.bonus_pct, 0) = 0 then
      new.bonus_pct := case new.rank when 1 then 10 when 2 then 7 when 3 then 5 else 0 end;
    end if;
    new.color := case new.rank when 1 then 'shine-crown-f2c230' when 2 then 'shine-crown-c9d1d9' when 3 then 'shine-crown-cd7f32' else new.color end;
  end if;
  return new;
end;
$$;
