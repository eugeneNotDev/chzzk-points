-- overlay.html이 OBS에서 spend_events를 실시간으로 구독하려면, 이 테이블이
-- Supabase Realtime의 publication에 등록돼있어야 함 (RLS로 읽기 허용하는 것과는 별개).

alter publication supabase_realtime add table spend_events;
