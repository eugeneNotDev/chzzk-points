-- 관리자 페이지 확장 3종에 필요한 스키마 변경 (포인트 로그 처리완료 체크 / 랭킹·공지 실시간 갱신).

-- (1) 포인트 로그 "처리완료" 체크 — 상점 사용("포인트 상점 사용: ...") 항목을 관리자가 오버레이를
-- 놓쳤을 때 포인트 로그에서 대조하면서 "이미 처리했다"고 표시해둘 수 있게 한다. 지급/차감/출석체크
-- 같은 다른 종류 로그는 그 자체가 이미 완료된 행위라 의미는 없지만, 굳이 CHECK 제약으로 막지 않고
-- 컬럼은 범용으로 두고(어떤 행이든 걸 수 있음) 화면(admin.html)에서 상점 사용 항목에만 체크박스를
-- 보여주는 식으로 처리한다.
alter table public.points_ledger add column if not exists processed boolean not null default false;

-- (2) 랭킹 실시간 갱신용 핑 테이블. points_ledger는 원장 원본이라 RLS로 익명 조회가 막혀있어서
-- (0001_init.sql 참고) 랭킹 화면이 points_ledger 변경을 직접 구독할 수 없다. 대신 이 작은 공개
-- 테이블에 트리거로 "핑"만 남기고, 프론트엔드는 이 테이블의 INSERT만 구독해서 핑이 오면 랭킹을
-- 다시 조회한다 (핑 행 자체엔 아무 정보도 안 담음 — 그냥 "뭔가 바뀜" 신호용. overlay가 spend_events를
-- 구독하는 것과 같은 패턴 — 0003_realtime_spend_events.sql 참고).
-- 참고: points_ledger가 느는 속도만큼 이 테이블도 계속 는다 — points_ledger 자체도 지금 정리
-- 안 하고 있으니(잔액 계산 근거라 지울 수도 없음) 일단 같은 정책으로 둔다. 나중에 너무 커지면
-- 오래된 행을 주기적으로 지우는 건 고려할 수 있음(신호용이라 과거 행은 의미가 없어서 지워도 안전).
create table if not exists public.ranking_pings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

alter table public.ranking_pings enable row level security;

create policy "ranking_pings_public_read" on public.ranking_pings
  for select
  using (true);

alter publication supabase_realtime add table public.ranking_pings;

create or replace function public.ping_ranking_update() returns trigger as $$
begin
  insert into public.ranking_pings default values;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

-- 트리거 전용 함수라 PostgREST가 공개 RPC로 자동 노출하면 안 됨 (0018_bugfixes.sql과 같은 이유 —
-- 트리거 실행엔 이 권한이 필요 없음, 트리거는 테이블 소유자 권한으로 돎).
revoke execute on function public.ping_ranking_update() from public, anon, authenticated;

drop trigger if exists points_ledger_ping_ranking on public.points_ledger;
create trigger points_ledger_ping_ranking
after insert on public.points_ledger
for each row execute function public.ping_ranking_update();

-- (3) 공지사항 실시간 갱신 — notices는 이미 전체 공개 읽기 정책이 있어서(0004_notices.sql)
-- publication에 추가만 하면 된다.
alter publication supabase_realtime add table public.notices;
