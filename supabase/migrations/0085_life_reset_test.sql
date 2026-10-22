-- 유진 키우기: 테스트 기록 초기화(테스트 페이지의 버튼) — 그 계정의 테스트 판·테스트 도감만 지움. 실제 판은 건드리지 않음.
create or replace function public.life_reset_test(p_channel_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.life_collection where channel_id = p_channel_id and is_test;
  delete from public.life_runs where channel_id = p_channel_id and is_test;
  get diagnostics n = row_count;
  return jsonb_build_object('deletedRuns', n);
end $$;
revoke all on function public.life_reset_test(text) from public, anon, authenticated;
grant execute on function public.life_reset_test(text) to service_role;
