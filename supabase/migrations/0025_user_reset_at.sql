-- 밴 처리 시 계정을 초기화한 시각을 기록함(요청사항: "밴 했다가 풀었을 때 포인트/칭호는 다
-- 초기화됐는데 마이페이지 포인트 내역 로그는 그대로 남아있다" — 로그도 같이 비워달라는 것).
-- points_ledger 행 자체는 여전히 지우지 않음(잔액 계산 근거 + 관리자 감사 기록 보존 — 이전
-- 마이그레이션들과 같은 원칙). 대신 이 시각을 기준으로 me/index.ts의 "본인 포인트 로그" 조회가
-- reset_at 이전 기록은 걸러서 안 보여줌 — 유저 입장에선 로그가 비워진 것처럼 보이지만, 관리자용
-- 로그(admin/index.ts의 list-points-log / get-user-detail)는 이 필터 없이 항상 전체를 봄.
alter table public.users
  add column if not exists reset_at timestamptz;
