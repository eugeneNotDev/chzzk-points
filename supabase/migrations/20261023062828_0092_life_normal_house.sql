-- 유진 키우기: 평범한 가정(300P) 혜택 강화 — 태어날 때 능력치 보너스 행복+5 → 건강+4·매력+4·행복+5
-- (용돈·등록금 지원·독립 지원금·유산·엄마 아빠와의 사이는 life-game/content.ts HOUSES에서 같이 올림)
update public.life_houses set bonus = '{"health":4,"charm":4,"happy":5}'::jsonb where id = 'normal';
