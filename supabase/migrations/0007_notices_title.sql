-- 공지사항에 제목 컬럼 추가. 메인 페이지 미리보기 + 공지사항 탭을 "제목 목록 클릭하면 내용
-- 팝업" 게시판 스타일로 리뉴얼하면서 필요해졌다 (이전엔 title 없이 content만 있었음).
-- 기존 글들은 title이 없으니 content 앞부분을 잘라 임시 제목으로 채워준다.
alter table public.notices add column if not exists title text not null default '';

update public.notices
set title = left(content, 40)
where title = '';
