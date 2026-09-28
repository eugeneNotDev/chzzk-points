-- ranking_pings 자동 정리. 포인트 기록(points_ledger)이 생길 때마다 "랭킹 새로고침" 신호가 한 줄씩 쌓이는데,
-- 화면들은 새로 들어온 줄(INSERT)만 실시간으로 받고 지난 줄은 어디서도 안 씀(0019_admin_features.sql).
-- 그래서 신호를 넣을 때 100번에 1번꼴로 하루 지난 줄을 같이 지움(overlay_events와 같은 방식, 0044).

create or replace function public.ping_ranking_update() returns trigger as $$
begin
  insert into public.ranking_pings default values;
  if random() < 0.01 then
    delete from public.ranking_pings where created_at < now() - interval '1 day';
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.ping_ranking_update() from public, anon, authenticated;

-- 지금까지 쌓인 것 한 번 정리.
delete from public.ranking_pings where created_at < now() - interval '1 day';
