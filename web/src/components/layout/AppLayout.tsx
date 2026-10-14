import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, LogIn, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { ALL_NAV_ITEMS, MOBILE_TABS, NAV_GROUPS, type NavItem } from "../../nav";
import { logout, startLogin, useAuth } from "../../lib/auth";
import { useMe } from "../../lib/queries";
import { useTheme } from "../../lib/theme";
import { BRAND_MARK_URL } from "../../lib/config";
import { fmt } from "../../lib/format";
import { Avatar } from "../Avatar";
import styles from "./AppLayout.module.css";

function currentItem(pathname: string): NavItem | undefined {
  const file = pathname.replace(/^\//, "");
  if (file === "" || file === "index.html") return ALL_NAV_ITEMS[0];
  return ALL_NAV_ITEMS.find((i) => i.path === file);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useAuth();
  return (
    <nav aria-label="사이트 메뉴" className={styles.nav}>
      {NAV_GROUPS.map((g, gi) => {
        const items = g.items.filter((i) => !i.adminOnly || isAdmin);
        if (items.length === 0) return null;
        return (
          <div key={gi} className={styles.navGroup}>
            {g.title && <div className={styles.navTitle}>{g.title}</div>}
            {items.map((item) => (
              <NavLink
                key={item.path}
                to={`/${item.path}`}
                end
                onClick={onNavigate}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
              >
                <item.icon size={18} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
                {!item.ready && <span className={styles.soon}>준비 중</span>}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function UserBox() {
  const auth = useAuth();
  const me = useMe();
  if (!auth.isLoggedIn) {
    return (
      <button type="button" className={styles.loginBtn} onClick={startLogin}>
        <LogIn size={18} aria-hidden="true" />
        치지직으로 로그인
      </button>
    );
  }
  return (
    <div className={styles.userBox}>
      <Link to="/mypage.html" className={styles.userLink}>
        <Avatar name={auth.channelName} image={auth.profileImage} size={36} />
        <span className={styles.userText}>
          <span className={styles.userName} style={me.data?.tierTitleColor ? { color: me.data.tierTitleColor } : undefined}>
            {auth.channelName || "(이름 없음)"}
          </span>
          <span className={`${styles.userPoints} num`}>{me.data ? `${fmt(me.data.balance)} P` : "··· P"}</span>
        </span>
      </Link>
      <button type="button" className={styles.iconBtn} aria-label="로그아웃" title="로그아웃" onClick={logout}>
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

// PC 상단바 오른쪽 — 로그인 전엔 로그인 버튼, 로그인 후엔 프로필(마이페이지로) + 로그아웃.
function TopUser() {
  const auth = useAuth();
  const me = useMe();
  if (!auth.isLoggedIn) {
    return (
      <button type="button" className={`${styles.topLogin} ${styles.desktopOnly}`} onClick={startLogin}>
        <LogIn size={16} aria-hidden="true" />
        로그인
      </button>
    );
  }
  return (
    <div className={`${styles.topUser} ${styles.desktopOnly}`}>
      <Link to="/mypage.html" className={styles.topUserLink} title="마이페이지">
        <Avatar name={auth.channelName} image={auth.profileImage} size={32} />
        <span className={styles.topUserName} style={me.data?.tierTitleColor ? { color: me.data.tierTitleColor } : undefined}>
          {auth.channelName || "(이름 없음)"}
        </span>
      </Link>
      <button type="button" className={styles.iconBtn} aria-label="로그아웃" title="로그아웃" onClick={logout}>
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className={styles.iconBtn} onClick={toggle} aria-label={theme === "dark" ? "라이트 모드로 바꾸기" : "다크 모드로 바꾸기"}>
      {theme === "dark" ? <Moon size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}
    </button>
  );
}

function PointsChip() {
  const { isLoggedIn } = useAuth();
  const me = useMe();
  if (!isLoggedIn) return null;
  return (
    <span className={`${styles.pointsChip} num`}>
      <span className={styles.dot} aria-hidden="true" />
      {me.data ? fmt(me.data.balance) : "···"} P
    </span>
  );
}

export function AppLayout() {
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const item = currentItem(location.pathname);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = item && item.path !== "" ? `${item.label} · 유진 팬보드` : "유진 팬보드";
  }, [location.pathname, item]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheetOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.brand}>
          <img src={BRAND_MARK_URL} alt="" width={34} height={34} />
          <span>유진 팬보드</span>
        </Link>
        <NavList />
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <Link to="/" className={`${styles.brand} ${styles.mobileOnly}`}>
            <img src={BRAND_MARK_URL} alt="" width={30} height={30} />
            <span>유진 팬보드</span>
          </Link>
          <h1 className={`${styles.pageTitle} ${styles.desktopOnly}`}>{item?.label ?? ""}</h1>
          <div className={styles.topActions}>
            <PointsChip />
            <button type="button" className={`${styles.iconBtn} ${styles.desktopOnly}`} aria-label="알림 (준비 중)" disabled>
              <Bell size={20} aria-hidden="true" />
            </button>
            <ThemeButton />
            <TopUser />
          </div>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      <nav className={styles.tabbar} aria-label="하단 메뉴">
        {MOBILE_TABS.map((p) => {
          const it = ALL_NAV_ITEMS.find((i) => i.path === p)!;
          return (
            <NavLink key={p} to={`/${p}`} end className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
              <it.icon size={22} aria-hidden="true" />
              <span>{it.label === "포인트 상점" ? "상점" : it.label === "출석체크" ? "출석" : it.label}</span>
            </NavLink>
          );
        })}
        <button type="button" className={styles.tab} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
          <Menu size={22} aria-hidden="true" />
          <span>더보기</span>
        </button>
      </nav>

      {sheetOpen && (
        <div className={styles.sheetBackdrop} onClick={() => setSheetOpen(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="전체 메뉴" onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHead}>
              <span className={styles.sheetTitle}>전체 메뉴</span>
              <button type="button" className={styles.iconBtn} aria-label="닫기" onClick={() => setSheetOpen(false)}>
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <UserBox />
            <NavList onNavigate={() => setSheetOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
