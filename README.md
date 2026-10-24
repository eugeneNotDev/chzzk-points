# chzzk-points (유진 팬보드)

치지직 방송용 시청자 포인트 팬 사이트 — https://eugene4lpha.com
시청자가 출석·방송 코드·후원으로 포인트를 모으고, 상점·투표·미니게임·퀴즈로 방송에 직접 참여하게 만든 사이트임.

기획 쪽 내용(요구사항, 결정 사항, 로드맵)은 Notion에 따로 정리해두고 이 저장소엔 코드만 둠.

## 기능

- **치지직 로그인** — 치지직 OAuth. 로그인하면 자동 가입
- **출석체크 · 방송 코드** — 방송 중 방송 한 번에 한 번 출석(1회 100P, 10번째마다 보너스). 관리자가 뿌린 방송 코드(10분 유효, 선착순 가능)를 입력하면 포인트
- **랭킹 · 칭호** — 보유 포인트 순위(비공개 설정 가능). 최고 보유 포인트 기준 등급 칭호, 상점·관리자 칭호(색·디자인·아이콘 꾸미기), 지난달 1·2·3위 특수 칭호
- **포인트 상점 · 칭호 상점** — 쿨타임·방송 중 전용·한정 수량. 사면 OBS 오버레이에 알림
- **투표** — 치지직 승부예측 방식(진 쪽 포인트를 이긴 쪽 비율대로 나눔). 미스테리 라디오 연속 투표·유진 키우기 시청자 투표 카드도 여기에 뜸
- **퀴즈** — 유진고사(시험지 제출 → 방송에서 채점, 시험지 낙서 가능), OX 퀴즈(데스매치/점수전)
- **미니게임** — 무료 뽑기(하루 한 번), 룰렛, 가위바위보, 홀짝. 결과는 서버가 정함
- **유진 키우기** — 인생 시뮬레이션 팬게임 (베타 빌드에서만, 주인 계정 테스트 중)
- **커뮤니티** — 자유게시판, 방송 후기(작성 보상), 방종곡 신청, 그림 후원
- **공지사항** — 사진·파일 첨부, 노션처럼 꾸미는 HTML 모드(DOMPurify로 거름), 상단 고정
- **후원 적립** — 1만 치즈 이상 후원하면 10% 자동 적립(방송 PC에서 `tools/donation-relay` 실행 필요)
- **방송 알림** — 홈 화면 앱 설치 + 방송 시작 웹 푸시
- **관리자** — 유저·포인트(일괄·실행취소)·칭호·밴, 로그, 방송 코드, 익명 후원 적립, 신고, 백업 등
- **OBS 오버레이** — 상점 알림·방송 코드·그림 후원 (`web/public/overlay.html`)

## 구조

```
chzzk-points/
├── web/                    # 사이트 (React + Vite + TypeScript)
│   ├── src/
│   │   ├── nav.ts          # 메뉴 목록(사이드바·모바일·주소가 전부 여기서 나옴)
│   │   ├── routes.ts       # 주소 → 화면
│   │   ├── pages/          # 화면별 코드 (quiz/, life/, board/ …)
│   │   ├── components/     # 공통 부품
│   │   ├── lib/            # 로그인·서버 호출(config.ts의 API 목록)·데이터 조회
│   │   └── styles/         # 디자인 토큰·공통 CSS
│   ├── public/             # 직접 관리하는 정적 파일 — 빌드할 때 사이트 맨 앞에 그대로 복사됨
│   │   ├── overlay.html, open-live.html   # OBS 오버레이, 방송 알림 → 치지직 앱 열기
│   │   ├── sw.js, manifest.webmanifest    # 앱 설치·푸시
│   │   ├── CNAME
│   │   └── assets/                        # 이미지·알림음, 오버레이가 쓰는 supabase 사본
│   └── scripts/copy-routes.mjs   # 메뉴 주소마다 index.html 복사(GitHub Pages용)
│
├── supabase/
│   ├── config.toml         # 함수별 설정(전부 verify_jwt = false — 새 함수는 꼭 추가)
│   ├── functions/          # Edge Functions (Deno). _shared/는 공용 코드(db.ts·http.ts·cors.ts·session.ts …)
│   │                       # 큰 함수는 폴더 안에서 기능별로 나눔(admin/, board/, life-game/content·engine)
│   └── migrations/         # DB 변경 기록 (이름 규칙은 아래)
│
├── .github/workflows/      # check.yml(push마다 검사), deploy.yml(main에 push하면 사이트 배포)
├── tools/
│   ├── donation-relay/     # 방송 PC에서 켜두는 후원 연동 프로그램 (Node.js)
│   └── life-content/       # 유진 키우기 밸런스 점검 스크립트
│
└── notice-drafts/          # 공지 HTML 초안
```

## 기술 스택

- 프론트: React 19 + Vite + TypeScript, TanStack Query, CSS Modules
- 백엔드: Supabase (Postgres, Edge Functions, Realtime, Storage, pg_cron)
- 로그인: 치지직 Open API OAuth + 자체 세션 토큰
- 호스팅: GitHub Pages (GitHub Actions가 빌드해서 올림, 커스텀 도메인 `eugene4lpha.com`)

## 설계 메모

