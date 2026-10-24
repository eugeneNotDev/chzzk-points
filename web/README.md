# 유진 팬보드 사이트 (React)

빌드·배포·구조 설명은 저장소 맨 위 [README](../README.md) 참고.

```bash
npm install          # 처음 한 번
npm run dev          # http://localhost:5173/beta/
npm run build        # 베타 → ../docs/beta/
npm run build:live   # 실제 사이트 → ../docs/
```

- 로컬(`npm run dev`)에선 Supabase 함수가 `eugene4lpha.com`에서 온 요청만 받아서 공개 데이터만 보이고 로그인 기능은 안 됨 → 베타에 올려서 확인
- 베타도 실제 DB를 쓰니까 테스트는 부계정으로
- 베타 전용 기능은 `import.meta.env.MODE !== "live"`로 갈림(`lib/life.ts`의 `LIFE_ENABLED`, `lib/mystery.ts`의 `MYSTERY_ENABLED`)

## 폴더

- `src/styles/tokens.css` — 색·간격·모서리 디자인 토큰. 톤을 바꿀 땐 여기만
- `src/nav.ts` — 메뉴 목록. 사이드바·모바일 메뉴·주소가 전부 여기서 나옴
- `src/routes.ts` — 주소 → 화면 등록
- `src/pages/` — 화면별 코드
- `src/components/` — 공통 부품(카드, 칭호 배지, 레이아웃 등)
- `src/lib/` — 로그인·서버 호출(`config.ts`의 `API`)·데이터 조회
- `scripts/copy-routes.mjs` — 빌드 후 메뉴 주소마다 `index.html` 복사(GitHub Pages엔 서버 라우팅이 없어서)
