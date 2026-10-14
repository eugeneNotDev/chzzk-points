// 관리자 페이지 — 현황 요약 + 탭(유저 관리 · 포인트 로그 · 상점 내역 · 방송 코드 · 후원 적립 · 신고 · 백업).
// 탭은 주소 ?tab= 로 기억(새로고침해도 같은 탭).
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Card } from "../../components/Card";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { adminCall, num, type Stats } from "../../lib/admin";
import { UsersTab } from "./UsersTab";
import { LogTab, SpendTab } from "./LogTabs";
import { CodesTab } from "./CodesTab";
import { DonationsTab, type DonationData } from "./DonationsTab";
import { ReportsTab, type ReportData } from "./ReportsTab";
import { BackupTab } from "./BackupTab";
import styles from "./Admin.module.css";

const TABS = [
  ["users", "유저 관리"],
  ["log", "포인트 로그"],
  ["spend", "상점 내역"],
  ["code", "방송 코드"],
  ["donation", "후원 적립"],
  ["reports", "신고"],
  ["backup", "백업"],
] as const;
type Tab = (typeof TABS)[number][0];

function StatsCard() {
  const [open, setOpen] = useState(true);
  const q = useQuery({ queryKey: ["admin", "stats"], queryFn: () => adminCall<Stats>({ action: "get-stats" }) });
  const s = q.data;
  const v = (n: number | undefined) => (n === undefined ? "-" : num(n));
  return (
    <Card
      title={
        <button type="button" className={styles.collapseBtn} aria-expanded={open} onClick={() => setOpen(!open)}>
          현황 요약 <ChevronDown size={18} className={open ? styles.rot : ""} aria-hidden="true" />
        </button>
      }
    >
      {open && (
        <div className={styles.stats}>
          <div className={styles.total}>
            <span>전체 발행 포인트</span>
            <strong className="num">
              {v(s?.totalPoints)}
              <small>P</small>
            </strong>
          </div>
          <div className={styles.tiles}>
            <div>
              <strong className="num">{v(s?.userCount)}</strong>
              <span>전체 가입자</span>
            </div>
            <div>
              <strong className="num">{v(s?.bannedCount)}</strong>
              <span>밴된 유저</span>
            </div>
            <div>
              <strong className="num">{v(s?.todaySpendCount)}</strong>
              <span>오늘 상점 사용</span>
            </div>
            <div>
              <strong className="num">{v(s?.todayAttendanceCount)}</strong>
              <span>오늘 출석체크</span>
            </div>
          </div>
          {q.isError && <p className="status error">현황을 불러오지 못했어요.</p>}
        </div>
      )}
    </Card>
  );
}

export default function Admin() {
  const { isAdmin, isLoggedIn } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.some(([k]) => k === raw) ? (raw as Tab) : "users";
  // 탭 이름 옆 숫자(확인 대기 후원 · 처리 대기 신고)를 처음부터 보여주려고 미리 불러둠
  const donations = useQuery({ queryKey: ["admin", "donations"], enabled: isAdmin, queryFn: () => apiFetch<DonationData>(API.adminDonations) });
  const reports = useQuery({
    queryKey: ["admin", "reports", "open"],
    enabled: isAdmin,
    queryFn: () => apiFetch<ReportData>(API.board, { body: { action: "admin-reports", status: "open" } }),
  });

  if (!isAdmin)
    return (
      <div className="page">
        <PageHead title="관리자" />
        {isLoggedIn ? (
          <Card>
            <p className="muted">관리자 계정으로 로그인해야 볼 수 있는 페이지예요.</p>
          </Card>
        ) : (
          <LoginNeeded>관리자 계정으로 로그인해 주세요.</LoginNeeded>
        )}
      </div>
    );

  const counts: Partial<Record<Tab, number>> = {
    donation: donations.data?.pending.length,
    reports: reports.data?.openCount,
  };

  return (
    <div className="page">
      <PageHead title="관리자" />
      <StatsCard />
      <div className={styles.tabs} role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? styles.tabOn : ""}
            onClick={() => setParams(k === "users" ? {} : { tab: k }, { replace: true })}
          >
            {label}
            {!!counts[k] && <span className={`${styles.count} num`}>{counts[k]}</span>}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "log" && <LogTab />}
      {tab === "spend" && <SpendTab />}
      {tab === "code" && <CodesTab />}
      {tab === "donation" && <DonationsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "backup" && <BackupTab />}
    </div>
  );
}
