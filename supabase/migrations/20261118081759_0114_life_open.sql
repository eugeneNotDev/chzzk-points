-- 우진 키우기 정식 공개: 공개 전환 + 테스트 판·테스트 도감·투표 기록 정리 + 방송 모드 연결 해제
update public.life_settings set is_open = true, live_life_id = null, vote_open = false, vote_round = null;
delete from public.life_votes;
delete from public.life_found where is_test;
delete from public.life_lives where is_test;
