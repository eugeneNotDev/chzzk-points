-- 룰렛 x10 0.1% → 0.05%(2,000번에 1번). 줄인 만큼 x1로. 기대값 약 0.966 → 0.961
update public.roulette_outcomes set weight = 5 where multiplier = 10;
update public.roulette_outcomes set weight = 4705 where multiplier = 1;
