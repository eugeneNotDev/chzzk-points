# 유진 팬보드 새 버전 (React)

기존 사이트(`docs/`)는 그대로 두고, 새 버전을 이 폴더에서 따로 만드는 중.
다 만들어지면 한 번에 교체함. 백엔드(Supabase 함수·DB)는 기존 것을 그대로 씀.

## 처음 한 번

```bash
cd web
npm install
```

## 개발하면서 보기

```bash
npm run dev
```

`http://localhost:5173/beta/` 로 열림. 단, Supabase 함수가 `eugene4lpha.com`에서 온 요청만 받아서
로컬에선 공지·랭킹 같은 공개 데이터만 보이고 로그인이 필요한 기능은 안 됨.
실제 동작 확인은 아래처럼 빌드해서 `/beta/`에 올려서 함.

## 베타에 올리기

```bash
npm run build
```

결과물이 `docs/beta/`에 생김 → 커밋·푸시하면 `https://eugene4lpha.com/beta/` 에서 확인 가능.
같은 도메인이라 기존 사이트에서 로그인한 상태가 베타에서도 그대로 이어짐.
(베타에서 로그인 버튼을 누르면 로그인 후 기존 사이트 홈으로 돌아감 — 거기서 다시 /beta/ 로 들어오면 됨)

베타도 실제 DB를 쓰니까 테스트는 부계정으로.

## 구조

- `src/styles/tokens.css` — 색·간격·모서리 등 디자인 토큰. 톤을 바꿀 땐 여기만.
- `src/nav.ts` — 메뉴 목록. 사이드바·모바일 메뉴·주소가 전부 여기서 나옴.
- `src/main.tsx` — 새로 만든 화면 등록(`PAGES`). 등록 안 된 메뉴는 "준비 중" 화면.
- `src/pages/` — 화면별 코드
- `src/components/` — 공통 부품(카드, 칭호 배지, 레이아웃 등)
- `src/lib/` — 로그인·서버 호출·데이터 조회

## 교체할 때 (전부 다 만든 뒤)

1. `vite.config.ts`의 `base`를 `"/"`로, `outDir`을 `"../docs"`로 변경
2. 기존 `docs/`에서 남길 것(`assets/`, `overlay.html`, `open-live.html`, `404.html`, `CNAME`, `sw.js`, `manifest.webmanifest`) 확인
3. 빌드 → 커밋 한 번으로 교체. 문제 생기면 그 커밋만 되돌리면 원래 사이트로 돌아감
