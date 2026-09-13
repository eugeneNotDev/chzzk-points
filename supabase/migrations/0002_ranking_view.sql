-- 랭킹 집계용 view.
--
-- points_ledger는 원장 원본이라 RLS로 anon 접근을 완전히 막아뒀다 (0001_init.sql).
-- 랭킹은 "공개 설정(is_public)한 유저의 합계"만 보여주면 되니까, 그 조건으로 미리
-- 걸러서 집계해주는 view를 하나 만들고 이 view만 anon이 읽을 수 있게 권한을 연다.
--
-- view는 만든 사람(관리자 role)의 권한으로 기반 테이블을 읽기 때문에, points_ledger의
-- RLS를 우회해서 집계할 수 있다 — 대신 view 정의 자체에서 is_public = true로 걸러뒀으므로
-- 비공개 유저의 포인트가 새어나가진 않는다.

create view public.ranking as
select
  u.channel_id,
  u.channel_name,
  coalesce(sum(pl.amount), 0)::bigint as total_points
from users u
left join points_ledger pl on pl.channel_id = u.channel_id
where u.is_public = true
group by u.channel_id, u.channel_name
order by total_points desc;

grant select on public.ranking to anon, authenticated;
