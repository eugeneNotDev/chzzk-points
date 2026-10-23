-- 유진 키우기 v1/v2 정리: 인생 진행이 서버 함수(life-game)로 옮겨가서 안 쓰는 옛 테이블·함수 삭제.
-- 남기는 것: life_settings, life_houses(가격·능력치 보너스), life_lives, life_found, life_world_seq(세계 번호), life_begin, life_pay
drop function if exists public.life_advance(bigint);
drop function if exists public.life_start(text, text, boolean);
drop function if exists public.life_choose(text, bigint, text, integer);
drop function if exists public.life_use_item(text, bigint, text, integer);
drop function if exists public.life_lobby(text, boolean);
drop function if exists public.life_dex(text, boolean);
drop function if exists public.life_get_run(text, bigint);
drop function if exists public.life_reset_test(text);
drop function if exists public.life_run_view(public.life_runs, integer);
drop function if exists public.life_plan_pending(integer, text);
drop function if exists public.life_hist_row(integer, jsonb);
drop function if exists public.life_apply(jsonb, jsonb);
drop function if exists public.life_apply_stats(jsonb, jsonb);
drop function if exists public.life_cond_ok(jsonb, jsonb, text[], text, text[], text);
drop function if exists public.life_stat_label(text);
drop function if exists public.life_arr(jsonb);

drop table if exists public.life_collection;
drop table if exists public.life_runs;
drop table if exists public.life_items;
drop table if exists public.life_jobs;
drop table if exists public.life_modifiers;
drop table if exists public.life_finales;
drop table if exists public.life_events;
drop table if exists public.life_special_endings;
drop table if exists public.life_focuses;
