-- 게시판 사진 저장소는 이미지 파일만(크기 5MB는 이미 설정됨) — 보안 점검(2026-10-20)
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
where id = 'board-images';
