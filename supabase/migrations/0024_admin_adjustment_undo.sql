-- 관리자 포인트 지급/차감 실행취소 기능에 필요한 컬럼.
--
-- admin_action: 이 행이 관리자의 adjust-points/bulk-adjust-points로 생긴 행인지 표시.
-- reason 텍스트로 구분하지 않는 이유 — reason은 관리자가 자유 입력하는 값이라(admin/index.ts
-- adjustPoints/bulkAdjustPoints), 텍스트만으로는 출석체크/상점 사용/밴 초기화 등 다른 경로와
-- 안전하게 구분할 수 없음. 대신 삽입한 코드 경로 자체를 이 컬럼에 직접 표시함. 기존(과거) 행은
-- 전부 기본값 false로 남겨둠 — 어떤 게 진짜 관리자 지급/차감이었는지 지금 와서 안전하게 되짚을
-- 방법이 없어서, 실행취소 대상은 이 기능 배포 이후에 새로 생기는 행부터로 한정함.
-- undone: 이미 실행취소된 행인지(중복 취소 방지). 실행취소 자체는 반대 부호의 새 행을 추가하는
-- 방식(보정 행, 원래 행을 지우거나 고치지 않음 — 잔액 계산 근거를 훼손하지 않으려고 다른 초기화
-- 로직들과 같은 패턴을 씀)이라, 그 보정 행(admin_action=false)이 아니라 "취소당한 원본 행"에
-- 이 플래그를 세워서 같은 행을 두 번 취소 못 하게 막음.
alter table public.points_ledger
  add column if not exists admin_action boolean not null default false,
  add column if not exists undone boolean not null default false;
