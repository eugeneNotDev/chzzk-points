// 글꼴(Pretendard)은 사이트에 같이 묶어서 배포 — 외부 CDN이 막히거나 느려도 글꼴이 바뀌지 않게. 글자 범위별로 쪼개져 있어서 필요한 조각만 받음.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource-variable/outfit";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout";
import { ALL_NAV_ITEMS } from "./nav";
import Home from "./pages/Home";
import ComingSoon from "./pages/ComingSoon";
import NotFound from "./pages/NotFound";
import { SkelGroup } from "./components/Skeleton";
import { PAGES } from "./routes";
import { setupAppMode } from "./lib/pwa";
import { ApiError, handleOAuthCallback } from "./lib/auth";
import { setupChunkReload } from "./components/ErrorBoundary";
import { DialogHost } from "./components/DialogHost";
import { setupPullToRefresh } from "./lib/pullToRefresh";
import "./styles/global.css";

setupAppMode();
setupChunkReload();
handleOAuthCallback();
setupPullToRefresh();

const queryClient = new QueryClient({
  defaultOptions: {
    // 4xx(권한 없음·없는 글·잘못된 요청)는 다시 해도 똑같으니 바로 실패 처리 — 그 외(네트워크·5xx)만 한 번 더
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      refetchOnWindowFocus: true,
    },
  },
});

function PageLoading() {
  return (
    <SkelGroup style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span className="skeleton" style={{ height: 120, borderRadius: 20 }} />
      <span className="skeleton" style={{ height: 320, borderRadius: 20 }} />
    </SkelGroup>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="index.html" element={<Home />} />
            {ALL_NAV_ITEMS.filter((i) => i.path).map((item) => {
              const Page = PAGES[item.path];
              return (
                <Route
                  key={item.path}
                  path={item.path}
                  element={
                    Page ? (
                      <Suspense fallback={<PageLoading />}>
                        <Page />
                      </Suspense>
                    ) : (
                      <ComingSoon item={item} />
                    )
                  }
                />
              );
            })}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <DialogHost />
    </QueryClientProvider>
  </StrictMode>,
);
