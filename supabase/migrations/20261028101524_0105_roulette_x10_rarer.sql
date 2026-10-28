-- 0105 — 룰렛 x10 확률 절반으로(0.2% → 0.1%). 기댓값(96.55%)은 그대로 두려고 x0을 조금 줄이고 x2를 조금 늘림
update public.roulette_outcomes set weight = case multiplier when 10 then 10 when 0 then 960 when 2 then 350 else weight end where multiplier in (10, 0, 2);
