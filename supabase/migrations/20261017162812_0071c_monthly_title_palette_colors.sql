-- DB에는 적용돼 있었는데 저장소에 파일이 없던 변경 — DB 기록(supabase_migrations)에서 그대로 옮겨옴.
-- 지난달 순위 칭호 색을 팔레트의 금·은·동(금속 광택 + 왕관)으로
create or replace function public.monthly_title_bonus()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'monthly' then
    if coalesce(new.bonus_pct, 0) = 0 then
      new.bonus_pct := case new.rank when 1 then 10 when 2 then 7 when 3 then 5 else 0 end;
    end if;
    -- 칭호 꾸미기의 "금속 광택 + 왕관 아이콘", 색은 팔레트의 금·은·동
    new.color := case new.rank when 1 then 'shine-crown-f2c230' when 2 then 'shine-crown-c9d1d9' when 3 then 'shine-crown-cd7f32' else new.color end;
  end if;
  return new;
end;
$$;
