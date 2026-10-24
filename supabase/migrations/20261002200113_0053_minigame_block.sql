-- 미니게임 차단 — 관리자가 특정 유저의 룰렛·가위바위보·홀짝 참여를 기간을 정해 막을 수 있음(무료 뽑기·투표는 그대로).
-- minigame_blocked_until: 이 시각까지 차단. null = 차단 안 됨, 'infinity' = 기간 없이 계속.
-- 판정은 각 게임 함수(roulette / rps / odd-even)가 하고, 켜고 끄기는 admin-minigame-block 함수가 함.
alter table public.users add column if not exists minigame_blocked_until timestamptz;
