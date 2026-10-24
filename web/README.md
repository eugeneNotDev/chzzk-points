# 유진 팬보드 사이트 (React)

빌드·배포·구조 설명은 저장소 맨 위 [README](../README.md) 참고. 배포는 `main`에 push하면 GitHub Actions가 함.

```bash
npm install          # 처음 한 번
npm run dev          # http://localhost:5173/beta/
npm run build:all    # 확인용 빌드 → dist/ (실제 사이트) + dist/beta/ (베타)
```

- 로컬(`npm run dev`)에선 Supabase 함수가 `eugene4lpha.com`에서 온 요청만 받아서 공개 데이터만 보이고 로그인 기능은 안 됨 → 베타(`/beta/`)에 올려서 확인
- 베타도 실제 DB를 쓰니까 테스트는 부계정으로
- 베타 전용 기능은 `import.meta.env.MODE !== "live"`로 갈림(지금은 `lib/life.ts`의 `LIFE_ENABLED` — 유진 키우기)

## 폴더

- `src/styles/tokens.css` — 색·간격·모서리 디자인 토큰. 톤을 바꿀 땐 여기만
- `src/nav.ts` — 메뉴 목록. 사이드바·모바일 메뉴·주소가 전부 여기서 나옴
- `src/routes.ts` — 주소 → 화면 등록
- `src/pages/` — 화면별 코드
- `src/components/` — 공통 부품(카드, 칭호 배지, 레이아웃 등)
- `src/lib/` — 로그인·서버 호출(`config.ts`의 `API`)·데이터 조회
- `public/` — 직접 관리하는 정적 파일(오버레이, 서비스 워커, 앱 아이콘 등). 실제 사이트 빌드 때 그대로 복사됨
- `scripts/copy-routes.mjs` — 빌드 후 메뉴 주소마다 `index.html` 복사(GitHub Pages엔 서버 라우팅이 없어서)
