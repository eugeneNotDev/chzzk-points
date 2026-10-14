import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout";
import { ALL_NAV_ITEMS } from "./nav";
import Home from "./pages/Home";
import Freebox from "./pages/Freebox";
import ComingSoon from "./pages/ComingSoon";
import "./styles/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

// 새로 만든 화면은 여기에 등록. 등록 안 된 메뉴는 "준비 중" 화면.
const PAGES: Record<string, React.ComponentType> = {
  "freebox.html": Freebox,
};

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
              return <Route key={item.path} path={item.path} element={Page ? <Page /> : <ComingSoon item={item} />} />;
            })}
            <Route path="*" element={<ComingSoon />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