- **시크릿은 프론트에 절대 안 둠.** 치지직 `clientSecret`, `service_role` 키, 세션 서명 키는 Edge Function 환경변수에만 있음. 프론트(`web/src/lib/config.ts`)엔 공개돼도 되는 URL·anon key·client id만
- **로그인은 토큰 방식.** 사이트와 API 도메인이 달라서 자체 JWT를 `localStorage`에 두고 `Authorization: Bearer`로 보냄. 7일 만료, 자주 들어오면 자동 연장
- **읽기는 프론트에서 직접, 쓰기는 Edge Function으로.** 공개 데이터는 anon key로 바로 읽고, 포인트·관리자 기능은 전부 함수를 거침. 브라우저(anon)엔 테이블 쓰기 권한이 없음(RLS로도 막음, 0044·0075)
- **포인트는 기록이 기준.** 모든 변동은 `points_ledger`에 쌓고 `users.balance`는 트리거가 합계를 맞춤(직접 수정 금지). 실행취소도 반대 기록을 추가
- **포인트 쓰는 건 DB 함수 하나로.** 미니게임·상점·투표·퀴즈 보상은 DB 함수가 유저 행을 잠근 채 확인·차감·기록까지 한 번에 처리해서 연타해도 안전
- **방송 코드·비공개 정보는 서버에서 가림.** 코드 테이블은 서버 전용, 오버레이는 주소의 키로만 받음. 비공개 유저는 랭킹에 이름·칭호·채널 ID가 안 나감
- **후원 적립은 방송 PC 프로그램 → 서버 판단.** 프로그램엔 "중계 비밀번호"만 있고, 적립 여부는 DB 함수 `record_donation()`이 정함(중복 적립 없음)
- **방송 중 여부**는 치지직 웹의 비공개 엔드포인트를 짧게 캐싱해서 씀

## 개발 · 배포

### 사이트

```bash
cd web
npm install          # 처음 한 번
npm run dev          # http://localhost:5173/beta/ (로그인 필요한 기능은 CORS 때문에 안 됨)
npm run build:all    # 확인용 빌드 → web/dist/ (실제 사이트 + dist/beta/)
```

**배포는 `main`에 push하면 끝.** GitHub Actions(`.github/workflows/deploy.yml`)가 실제 사이트와 베타를 빌드해서 GitHub Pages에 올림(빌드 결과는 저장소에 커밋하지 않음). 진행 상황은 GitHub 저장소의 Actions 탭에서 볼 수 있음.
push할 때마다 `check.yml`이 사이트 타입 검사·빌드, 서버 함수 타입 검사, 유진 키우기 밸런스 점검을 돌림 — 실패하면 커밋 옆에 빨간 X.

베타에만 있는 기능(지금은 유진 키우기)은 `import.meta.env.MODE !== "live"`로 갈림.
사이트 주소를 바꿀 땐 세 군데를 같이: `web/src/lib/config.ts`의 `CHZZK_REDIRECT_URI`, 치지직 개발자센터 리디렉션 URL, Supabase 시크릿 `ALLOWED_ORIGIN`(+ 저장소 Settings → Pages의 Custom domain, `web/public/CNAME`).

### Edge Function

```bash
npx supabase link --project-ref azowisiuyeohhfxxmewb   # 이 PC에서 처음 한 번
npx supabase functions deploy <함수명>
```

`supabase/config.toml`에 함수마다 `verify_jwt = false`가 있어야 함(인증은 함수 안에서 자체 토큰으로). **새 함수를 만들면 config.toml에도 추가.**

환경변수(Supabase 대시보드): `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, `SESSION_JWT_SECRET`(바꾸면 모든 로그인이 즉시 끊김), `ALLOWED_ORIGIN`. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 자동.

### DB 마이그레이션

파일 이름은 **`<DB 기록 번호(14자리 날짜)>_<옛 번호>_<이름>.sql`** — 예: `20261023184301_0095_quiz_doodle.sql`.
앞의 14자리가 Supabase의 마이그레이션 기록(`supabase_migrations.schema_migrations`)과 같아야 `supabase db push`/`migration list`가 꼬이지 않음.

- 새 변경은 다음 번호(`0099_...`)로 이름 짓고, 적용한 기록 번호를 앞에 붙임
- DB에 직접 SQL을 돌려서 고쳤으면 그 내용도 꼭 파일로 남기기
- `npx supabase migration list`로 로컬 파일과 DB 기록이 같은지 확인 가능

## 후원 연동 프로그램 (tools/donation-relay)

방송할 때 PC에서 `start.bat`을 더블클릭해서 켜두면 됨(방송 끝날 때까지 창 열어두기). Node.js 필요.

- `config.json`에 서버 주소와 중계 비밀번호(git에 안 올라감, 서버엔 해시만). 새 PC에선 `config.example.json`을 복사해서 만듦
- 치지직 토큰은 방송할 때마다 갱신되고, **30일 넘게 방송을 안 하면 만료** → 사이트에서 유진 알파 계정으로 다시 로그인
- 못 보낸 후원은 `pending.json`에 모아뒀다가 다시 보냄
- 기준 금액(1만 치즈)·비율(10%)은 `donation_points()` DB 함수에 있음

## 아이콘 · 외부 라이브러리

- 칭호 아이콘: [Phosphor Icons](https://phosphoricons.com) (MIT), [Material Design Icons](https://pictogrammers.com) (Apache 2.0), [game-icons.net](https://game-icons.net) (CC BY 3.0). 아이콘별 출처는 `web/src/lib/titleIcons.ts` 맨 위 주석
- 사이트 라이브러리는 npm으로 받아 빌드에 같이 묶음(외부 CDN 안 씀): supabase-js, TanStack Query, React Router, DOMPurify(공지 HTML 거르기), motion, lucide-react, Pretendard·Outfit 글꼴
- `web/public/assets/js/supabase.min.js` — 오버레이(`overlay.html`)용 supabase-js 2.117.2 사본. Edge Function 쪽 import(`esm.sh/@supabase/supabase-js@2.117.2`)도 같은 버전
