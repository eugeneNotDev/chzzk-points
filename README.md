# chzzk-points (유진 팬보드)

치지직 방송용 시청자 포인트 팬 사이트 — https://eugene4lpha.com

시청자가 출석·방송 코드·후원으로 포인트를 모으고, 상점·투표·퀴즈·미니게임으로 방송에 참여하는 사이트.
기획(요구사항·결정 사항·로드맵)은 Notion에 따로 두고, 이 저장소엔 코드만 둠.

## 기능

**포인트 모으기**
- **치지직 로그인** — 치지직 OAuth, 처음 로그인하면 자동 가입
- **출석체크** — 방송 중 방송 한 번에 한 번(1회 100P, 10번째마다 보너스)
- **방송 코드** — 관리자가 뿌린 코드(10분 유효, 선착순 가능)를 입력하면 포인트
- **후원 적립** — 1만 치즈 이상 후원은 10% 자동 적립. 구독권 선물은 1장 5,000원(2티어 15,000원)으로 쳐서 합쳐 1만 원 이상이면 적립(방송 PC에서 `tools/donation-relay` 실행 필요). 익명 후원은 관리자 페이지에서 직접 적립
- **게시판 활동 보상** — 글·댓글·방송 후기 작성 보상(하루 한도 있음)

**포인트 쓰기 · 참여**
- **포인트 상점 · 칭호 상점** — 쿨타임·방송 중 전용·한정 수량. 사면 OBS 오버레이에 알림
- **투표** — 치지직 승부예측 방식(진 쪽 포인트를 이긴 쪽 비율대로 나눔). 미스테리 라디오 연속 투표 카드도 여기에 뜸
- **퀴즈** — 유진고사(시험지 제출 → 방송에서 채점, 낙서 가능), OX 퀴즈(데스매치/점수전)
- **미니게임** — 무료 뽑기(하루 한 번, 100~300P) + 오늘의 미니게임(룰렛·가위바위보·홀짝·양 로켓 중 하루 하나, 한국 시간 자정마다 바뀜). 결과는 전부 서버가 정함
- **유진 키우기** — 인생 시뮬레이션 팬게임(베타 빌드에서만, 테스트 중)

**랭킹 · 칭호**
- **랭킹** — 보유 포인트 순위. 비공개 설정 가능(남에겐 "비공개", 본인 화면에선 🔒 비공개 표시와 함께 내 이름·칭호)
- **칭호** — 등급 칭호(최고 보유 포인트 기준), 상점·관리자 칭호, 지난달 1·2·3위 특수 칭호
- **칭호 꾸미기** — 색(단색·두 색), 디자인(기본·메탈 반짝·빛나는 테두리·유리), 배경(밤하늘·무지개 하늘), 아이콘, 반짝이 별

**커뮤니티 · 그 밖**
- 자유게시판, 방송 후기, 방종곡 신청, 그림 후원
- **공지사항** — 사진·파일 첨부, 노션처럼 꾸미는 HTML 모드(DOMPurify로 거름), 상단 고정
- **방송 알림** — 홈 화면 앱 설치 + 방송 시작 웹 푸시
- **관리자** — 유저·포인트(일괄 지급·실행취소)·칭호·밴, 로그, 방송 코드, 익명 후원 적립, 신고, 백업
- **OBS 오버레이** — 상점 알림·방송 코드·그림 후원(`web/public/overlay.html`)

## 구조

```
chzzk-points/
├── web/                         # 사이트 (React + Vite + TypeScript)
│   ├── src/
│   │   ├── nav.ts               # 메뉴 목록 — 사이드바·모바일 메뉴·주소가 전부 여기서 나옴
│   │   ├── routes.ts            # 주소 → 화면
│   │   ├── pages/               # 화면별 코드 (board/, quiz/, games/, life/ …)
│   │   ├── components/          # 공통 부품 (칭호 플레이트, 랭킹 목록, 레이아웃 …)
│   │   ├── lib/                 # 로그인·서버 호출(config.ts의 API 목록)·데이터 조회·칭호 계산
│   │   └── styles/              # 디자인 토큰(tokens.css)·공통 CSS·칭호 CSS(title-plate.css)
│   ├── public/                  # 직접 관리하는 정적 파일 — 실제 사이트 빌드 때 그대로 복사
│   │   ├── overlay.html         # OBS 오버레이
│   │   ├── open-live.html       # 방송 알림 → 치지직 앱 열기
│   │   ├── sw.js, manifest.webmanifest   # 앱 설치·푸시
│   │   ├── CNAME
│   │   └── assets/              # 이미지·알림음, 오버레이용 supabase 사본
│   └── scripts/copy-routes.mjs  # 메뉴 주소마다 index.html 복사 (GitHub Pages용)
│
├── supabase/
│   ├── config.toml              # 함수별 설정 (전부 verify_jwt = false — 새 함수는 꼭 추가)
│   ├── functions/               # Edge Functions (Deno). _shared/는 공용 코드
│   └── migrations/              # DB 변경 기록 (이름 규칙은 아래)
│
├── tools/
│   ├── donation-relay/          # 방송 PC에서 켜두는 후원 연동 프로그램 (Node.js)
│   └── life-content/            # 유진 키우기 밸런스 점검 스크립트
│
├── notice-drafts/               # 공지 HTML 초안
└── .github/workflows/           # check.yml(push마다 검사), deploy.yml(main에 push하면 배포)
```

