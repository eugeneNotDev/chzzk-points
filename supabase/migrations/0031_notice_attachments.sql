-- 공지사항 첨부파일(이미지 갤러리 + 일반 파일 다운로드). 네이버카페처럼 글 작성 시
-- 이미지/파일을 같이 올릴 수 있게 함 (나중에 스케줄표 등을 이미지로 올릴 일이 있어서 추가).
--
-- 업로드 자체는 Storage signed upload URL로 클라이언트가 직접 올리고(용량이 큰 파일을
-- Edge Function 요청 본문에 base64로 태워 보내지 않으려고 — supabase/functions/notices
-- 참고), 이 테이블엔 업로드가 끝난 뒤 메타데이터만 기록함. notices와 마찬가지로 쓰기는
-- service_role(Edge Function)만 가능 — 이 프로젝트는 Supabase Auth를 안 써서 RLS로
-- "관리자인지"를 못 가리기 때문(각 파일 상단 주석 참고).

create table if not exists notice_attachments (
  id bigint generated always as identity primary key,
  notice_id bigint not null references notices(id) on delete cascade,
  kind text not null check (kind in ('image', 'file')),
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists notice_attachments_notice_id_idx on notice_attachments(notice_id);

alter table notice_attachments enable row level security;

create policy "notice_attachments_public_read" on notice_attachments
  for select
  using (true);

-- insert/update/delete: 정책 없음 = anon/authenticated 전부 불가, service_role(Edge Function)만 가능.

-- notice.html의 실시간 구독은 notices 테이블 변경만 보고 있고(글 생성/수정 시 항상 notices
-- 행도 같이 바뀌니 그걸로 충분), 여기 추가는 혹시 모를 확장(첨부파일만 따로 건드리는 경우)을
-- 대비한 것 — 0019_admin_features.sql의 notices 추가와 같은 패턴.
alter publication supabase_realtime add table public.notice_attachments;

-- Storage 버킷 — 공개 읽기(퍼블릭 URL로 바로 접근 가능), 쓰기는 Edge Function이
-- service_role로 signed upload URL을 발급해주는 방식이라 버킷 자체엔 RLS 정책을 안 둠
-- (signed upload URL은 RLS와 별개로 그 경로 하나에 대한 임시 업로드 권한을 직접 부여함).
-- allowed_mime_types는 비워둠 — hwp 등 브라우저가 MIME을 일관되게 못 주는 파일 형식이 있어서
-- 확장자 기준 검증은 Edge Function(notices/index.ts)에서 함.
insert into storage.buckets (id, name, public, file_size_limit)
values ('notice-attachments', 'notice-attachments', true, 20971520)
on conflict (id) do nothing;
