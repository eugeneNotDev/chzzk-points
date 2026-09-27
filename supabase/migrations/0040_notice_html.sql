-- 공지를 HTML로 꾸며서 쓸 수 있게 함(노션처럼 제목/콜아웃/토글/색 글자 등). 글쓰기 창의 "HTML로 작성"
-- 체크를 켜고 쓴 글만 true — 화면에서 이 값이 true인 글만 HTML로 그리고(DOMPurify로 위험한 태그/속성을
-- 걸러낸 뒤), 나머지는 지금처럼 글자 그대로 보여줌. 기존 글은 전부 false라 모양이 안 바뀜.
alter table public.notices add column if not exists is_html boolean not null default false;
