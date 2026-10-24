-- 포인트 상점 상품 목록. 코드/배포 없이 상품을 자주 바꿀 수 있어야 해서(가격/이름/설명 수정,
-- 방송 중 전용 여부 토글, on/off) 전부 이 테이블 데이터로 관리함 — Supabase 대시보드에서
-- 테이블 편집기로 직접 행을 수정/추가하면 바로 반영됨 (git 커밋/배포 불필요).
create table if not exists public.shop_items (
  id text primary key,                              -- 소문자-하이픈 슬러그 (spend_events.item_id로도 쓰임)
  name text not null,
  cost integer not null check (cost > 0),
  description text not null default '',
  requires_live boolean not null default false,      -- true면 방송 중일 때만 사용 가능 (attendance-check와 동일하게 _shared/live.ts로 체크)
  is_active boolean not null default true,            -- false면 상점 목록에서 숨김 (삭제 대신 비활성화)
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.shop_items enable row level security;

-- 활성화된 상품만 프론트(anon)가 직접 읽을 수 있음 (ranking view와 같은 패턴 —
-- shop.html이 Edge Function 없이 바로 조회해서 그림).
create policy "shop_items_public_read" on public.shop_items
  for select
  using (is_active = true);

-- 테스트용 첫 상품. 테스트 단계라 requires_live는 일단 false로 둠 — 방송 안 켜져있어도
-- 오버레이 알림이 뜨는지 확인할 수 있게. 실제 운영 전환할 때 필요한 상품들만
-- requires_live = true로 바꾸면 됨 (테이블 편집기에서 체크박스 하나 토글).
insert into public.shop_items (id, name, cost, description, requires_live, is_active, sort_order)
values ('water', '물 마시기', 100, '스트리머가 물을 마셔요.', false, true, 1)
on conflict (id) do nothing;
