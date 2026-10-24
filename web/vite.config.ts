import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 빌드 두 가지(배포는 GitHub Actions가 main에 push될 때 둘 다 해서 올림 — .github/workflows/deploy.yml):
//   npm run build:live → 실제 사이트(/, dist/). public/의 직접 관리 파일(overlay.html, sw.js, assets/ …)도 같이 복사됨.
//                        앱 파일은 public/assets와 섞이지 않게 dist/app/에 넣음.
//   npm run build      → 베타(eugene4lpha.com/beta/, dist/beta/). 베타 전용 기능이 켜짐(MODE !== "live")
//   npm run build:all  → 위 둘을 순서대로(실제 사이트가 dist/를 비우고 시작하므로 이 순서여야 함)
// 같은 도메인이라 로그인 토큰(localStorage)이 베타와 실제 사이트에서 그대로 공유됨.
export default defineConfig(({ mode }) => {
  const live = mode === "live";
  return {
    base: live ? "/" : "/beta/",
    // 직접 관리하는 정적 파일(public/)은 사이트 맨 앞에만 — 베타 폴더에까지 복사할 필요 없음
    publicDir: live ? "public" : false,
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
      outDir: live ? "dist" : "dist/beta",
      emptyOutDir: true,
      assetsDir: live ? "app" : "assets",
      // 라이브러리를 앱 코드와 따로 묶어두면 사이트를 다시 배포해도 시청자 브라우저가 라이브러리는 캐시된 걸 그대로 씀.
      // (패키지 이름 목록으로 지정하면 react-dom/client·framer-motion처럼 하위 경로·내부 패키지가 앱 파일에 섞여 들어가서 경로로 나눔)
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            const m = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
            if (!m) return;
            const pkg = m[1];
            if (/^(react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)$/.test(pkg)) return "react";
            if (/^(@supabase\/|@tanstack\/)/.test(pkg)) return "data";
            if (/^(motion|framer-motion|motion-dom|motion-utils)$/.test(pkg)) return "motion";
          },
        },
      },
    },
    server: {
      port: 5173,
    },
  };
});
