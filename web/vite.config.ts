import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 빌드 두 가지:
//   npm run build      → 베타(eugene4lpha.com/beta/, docs/beta/). 베타 전용 기능이 켜짐(MODE !== "live")
//   npm run build:live → 실제 사이트(/, docs/). docs/의 직접 관리 파일(overlay.html, sw.js, assets/ …)을
//                        지우면 안 되니 emptyOutDir은 끄고, 앱 파일은 docs/app/에 따로 넣음.
// 같은 도메인이라 로그인 토큰(localStorage)이 베타와 실제 사이트에서 그대로 공유됨.
export default defineConfig(({ mode }) => {
  const live = mode === "live";
  return {
    base: live ? "/" : "/beta/",
    plugins: [
      react(),
      // 실제 사이트 빌드(live)에선 베타 표시를 뺌 — 제목 "(베타)"와 검색엔진 차단(noindex)은 베타 주소에서만
      {
        name: "live-html",
        transformIndexHtml(html: string) {
          if (!live) return html;
          return html.replace(" (베타)", "").replace(/\s*<meta name="robots" content="noindex" \/>/, "");
        },
      },
    ],
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
