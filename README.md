# chzzk-points

치지직 방송용 시참 포인트 시스템. 시청자가 채팅/출석/후원으로 포인트를 모으고, 모은 포인트를 소모처에 써서 방송에 실시간으로 개입한다.

기획 전체 내용(요구사항, 결정 사항, 로드맵, 열린 질문)은 Notion 페이지에 있음 — 이 저장소는 실제 코드만 담는다.

## 폴더 구조

```
chzzk-points/
├── docs/                     # GitHub Pages가 서빙하는 프론트엔드 (순수 HTML/CSS/JS, 빌드 도구 없음)
│   ├── index.html            # 로그인 랜딩 + OAuth 콜백 처리
│   ├── mypage.html           # 마이페이지 (공개 설정, 현재 포인트)
│   ├── ranking.html          # 포인트 랭킹
│   ├── shop.html             # 포인트 소모처
│   ├── overlay.html          # OBS 브라우저 소스용 오버레이 (Realtime 구독)
│   └── assets/
│       ├── css/style.css
│       └── js/
│           └── supabase-client.js   # Supabase 클라이언트 초기화 (URL/anon key만, 시크릿 없음)
│
├── supabase/
│   ├── functions/            # Edge Functions (Deno/TypeScript) — 시크릿을 다루는 서버 로직
│   │   ├── oauth-callback/   # 치지직 OAuth code → 토큰 교환 (clientSecret 사용)
│   │   ├── spend-points/     # 포인트 사용: 잔액 확인 → 차감 → 이벤트 기록
│   │   └── attendance-check/ # 방송 중 최초 접속 출석 체크 보너스 지급
│   └── migrations/           # DB 스키마 (SQL)
│
└── .env.example               # 로컬 개발용 환경변수 예시 (실제 시크릿은 절대 커밋하지 않음)
```

## 원칙

- 프론트엔드(`docs/`)는 빌드 도구 없이 그대로 GitHub Pages가 서빙한다. `<script>` 태그로 Supabase JS 클라이언트를 불러와 직접 호출한다.
- `clientSecret`, Supabase `service_role` 키 등 시크릿은 절대 `docs/` 아래 어떤 파일에도 들어가지 않는다. 전부 `supabase/functions/`(Edge Functions) 쪽에서만, Supabase 프로젝트의 환경변수로 관리한다.
- DB · 실시간 통신(Realtime) · Edge Functions는 전부 Supabase 프로젝트 하나에 모여 있다.
- 로컬 상시 채팅/후원 리스너 프로그램(방송 중에만 실행)은 기존에 만들어둔 것을 그대로 확장해서 쓴다 — 이 저장소로 옮길지는 나중에 결정.

## 상태

기획 완료, 개발 착수 전. 지금은 폴더 구조만 잡아둔 상태 — 각 파일은 TODO 주석만 있는 뼈대.
