-- DB에는 적용돼 있었는데 저장소에 파일이 없던 변경 — DB 기록(supabase_migrations)에서 그대로 옮겨옴.
-- 랭킹 뷰: 특수 칭호(지난달 1위 + 관리자가 준 칭호)를 뷰 안에서 바로 묶어서 보여줌
create or replace view public.ranking as
 WITH champ AS (
   SELECT u2.channel_id AS cid
   FROM users u2
   CROSS JOIN (SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS m) b
   LEFT JOIN LATERAL (
     SELECT COALESCE(sum(l.amount), 0) AS s
     FROM points_ledger l
     WHERE l.channel_id = u2.channel_id AND l.created_at >= b.m
   ) x ON true
   WHERE now() >= timestamptz '2026-11-01 00:00:00+09'
     AND u2.banned = false
     AND u2.channel_id <> '37a1acfaa35d56311bf428dc96142e9f'
     AND (u2.balance - x.s) > 0
   ORDER BY (u2.balance - x.s) DESC, u2.created_at ASC
   LIMIT 1
 ), sp AS (
   SELECT i.channel_id,
          jsonb_agg(jsonb_build_object('name', i.name, 'color', i.color) ORDER BY i.ord, i.sid) AS titles
   FROM (
     SELECT c.cid AS channel_id, 0 AS ord, 0::bigint AS sid, '지난달 1위'::text AS name, 'shine-crown-d4af37'::text AS color FROM champ c
     UNION ALL
     SELECT s.channel_id, 1, s.id, s.name, s.color FROM user_special_titles s
   ) i
   GROUP BY i.channel_id
 )
 SELECT
        CASE
            WHEN u.is_public THEN u.channel_id
            ELSE u.rank_key::text
        END AS channel_id,
        CASE
            WHEN u.is_public THEN u.channel_name
            ELSE '비공개'::text
        END AS channel_name,
    u.balance AS total_points,
    u.is_public,
        CASE
            WHEN u.is_public THEN tier.name
            ELSE NULL::text
        END AS tier_title_name,
        CASE
            WHEN u.is_public THEN tier.color
            ELSE NULL::text
        END AS tier_title_color,
        CASE
            WHEN u.is_public THEN shop.name
            ELSE NULL::text
        END AS shop_title_name,
        CASE
            WHEN u.is_public THEN shop.color
            ELSE NULL::text
        END AS shop_title_color,
        CASE
            WHEN u.is_public THEN sp.titles
            ELSE NULL::jsonb
        END AS special_titles
   FROM users u
     LEFT JOIN LATERAL ( SELECT t.name,
            t.color
           FROM titles t
          WHERE t.kind = 'tier'::text AND t.min_points <= u.max_balance_reached
          ORDER BY t.min_points DESC
         LIMIT 1) tier ON true
     LEFT JOIN titles shop ON shop.id = u.selected_title_id
     LEFT JOIN sp ON sp.channel_id = u.channel_id
  WHERE u.banned = false AND u.channel_id <> '37a1acfaa35d56311bf428dc96142e9f'::text
  ORDER BY u.balance DESC, u.created_at;