## 기술 스택

- **프론트** — React 19, Vite, TypeScript, TanStack Query, React Router, CSS Modules
- **백엔드** — Supabase (Postgres, Edge Functions, Realtime, Storage, pg_cron)
- **로그인** — 치지직 Open API OAuth + 자체 세션 토큰
- **호스팅** — GitHub Pages (GitHub Actions가 빌드해서 올림), 도메인 `eugene4lpha.com`

## 개발 · 배포

### 사이트

```bash
cd web
npm install          # 처음 한 번
npm run dev          # http://localhost:5173/beta/
npm run build:all    # 확인용 빌드 → dist/ (실제 사이트) + dist/beta/ (베타)
```

- **배포는 `main`에 push하면 끝.** `deploy.yml`이 실제 사이트와 베타를 빌드해서 올림(빌드 결과는 커밋하지 않음). 진행 상황은 저장소 Actions 탭
- push할 때마다 `check.yml`이 사이트 타입 검사·빌드, 서버 함수 타입 검사, 유진 키우기 밸런스 점검을 돌림 — 실패하면 커밋 옆에 빨간 X(배포와는 별개)
- 로컬(`npm run dev`)에선 서버 함수가 `eugene4lpha.com`에서 온 요청만 받아서 로그인 기능은 안 됨 → 베타(`/beta/`)에 올려서 확인. 베타도 실제 DB를 쓰니 테스트는 부계정으로
- 베타 전용 기능은 `import.meta.env.MODE !== "live"`로 갈림(지금은 유진 키우기)
- 사이트 주소를 바꿀 땐 같이 바꿀 곳: `web/src/lib/config.ts`의 `CHZZK_REDIRECT_URI`, 치지직 개발자센터 리디렉션 URL, Supabase 시크릿 `ALLOWED_ORIGIN`, 저장소 Settings → Pages의 Custom domain, `web/public/CNAME`

### Edge Function

```bash
npx supabase link --project-ref azowisiuyeohhfxxmewb   # 이 PC에서 처음 한 번
npx supabase functions deploy <함수명>
```

