import { SkelInline } from "../Skeleton";
import { useEffect, useLayoutEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { LogIn, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { ALL_NAV_ITEMS, MOBILE_TABS, NAV_GROUPS, type NavItem } from "../../nav";
import { isReady, preloadPages } from "../../routes";
import { useHasNewNotice } from "../../lib/notices";
import { logout, startLogin, useAuth } from "../../lib/auth";
import { useMe } from "../../lib/queries";
import { useTheme } from "../../lib/theme";
import { nameColorVars } from "../../lib/titleStyle";
import { BRAND_MARK_URL } from "../../lib/config";
import { AnimatedNumber } from "../AnimatedNumber";
import { Avatar } from "../Avatar";
import { NotificationBell } from "./NotificationBell";
import { useScrollHeader } from "./useScrollHeader";
import { ScrollTopButton } from "./ScrollTopButton";
import styles from "./AppLayout.module.css";

function currentItem(pathname: string): NavItem | undefined {
  const file = pathname.replace(/^\//, "");
  if (file === "" || file === "index.html") return ALL_NAV_ITEMS[0];
  return ALL_NAV_ITEMS.find((i) => i.path === file);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useAuth();
  const newNotice = useHasNewNotice();
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
                {item.path === "notice.html" && newNotice && <span className={styles.newDot} aria-label="새 공지" />}
                {!isReady(item.path) && <span className={styles.soon}>준비 중</span>}
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
          <span className={styles.userName} style={nameColorVars(me.data?.tierTitleColor)}>
            {auth.channelName || "(이름 없음)"}
          </span>
          <span className={`${styles.userPoints} num`}>{me.data ? <><AnimatedNumber value={me.data.balance} /> P</> : <SkelInline w={70} h={12} />}</span>
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
        <span className={styles.topUserName} style={nameColorVars(me.data?.tierTitleColor)}>
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
    <button type="button" className={styles.iconBtn} onClick={(e) => toggle(e)} aria-label={theme === "dark" ? "라이트 모드로 바꾸기" : "다크 모드로 바꾸기"}>
      {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
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
      {me.data ? <AnimatedNumber value={me.data.balance} /> : <SkelInline w={44} h={12} />} P
    </span>
  );
}

// 모바일 "더보기" — 기존 사이트처럼 아이콘 바둑판(한 화면에 전부 보이게). 하단 탭에 있는 메뉴는 뺌.
function MoreSheet({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useAuth();
  const newNotice = useHasNewNotice();
  const items = ALL_NAV_ITEMS.filter((i) => !MOBILE_TABS.includes(i.path) && (!i.adminOnly || isAdmin));
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="더보기" onClick={(e) => e.stopPropagation()}>
        <div className={styles.grabber} aria-hidden="true" />
        <UserBox />
        <nav className={styles.sheetGrid} aria-label="전체 메뉴">
          {items.map((it) => (
            <NavLink key={it.path} to={`/${it.path}`} end onClick={onClose} className={({ isActive }) => `${styles.sheetItem} ${isActive ? styles.sheetItemOn : ""}`}>
              <span className={styles.sheetIcon}>
                <it.icon size={22} aria-hidden="true" />
                {it.path === "notice.html" && newNotice && <span className={styles.newDot} aria-label="새 공지" />}
              </span>
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.sheetFoot}>
          <button type="button" className={styles.sheetFootBtn} onClick={onClose}>
            <X size={17} aria-hidden="true" />
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppLayout() {
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const item = currentItem(location.pathname);
  const headerRef = useScrollHeader();

  useEffect(() => preloadPages(), []);
  // 화면이 바뀌면 맨 위로(그려지기 전에 올려서 깜빡임 없게).
  // 게시판 글 열기·페이지 넘기기처럼 주소의 ?뒤만 바뀌는 것도 포함. 더보기 창은 닫음.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 });
    setSheetOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    document.title = item && item.path !== "" ? `${item.label} · 유진 팬보드` : "유진 팬보드";
  }, [item]);

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
        <header ref={headerRef} className={styles.topbar}>
          <Link to="/" className={`${styles.brand} ${styles.mobileOnly}`}>
            <img src={BRAND_MARK_URL} alt="" width={30} height={30} />
            <span>유진 팬보드</span>
          </Link>
          <h1 className={`${styles.pageTitle} ${styles.desktopOnly}`}>{item?.label ?? ""}</h1>
          <div className={styles.topActions}>
            <PointsChip />
            <NotificationBell />
            <ThemeButton />
            <TopUser />
          </div>
          <span className={styles.topProgress} data-progress aria-hidden="true" />
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

      <ScrollTopButton />
      {sheetOpen && <MoreSheet onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
