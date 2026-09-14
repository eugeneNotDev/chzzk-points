-- 관리자 페이지(유저 밴, 공지 수정) 기능을 위한 스키마 변경.

-- 밴 여부. 밴되면: (1) 재로그인 차단(oauth-callback에서 체크), (2) 랭킹에서 제외(아래 뷰).
alter table public.users add column if not exists banned boolean not null default false;

-- 공지사항 수정 시각(수정 기능 추가로 필요).
alter table public.notices add column if not exists updated_at timestamptz not null default now();

-- 밴된 유저는 랭킹에서 아예 제외 (비공개 마스킹과 달리, 밴은 목록에서 빠지는 것 자체가 목적).
create or replace view public.ranking as
select
  u.channel_id,
  case when u.is_public then u.channel_name else '비공개' end as channel_name,
  coalesce(sum(pl.amount), 0) as total_points,
  u.is_public
from users u
left join points_ledger pl on pl.channel_id = u.channel_id
where u.banned = false
group by u.channel_id, u.channel_name, u.is_public
order by total_points desc;

grant select on public.ranking to anon, authenticated;
