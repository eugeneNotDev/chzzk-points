-- 옛 404 화면의 숨은 주소 이벤트(pages 함수) 정리 — 새 사이트에선 안 씀.
-- 기록: 2026-10-16 냥젤리17님이 찾아서 10,000P 지급(포인트 내역은 points_ledger에 그대로 남음).
drop function if exists public.hidden_page_claim(text, text);
drop function if exists public.hidden_page_get(text);
drop table if exists public.hidden_pages;
