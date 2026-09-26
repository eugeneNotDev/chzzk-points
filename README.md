# chzzk-points

치지직 방송용 시청자 포인트 시스템. 시청자가 채팅/출석/후원으로 포인트를 모으고, 모은 포인트로 상점 상품을 사거나 투표에 걸어서 방송에 직접 개입할 수 있게 만든 팬 사이트임.

기획 쪽 내용(요구사항, 결정 사항, 로드맵)은 Notion에 따로 정리해두고 이 저장소엔 코드만 둠.

## 기능

- **치지직 로그인** — 치지직 OAuth로 로그인. 로그인하면 자동으로 가입 처리됨
- **포인트 랭킹** — 보유 포인트 순위. 공개/비공개 설정 가능하고 비공개면 이름 대신 "비공개"로 나옴
- **출석체크** — 방송 중일 때만 가능, 방송 한 번에 한 번(자정 넘어가도 방송 시작일 기준). 1회 50P, 누적 10번째마다 보너스 50P 추가. 달력으로 출석한 날 표시됨
- **포인트 상점** — 일반 상품(쿨타임, 방송 중 전용, 한정 수량 설정 가능)이랑 칭호 상품 두 종류 있음. 등록한 순서대로 보임. 상품을 사면 OBS 오버레이에 알림이 뜸. 관리자는 "판매 중지"(상점에서만 내림, 산 사람은 칭호 유지)랑 "삭제"(칭호까지 전원 회수)를 따로 쓸 수 있음
- **칭호** — 최고 보유 포인트 기준으로 자동으로 붙는 등급 칭호(브론즈~다이아몬드)는 이름 색으로 보이고, 상점에서 산 칭호나 관리자가 직접 준 칭호는 배지로 보임. 배지는 색(예시 색/HEX 직접 입력/무지개) + 디자인(기본/메탈 반짝/빛나는 테두리) + 왕관 여부를 골라서 꾸밈. 마이페이지에서 골라서 장착함
- **투표(승부예측)** — 치지직 승부예측이랑 같은 방식. 항목마다 포인트를 걸고, 정산하면 진 쪽 포인트가 이긴 쪽에 건 비율대로 나눠짐. 다른 유저한테는 누가 어디 걸었는지 안 보임
- **공지사항** — 사진이랑 파일 첨부 가능. 사진은 본문에 크게 보여주고, 파일은 다운로드용으로 따로 목록에 뜸. 새 공지 올라오면 메뉴에 알림 점 표시됨
- **마이페이지** — 잔액, 칭호, 공개 설정, 내 포인트 내역
- **관리자 페이지** — 유저 검색, 포인트 지급/차감(일괄 가능, 실행취소 가능), 칭호 지급(새로 만들거나 기존 칭호 그대로)/회수, 밴, 전체 포인트 로그, 상점 사용 내역 처리
- **OBS 오버레이** — 상점 사용을 실시간으로 받아서 방송 화면에 알림 띄움

PC에선 왼쪽 사이드바, 폰에선 상단바 + 하단 탭바 레이아웃으로 바뀜. 스크롤바는 숨겨두고, 입력칸 자동완성(예전에 쳤던 값 추천)은 사이트 전체에서 꺼둠.

## 구조

```
chzzk-points/
├── docs/                       # GitHub Pages가 그대로 서빙하는 프론트 (빌드 없음)
│   ├── index.html              # 홈 + OAuth 콜백 처리
│   ├── notice.html             # 공지사항 (관리자는 글쓰기/수정/삭제)
│   ├── ranking.html            # 포인트 랭킹
│   ├── shop.html               # 포인트 상점 (일반 상점 / 칭호 상점)
│   ├── predict.html            # 투표
│   ├── attendance.html         # 출석체크
│   ├── mypage.html             # 마이페이지
│   ├── admin.html              # 관리자 페이지
│   ├── overlay.html            # OBS 브라우저 소스용 오버레이
│   └── assets/
│       ├── css/style.css
│       ├── img/, audio/        # 브랜드 이미지, 오버레이 알림음
│       └── js/
│           ├── supabase-client.js  # Supabase 클라이언트 (URL이랑 anon key만 들어감)
│           ├── chzzk-auth.js       # 로그인/세션 토큰 관리, 사이드바·모바일 메뉴 등 공용 코드
│           └── spa-router.js       # 페이지 이동할 때 본문만 갈아끼우는 간단한 라우터
│
└── supabase/
    ├── functions/              # Edge Functions (Deno)
    │   ├── _shared/            # CORS, 세션 토큰, 설정값, 방송 중 여부 확인 공용 코드
    │   ├── oauth-callback/     # 치지직 OAuth 토큰 교환 + 세션 토큰 발급
    │   ├── me/                 # 내 프로필/잔액/포인트 내역/칭호 조회·수정
    │   ├── attendance-check/   # 출석체크
    │   ├── spend-points/       # 상점 상품 구매
    │   ├── shop-items/         # 상품 관리 (관리자)
    │   ├── predictions/        # 투표 조회 + 베팅
    │   ├── notices/            # 공지 작성/수정/삭제 + 첨부파일 업로드 URL 발급 (관리자)
    │   ├── broadcast-status/   # 지금 방송 중인지 확인
    │   └── admin/              # 관리자 기능 전부 (유저 관리, 포인트, 밴, 투표 생성/정산 등)
    └── migrations/             # DB 스키마 변경 이력 (RLS 포함)
```

