-- 데이터 백업: 무료 플랜은 Supabase 자동 백업이 없어서, admin-backup 함수가 주요 테이블을 JSON(gzip)으로 묶어
-- 비공개 버킷(backups)에 저장함. 매주 월요일 05:13(한국 시간)에 자동 실행 + 관리자 페이지에서 수동 실행/다운로드.
--
-- 예약 작업이 함수에 붙여 보내는 비밀 키(app_secrets.backup_key)는 저장소에 남기지 않으려고 이 파일이 아니라
-- DB에서 직접 만들었음:  insert into app_secrets(name, value) values ('backup_key', <무작위 값>);

insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do nothing;

select cron.schedule(
  'weekly-backup',
  '13 20 * * 0',   -- UTC 일요일 20:13 = 한국 시간 월요일 05:13
  $$ select net.http_post(
       url := 'https://azowisiuyeohhfxxmewb.supabase.co/functions/v1/admin-backup',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-backup-key', (select value from public.app_secrets where name = 'backup_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
