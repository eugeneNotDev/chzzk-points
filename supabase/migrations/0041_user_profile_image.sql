-- 치지직 프로필(채널) 이미지를 사이트 프로필 사진으로 씀(모바일 상단바/더보기/사이드바의 동그란 아바타).
-- 치지직 로그인 응답(users/me)엔 이미지가 없어서, 로그인할 때와 /me를 부를 때(마지막 확인 후 6시간 지났으면)
-- 치지직 공식 Open API "채널 정보 조회"(GET /open/v1/channels)로 가져와서 여기 저장해둠.
--   profile_image_url: 이미지 주소. 치지직에서 기본 이미지를 쓰는 채널이면 null(화면은 이름 첫 글자로 대신 보여줌).
--   profile_image_checked_at: 마지막으로 치지직에 물어본 시각(너무 자주 안 물어보게).
alter table public.users add column if not exists profile_image_url text;
alter table public.users add column if not exists profile_image_checked_at timestamptz;
