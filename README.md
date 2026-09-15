# chzzk-points

치지직 방송용 시참 포인트 시스템. 시청자가 채팅/출석/후원으로 포인트를 모으고, 모은 포인트를 소모처에 써서 방송에 실시간으로 개입함.

기획 전체 내용(요구사항, 결정 사항, 로드맵, 열린 질문)은 Notion 페이지에 있음 — 이 저장소는 실제 코드만 담음.

## 폴더 구조

```
chzzk-points/
├── docs/                       # GitHub Pages가 서빙하는 프론트엔드 (순수 HTML/CSS/JS, 빌드 도구 없음)
│   ├── index.html              # 로그인 랜딩 + OAuth 콜백 처리
│   ├── mypage.html             # 마이페이지 (공개 설정, 현재 포인트, 칭호 장착)
│   ├── ranking.html            # 포인트 랭킹
│   ├── shop.html               # 포인트 상점 (일반 상품 + 구매형 칭호)
│   ├── attendance.html         # 출석체크
│   ├── notice.html             # 공지사항
│   ├── admin.html              # 관리자 페이지 (유저 검색/포인트 지급·차감/밴, 공지·상품 관리)
│   ├── overlay.html            # OBS 브라우저 소스용 오버레이 (Realtime 구독)
│   └── assets/
│       ├── css/style.css
│       ├── img/, audio/        # 브랜드 이미지, 오버레이 알림음 등 정적 리소스
│       └── js/
│           ├── supabase-client.js  # Supabase 클라이언트 초기화 (URL/anon key만, 시크릿 없음)
│           ├── chzzk-auth.js       # 치지직 로그인 흐름 + 세션 토큰(localStorage) 관리
│           └── spa-router.js       # 사이드바 안 링크 클릭 시 깜빡임 없이 전환해주는 경량 라우터
│
├── supabase/
│   ├── functions/
│   │   ├── _shared/            # 모든 함수가 공통으로 쓰는 CORS·세션 토큰·설정·라이브 여부 조회 로직
│   │   ├── oauth-callback/     # 치지직 OAuth code → 토큰 교환 (clientSecret 사용), 세션 토큰 발급
│   │   ├── me/                 # 본인 프로필 + 포인트 잔액 + 포인트 로그 + 칭호 조회/수정
│   │   ├── spend-points/       # 포인트 사용: 잔액 확인 → 차감 → 이벤트 기록 (칭호 상품 지급 포함)
│   │   ├── attendance-check/   # 방송 중 최초 접속 출석 체크 보너스 지급
│   │   ├── notices/            # 공지사항 작성/수정/삭제 (관리자 전용, 읽기는 프론트에서 anon으로 직접 조회)
│   │   ├── shop-items/         # 포인트 상점 상품 관리 (관리자 전용 등록/수정/삭제)
│   │   ├── broadcast-status/   # 지금 방송 중인지 여부 조회
│   │   └── admin/              # 관리자 전용 기능 (유저 검색, 포인트 지급·차감, 밴, 포인트 로그 조회)
│   └── migrations/             # DB 스키마 변경 이력 (SQL, RLS 포함)
│
└── .env.example                # 로컬 개발용 환경변수 예시 (실제 시크릿은 절대 커밋하지 않음)
```

## 원칙

- 프론트엔드(`docs/`)는 빌드 도구 없이 그대로 GitHub Pages가 서빙함. `<script>` 태그로 Supabase JS 클라이언트를 불러와 직접 호출함.
- `clientSecret`, Supabase `service_role` 키 등 시크릿은 절대 `docs/` 아래 어떤 파일에도 들어가지 않음. 전부 `supabase/functions/`(Edge Functions) 쪽에서만, Supabase 프로젝트의 환경변수로 관리함.
- DB · 실시간 통신(Realtime) · Edge Functions는 전부 Supabase 프로젝트 하나에 모여 있음.
- 로컬 상시 채팅/후원 리스너 프로그램(방송 중에만 실행)은 기존에 만들어둔 것을 그대로 확장해서 씀 — 이 저장소로 옮길지는 나중에 결정.
- 로그인 세션은 쿠키가 아니라 **토큰 방식**임. 프론트(GitHub Pages)와 API(Supabase Edge Functions)가 서로 다른 도메인이라, 크로스 도메인 쿠키(사파리 등에서 자주 막히거나 일찍 만료됨) 대신 로그인 성공 시 발급하는 자체 세션 토큰을 `localStorage`에 저장하고 매 요청마다 `Authorization: Bearer` 헤더로 보냄.

## 상태

로그인 · 랭킹 · 출석체크 · 포인트 상점(일반 상품 + 구매/성취형 칭호) · 공지사항 · 관리자 페이지 · OBS 오버레이까지 전부 구현되어 운영 중.