## 기술 스택

- 프론트: 순수 HTML/CSS/JS. 빌드 도구 없이 `docs/`를 GitHub Pages가 그대로 서빙함
- 백엔드: Supabase (Postgres, Edge Functions, Realtime, Storage)
- 로그인: 치지직 Open API OAuth

## 설계 메모

- **시크릿은 프론트에 절대 안 둠.** 치지직 `clientSecret`, Supabase `service_role` 키, 세션 서명 키는 전부 Edge Function 환경변수에만 있음. `docs/`에 들어가는 건 공개돼도 되는 URL이랑 anon key뿐임
- **로그인은 쿠키가 아니라 토큰 방식.** 프론트(GitHub Pages)랑 API(Supabase)가 도메인이 달라서, 크로스 도메인 쿠키 대신 자체 발급한 JWT를 `localStorage`에 두고 `Authorization: Bearer`로 보냄. 7일 만료이고 자주 들어오는 유저는 자동 연장됨
- **읽기는 프론트에서 직접, 쓰기는 Edge Function으로.** 랭킹·공지·상품 목록처럼 공개 데이터는 anon key로 바로 읽고, 포인트가 움직이거나 관리자 권한이 필요한 건 전부 Edge Function을 거침. 테이블 쓰기 권한은 RLS로 막혀 있음
- **포인트는 기록이 기준, 잔액은 따라옴.** 모든 포인트 변동은 `points_ledger`에 +/- 기록으로 쌓고, `users.balance`는 그 합계를 트리거가 자동으로 맞춰주는 칸임. `balance`를 직접 고치는 건 DB에서 막아둠 (포인트 조정은 관리자 페이지 = 기록 추가로만). 실행취소도 기록을 지우지 않고 반대 기록을 추가하는 방식
- **포인트 쓰는 건 DB 함수 하나로.** 상점 구매, 투표 베팅은 `debit_points()`가 유저 행을 잠근 채로 잔액 확인 + 차감을 한 번에 처리함. 버튼을 연타해도 가진 것 이상은 못 씀
- **첨부파일은 Storage에 직접 업로드.** Edge Function이 업로드용 signed URL만 발급해주고 파일은 브라우저가 Storage로 바로 올림. 저장 경로는 영문(uuid)만 쓰고 원래 파일명은 DB에 따로 둠 (Storage가 한글 경로를 안 받음)
- **방송 중 여부**는 치지직 공식 API에 채널 하나만 조회하는 게 없어서 치지직 웹이 쓰는 비공개 엔드포인트를 짧게 캐싱해서 씀
- 채팅/후원 포인트 적립은 방송 중에만 돌리는 로컬 리스너 프로그램이 따로 있음. 이 저장소로 옮길지는 아직 미정

## 배포

프론트는 `main`에 push하면 GitHub Pages에 자동 반영됨. CSS/JS를 고치면 캐시 때문에 안 바뀌어 보일 수 있어서, HTML에서 불러오는 `style.css?v=N`, `chzzk-auth.js?v=N` 같은 버전 숫자를 같이 올려줘야 함.

백엔드는 Supabase CLI 기준:

```bash
# DB 마이그레이션 적용
supabase db push

# Edge Function 배포 (인증은 함수 안에서 자체 토큰으로 하니까 JWT 검증은 끔)
supabase functions deploy <함수명> --no-verify-jwt
```

Edge Function 환경변수(Supabase 대시보드에서 등록):

| 이름 | 용도 |
| --- | --- |
| `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET` | 치지직 OAuth |
| `SESSION_JWT_SECRET` | 세션 토큰 서명 키 (긴 랜덤 문자열) |
| `ALLOWED_ORIGIN` | CORS 허용 도메인 (생략하면 GitHub Pages 주소) |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 알아서 넣어줌. 로컬 개발용 예시는 `.env.example` 참고.

## 상태

위 기능 전부 구현돼서 운영 중임.
