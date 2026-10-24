-- 방송 알림 3/4: 방송이 켜지면 push 함수를 부르는 트리거 함수
create or replace function public.notify_live_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.closed_at is null and new.opened_at > now() - interval '30 minutes' then
    perform net.http_post(
      url := 'https://azowisiuyeohhfxxmewb.supabase.co/functions/v1/push',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-push-key', (select value from public.app_secrets where name = 'push_key')),
      body := jsonb_build_object('action', 'live', 'openDate', new.open_date)
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_live_push() from public, anon, authenticated;
