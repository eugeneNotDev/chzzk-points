-- 수퍼베이스 점검(advisors) 권장 사항 반영
-- 1) 트리거 함수의 search_path 고정(보안 권장)
alter function public.monthly_title_bonus() set search_path = public;
-- 2) 외래키 칸 색인 — 유저 삭제·조인 때 전체를 훑지 않게(지금은 표가 작아 체감은 없음)
create index if not exists board_comment_likes_channel_idx on public.board_comment_likes (channel_id);
create index if not exists board_comments_reply_to_idx on public.board_comments (reply_to_id);
create index if not exists board_comments_channel_idx on public.board_comments (channel_id);
create index if not exists board_post_likes_channel_idx on public.board_post_likes (channel_id);
create index if not exists board_review_rewards_post_idx on public.board_review_rewards (post_id);
create index if not exists life_votes_channel_idx on public.life_votes (channel_id);
create index if not exists monthly_champions_channel_idx on public.monthly_champions (channel_id);
create index if not exists mystery_bets_channel_idx on public.mystery_bets (channel_id);
create index if not exists mystery_votes_channel_idx on public.mystery_votes (channel_id);
create index if not exists prediction_bets_channel_idx on public.prediction_bets (channel_id);
create index if not exists prediction_bets_option_idx on public.prediction_bets (option_id);
create index if not exists predictions_winning_option_idx on public.predictions (winning_option_id);
create index if not exists quiz_exam_submissions_channel_idx on public.quiz_exam_submissions (channel_id);
create index if not exists quiz_ox_answers_channel_idx on public.quiz_ox_answers (channel_id);
create index if not exists shop_items_grants_title_idx on public.shop_items (grants_title_id);
create index if not exists user_purchased_titles_title_idx on public.user_purchased_titles (title_id);
create index if not exists users_selected_special_idx on public.users (selected_special_id);
