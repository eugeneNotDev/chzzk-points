-- 특수 칭호 적립 보너스 (0069_special_title_equip.sql 이어서)
--  · user_special_titles.bonus_pct: 이 칭호를 장착 중이면(고정 칭호는 항상) 사이트에서 버는 포인트 +n%. 0~30.
--    관리자가 특수 칭호를 줄 때 정함. 지난달 1·2·3위 칭호는 자동으로 10·7·5%.
--  · 보너스가 붙는 곳: 출석체크(10회 보너스 포함), 방송 코드, 방송 후기 보상, 게시판 활동 보상.
--    미니게임·투표 정산·후원 적립·관리자 지급·환불에는 안 붙음(게임은 이긴 돈에 붙으면 할수록 이득이 돼서).
--  · 원래 적립 바로 뒤에 "칭호 보너스 (칭호명 +n%)" 줄을 따로 남김(1P 미만은 1P로 올림).

alter table public.user_special_titles
  add column if not exists bonus_pct smallint not null default 0 check (bonus_pct between 0 and 30);

-- 지난달 순위 칭호는 지급될 때 보너스 자동 설정(월간 지급 함수는 그대로 두고 여기서 채움)
create or replace function public.monthly_title_bonus()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'monthly' and coalesce(new.bonus_pct, 0) = 0 then
    new.bonus_pct := case new.rank when 1 then 10 when 2 then 7 when 3 then 5 else 0 end;
  end if;
  return new;
end;
$$;
drop trigger if exists user_special_titles_monthly_bonus on public.user_special_titles;
create trigger user_special_titles_monthly_bonus
  before insert on public.user_special_titles
  for each row execute function public.monthly_title_bonus();

-- 포인트가 들어올 때 장착한 특수 칭호(고정 칭호 우선 — 랭킹 표시와 같은 규칙)에 보너스가 있으면 보너스 줄 추가
create or replace function public.title_bonus_on_earn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_pct int;
  v_bonus int;
begin
  if new.amount <= 0 then
    return null;
  end if;
  if not (new.reason = '출석체크'
          or new.reason like '출석체크 %'
          or new.reason like '방송 코드:%'
          or new.reason = '방송 후기 보상'
          or new.reason like '게시판 활동 보상 (%') then
    return null;
  end if;
  select s.name, s.bonus_pct into v_name, v_pct
  from public.users u
  join lateral (
    select s2.name, s2.bonus_pct
    from public.user_special_titles s2
    where s2.channel_id = u.channel_id and (s2.forced or s2.id = u.selected_special_id)
    order by s2.forced desc, s2.id desc
    limit 1
  ) s on true
  where u.channel_id = new.channel_id;
  if v_pct is null or v_pct <= 0 then
    return null;
  end if;
  v_bonus := greatest(1, round(new.amount * v_pct / 100.0)::int);
  insert into public.points_ledger (channel_id, amount, reason)
  values (new.channel_id, v_bonus, '칭호 보너스 (' || v_name || ' +' || v_pct || '%)');
  return null;
end;
$$;
revoke all on function public.title_bonus_on_earn() from public, anon, authenticated;
drop trigger if exists points_ledger_title_bonus on public.points_ledger;
create trigger points_ledger_title_bonus
  after insert on public.points_ledger
  for each row execute function public.title_bonus_on_earn();
