import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 새 버전(React)은 개발하는 동안 eugene4lpha.com/beta/ 에 올려서 기존 사이트와 나란히 확인함.
// 같은 도메인이라 Supabase CORS(eugene4lpha.com만 허용)와 치지직 로그인 리디렉트를 안 건드려도 되고,
// 로그인 토큰(localStorage)도 기존 사이트와 그대로 공유됨.
// 교체할 때는 `npm run build:live`(= --mode live) — 사이트 맨 앞(/)에 docs/로 빌드함(README 참고).
//   live: docs/의 기존 파일(assets/, overlay.html, sw.js …)을 지우면 안 되니 emptyOutDir은 끔.
//         앱 파일은 기존 docs/assets/와 섞이지 않게 docs/app/에 넣음.
export default defineConfig(({ mode }) => {
  const live = mode === "live";
  return {
    base: live ? "/" : "/beta/",
    plugins: [react()],
    build: {
      outDir: live ? "../docs" : "../docs/beta",
      emptyOutDir: !live,
      assetsDir: live ? "app" : "assets",
      // 라이브러리를 따로 묶어두면 사이트를 다시 배포해도 시청자 브라우저가 라이브러리는 캐시된 걸 그대로 씀.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            data: ["@supabase/supabase-js", "@tanstack/react-query"],
            motion: ["motion"],
          },
        },
      },
    },
    server: {
      port: 5173,
    },
  };
});
