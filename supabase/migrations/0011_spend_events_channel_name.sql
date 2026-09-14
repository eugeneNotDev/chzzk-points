-- spend_events에 channel_name 스냅샷 추가. overlay.html이 "OOO님이 XX 사용!"을 보여주려면
-- 이름이 필요한데, 지금까지는 channel_id만 있어서 오버레이에 치지직 ID 원문이 그대로
-- 노출되고 있었다 (spend-points 함수가 이제 지급 시점의 channel_name을 같이 기록함).
alter table public.spend_events add column if not exists channel_name text;