- `supabase/config.toml`에 함수마다 `verify_jwt = false` 필요(인증은 함수 안에서 자체 토큰으로). **새 함수를 만들면 config.toml에도 추가**
- 환경변수(Supabase 대시보드 → Secrets): `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, `SESSION_JWT_SECRET`(바꾸면 모든 로그인이 즉시 끊김), `ALLOWED_ORIGIN`. `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`는 자동. 목록은 `.env.example` 참고

### DB 마이그레이션

파일 이름은 **`<DB 기록 번호(14자리)>_<순번>_<이름>.sql`** — 예: `20261106132126_0109_rocket_instant_crash_1pct.sql`

- 앞의 14자리가 Supabase 마이그레이션 기록(`supabase_migrations.schema_migrations`)과 같아야 `supabase db push`/`migration list`가 꼬이지 않음
- 새 변경은 다음 순번으로 이름 짓고, 적용한 기록 번호를 앞에 붙임
- DB에 직접 SQL을 돌려서 고쳤으면 그 내용도 꼭 파일로 남기기
- `npx supabase migration list`로 로컬 파일과 DB 기록이 같은지 확인

### 후원 연동 프로그램 (tools/donation-relay)

방송할 때 PC에서 `start.bat`을 더블클릭해서 켜두기(방송 끝날 때까지). Node.js 필요. 코드를 고쳤으면 창을 껐다 다시 켜야 적용됨.

- 일반 후원은 치지직 공식 API로, 미션 후원·구독권 선물은 치지직 채팅창(읽기 전용)으로 받음
- 구독권 선물은 받는 사람 알림을 선물 번호별로 세서 장수를 셈(선물한 사람 알림이 안 올 때가 있음). 같은 선물은 서버가 한 번만 적립
- `config.json`엔 서버 주소와 중계 비밀번호만(git에 안 올라감, 서버엔 해시만). 새 PC에선 `config.example.json`을 복사해서 만듦
- 치지직 토큰은 방송할 때마다 갱신되고, **30일 넘게 방송을 안 하면 만료** → 사이트에서 유진 알파 계정으로 다시 로그인
- 못 보낸 후원은 `pending.json`에 모아뒀다가 다시 보냄. 받은 미션·선물 원본은 `chat-events.log`에 남음(문제 생겼을 때 확인용)

## 설계 메모

- **시크릿은 프론트에 두지 않음.** 치지직 `clientSecret`, `service_role` 키, 세션 서명 키는 Edge Function 환경변수에만. 프론트(`web/src/lib/config.ts`)엔 공개돼도 되는 URL·anon key·client id만
- **로그인은 토큰 방식.** 사이트와 API 도메인이 달라서 자체 JWT를 `localStorage`에 두고 `Authorization: Bearer`로 보냄. 7일 만료, 자주 들어오면 자동 연장
- **읽기는 프론트에서 직접, 쓰기는 Edge Function으로.** 공개 데이터는 anon key로 바로 읽고, 포인트·관리자 기능은 전부 함수를 거침. 브라우저엔 테이블 쓰기 권한이 없음(RLS로도 막음)
- **포인트는 기록이 기준.** 모든 변동은 `points_ledger`에 쌓고 `users.balance`는 트리거가 합계를 맞춤(직접 수정 금지). 실행취소도 반대 기록을 추가
- **포인트 쓰는 건 DB 함수 하나로.** 미니게임·상점·투표·퀴즈 보상은 DB 함수가 유저 행을 잠근 채 확인·차감·기록까지 한 번에 처리 → 연타해도 안전
- **비공개 정보는 서버에서 가림.** 방송 코드 테이블은 서버 전용, 오버레이는 주소의 키로만 받음. 비공개 유저는 랭킹에 이름·칭호·채널 ID가 안 나감(본인 화면에서만 로그인 정보로 채워서 보여줌)
- **후원 적립 여부는 서버가 판단.** 방송 PC 프로그램은 받은 걸 넘기기만 하고, 적립은 DB 함수 `record_donation()`이 정함(같은 후원 중복 적립 없음)
- **방송 중 여부**는 치지직 웹의 비공개 엔드포인트를 짧게 캐싱해서 씀

## 숫자 바꾸는 곳

| 항목 | 위치 |
|---|---|
| 후원 적립 기준(1만 치즈)·비율(10%) | DB 함수 `donation_points()` |
| 구독권 선물 1장 가격 | `supabase/functions/donation-relay`의 `SUB_GIFT_PRICE` |
| 무료 뽑기 금액·확률 | DB 함수 `free_box_open()` |
| 룰렛 배율·확률 | DB 테이블 `roulette_outcomes`(weight) |
| 양 로켓 터지는 확률 | DB 함수 `rocket_start()` — 터질 배수 = 0.99 / (1 − 난수), 즉시 폭발 1% |
| 오늘의 미니게임 순서 | `supabase/functions/_shared/rotation.ts`와 `web/src/lib/rotation.ts`(둘이 같아야 함) |

숫자를 바꿀 땐 마이그레이션 파일로 남기고, 관련 공지(이용 가이드 등)에 적힌 숫자도 같이 고치기.

## 칭호 값 형식

`titles.color`에 문자열 하나로 저장. 앞에서부터 `디자인-아이콘-star-배경-색` 순이고, 빠진 건 기본값.

- 예: `#f1f3f5`(기본·단색), `shine-sheep-star-sky-rainbow`, `glass-1b1e24-t-f2c230`(바탕+글자 두 색), `basic-ff6bb5-5dc8ff`(그라데이션)
- 디자인 `basic`·`shine`·`glow`·`glass`, 배경 `night`·`sky`, 색 `#hex`·`rainbow`·두 색
- 예전 꿈나라 디자인 값(`dream-...`)은 기본 디자인 + 밤하늘 배경으로 읽음
- 읽고 쓰는 코드는 `web/src/lib/titleStyle.ts`, 그리는 값 계산은 `titlePlate.ts`, 모양은 `styles/title-plate.css`

## 아이콘 · 외부 라이브러리

- 칭호 아이콘: [Phosphor Icons](https://phosphoricons.com) (MIT), [Material Design Icons](https://pictogrammers.com) (Apache 2.0), [game-icons.net](https://game-icons.net) (CC BY 3.0). 아이콘별 출처는 `web/src/lib/titleIcons.ts` 맨 위 주석
- 사이트 라이브러리는 npm으로 받아 빌드에 같이 묶음(외부 CDN 안 씀): supabase-js, TanStack Query, React Router, DOMPurify, motion, lucide-react, Pretendard·Outfit 글꼴
- `web/public/assets/js/supabase.min.js` — 오버레이용 supabase-js 2.117.2 사본. Edge Function 쪽 import(`esm.sh/@supabase/supabase-js@2.117.2`)도 같은 버전
