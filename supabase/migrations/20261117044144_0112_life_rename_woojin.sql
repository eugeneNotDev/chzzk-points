-- 유진 키우기 → 우진 키우기 이름 변경(포인트 기록 문구).
-- life_begin·life_pay·life_donate 함수 본문의 문구만 바꿔서 다시 만들고, 이미 남은 기록 문구도 바꿈.
do $$
declare
  f text;
begin
  foreach f in array array['life_begin', 'life_pay', 'life_donate'] loop
    execute replace(pg_get_functiondef(('public.' || f)::regproc), '유진 키우기', '우진 키우기');
  end loop;
end $$;

update public.points_ledger set reason = replace(reason, '유진 키우기', '우진 키우기') where reason like '유진 키우기%';
