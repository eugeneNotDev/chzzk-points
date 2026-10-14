// 마이페이지 — 포인트·칭호·등급 요약, 앱 설치/방송 알림, 칭호 장착, 랭킹 공개 설정, 포인트 내역, 내 활동.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { AppInstallCard } from "../../components/AppInstallCard";
import { Avatar } from "../../components/Avatar";
import { Card, EmptyState } from "../../components/Card";
import { Pagination } from "../../components/Pagination";
import { TitleBadge } from "../../components/TitleBadge";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch, ApiError, getToken, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt, relTime } from "../../lib/format";
import { useMe, useTitles, type Me } from "../../lib/queries";
import styles from "./MyPage.module.css";
import { AnimatedNumber } from "../../components/AnimatedNumber";

type LogEntry = { id: number; amount: number; reason: string; createdAt: string; balanceAfter?: number };
type Activity = {
  posts: { id: number; board: "free" | "review"; title: string; commentCount: number; paid: boolean; hidden?: boolean; broadcast: string | null; createdAt: string }[];
  comments: { postId: number; board: "free" | "review" | null; body: string; hidden: boolean; postTitle: string | null; createdAt: string }[];
  postCount: number;
  commentCount: number;
  rewardTotal: number;
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function MyPage() {
  const auth = useAuth();
  const me = useMe();
  const titles = useTitles();

  if (!auth.isLoggedIn) {
    return (
      <div className="page">
        <PageHead title="마이페이지" />
        <Card>
          <LoginNeeded />
        </Card>
        <AppInstallCard />
      </div>
    );
  }

  const profile = me.data;
  const equipped = titles.data?.find((t) => t.id === profile?.selectedTitleId);

  return (
    <div className="page">
      <PageHead title="마이페이지" />

      <Card className={styles.summary}>
        <div className={styles.who}>
          <Avatar name={auth.channelName} image={auth.profileImage} size={56} />
          <div className={styles.whoText}>
            <span className={styles.name}>{profile?.channelName || auth.channelName || "(이름 없음)"}</span>
            <span className="muted">치지직 계정으로 로그인됨</span>
          </div>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className="muted">현재 포인트</span>
            <b className={`num ${styles.balance} ${profile && profile.balance < 0 ? styles.neg : ""}`}>
              {profile ? <AnimatedNumber value={profile.balance} /> : "···"}
              <small>P</small>
            </b>
          </div>
          <div className={styles.stat}>
            <span className="muted">칭호</span>
            <span className={styles.statVal}>{equipped ? <TitleBadge name={equipped.name} value={equipped.color} /> : "미장착"}</span>
          </div>
          <div className={styles.stat}>
            <span className="muted">등급</span>
            <span className={styles.statVal} style={profile?.tierTitleColor ? { color: profile.tierTitleColor, fontWeight: 800 } : undefined}>
              {profile?.tierTitleName || "없음"}
            </span>
          </div>
        </div>
        {profile && profile.balance < 0 && (
          <p className={styles.negNote}>
            포인트가 마이너스예요. 0P 이상이 될 때까지 상점·미니게임·투표 같은 포인트 사용은 할 수 없어요. 출석체크·무료 뽑기·방송 코드로 다시 모을 수 있어요.
          </p>
        )}
      </Card>

      <div className={styles.cols}>
        <div className={styles.col}>
          <TitlesCard profile={profile} />
          <PublicCard profile={profile} />
          <AppInstallCard />
        </div>
        <div className={styles.col}>
          <PointsLog />
          <MyActivity />
        </div>
      </div>
    </div>
  );
}

function TitlesCard({ profile }: { profile: Me | undefined }) {
  const titles = useTitles();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const owned = (titles.data ?? []).filter((t) => (profile?.purchasedTitleIds ?? []).includes(t.id));

  async function equip(id: string) {
    if (!profile) return;
    const next = profile.selectedTitleId === id ? null : id;
    setBusy(true);
    setStatus({ text: "" });
    try {
      const data = await apiFetch<Me>(API.me, { body: { selectedTitleId: next } });
      qc.setQueryData(["me", getToken()], data);
      qc.invalidateQueries({ queryKey: ["ranking"] });
      setStatus({ text: next ? "칭호를 장착했어요." : "칭호를 해제했어요." });
    } catch (e) {
      setStatus({ text: e instanceof ApiError && e.body.error === "title_locked" ? "아직 잠긴 칭호예요." : "칭호 변경에 실패했어요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <button type="button" className={styles.collapseHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2>내 칭호</h2>
        <span className="muted">{owned.length}개</span>
        <ChevronDown size={18} className={open ? styles.rot : ""} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.collapseBody}>
          <p className="muted" style={{ fontSize: 13 }}>
            상점에서 구매했거나 선물받은 칭호를 장착할 수 있어요. <Link to="/titles.html" className={styles.link}>칭호 상점 가기</Link>
          </p>
          {titles.isLoading && <span className="skeleton" style={{ height: 64 }} />}
          {profile && titles.data && owned.length === 0 && <EmptyState>보유한 칭호가 없어요.</EmptyState>}
          <div className={styles.titleGrid}>
            {owned.map((t) => {
              const sel = profile?.selectedTitleId === t.id;
              return (
                <div key={t.id} className={`${styles.titleItem} ${sel ? styles.titleSel : ""}`}>
                  <div className={styles.titleBadge}>
                    <TitleBadge name={t.name} value={t.color} />
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t.kind === "custom" ? "관리자가 지급한 칭호" : "상점에서 구매한 칭호"}
                  </span>
                  <button type="button" className={`btn btn-sm ${sel ? "" : "btn-primary"}`} disabled={busy} onClick={() => equip(t.id)}>
                    {sel ? "장착 해제" : "장착하기"}
                  </button>
                </div>
              );
            })}
          </div>
          <p className={`status ${status.error ? "error" : "ok"}`}>{status.text}</p>
        </div>
      )}
    </Card>
  );
}

function PublicCard({ profile }: { profile: Me | undefined }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });

  async function toggle(next: boolean) {
    if (!profile) return;
    setBusy(true);
    setStatus({ text: "" });
    const prev = profile;
    qc.setQueryData(["me", getToken()], { ...profile, isPublic: next });
    try {
      await apiFetch(API.me, { body: { isPublic: next } });
      setStatus({ text: next ? "공개로 설정됐어요." : "비공개로 설정됐어요." });
      qc.invalidateQueries({ queryKey: ["ranking"] });
    } catch {
      qc.setQueryData(["me", getToken()], prev);
      setStatus({ text: "저장에 실패했어요. 다시 시도해주세요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <label className={styles.toggleRow}>
        <span className={styles.toggleText}>
          <strong>랭킹에 이름 공개</strong>
          <span className="muted">끄면 순위·포인트는 그대로 보이지만 이름은 "비공개"로 표시돼요.</span>
        </span>
        <span className="switch">
          <input type="checkbox" role="switch" checked={!!profile?.isPublic} disabled={!profile || busy} onChange={(e) => toggle(e.target.checked)} />
          <span className="slider" />
        </span>
      </label>
      <p className={`status ${status.error ? "error" : "ok"}`} style={{ marginTop: 8 }}>
        {status.text}
      </p>
    </Card>
  );
}

function PointsLog() {
  const { token } = useAuth();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["points-log", token, page],
    placeholderData: (prev) => prev,
    queryFn: () => apiFetch<{ entries: LogEntry[]; page: number; totalPages: number }>(`${API.me}?action=points-log&page=${page}`),
  });
  return (
    <Card title="포인트 내역" flush>
      <p className="muted" style={{ fontSize: 13, padding: "0 12px 8px" }}>
        출석·상점·미니게임·관리자 지급/차감 내역을 최신순으로 보여줘요.
      </p>
      {q.isError && <EmptyState>불러오기에 실패했어요.</EmptyState>}
      {q.data?.entries.length === 0 && <EmptyState>아직 내역이 없어요.</EmptyState>}
      <ul className={styles.log}>
        {q.data?.entries.map((e) => (
          <li key={e.id}>
            <div className={styles.logMain}>
              <span className={styles.logReason}>{e.reason}</span>
              <span className={styles.logTime}>{fmtDateTime(e.createdAt)}</span>
            </div>
            <div className={styles.logAmt}>
              <b className={`num ${e.amount > 0 ? styles.plus : styles.minus}`}>
                {e.amount > 0 ? "+" : ""}
                {fmt(e.amount)}P
              </b>
              {typeof e.balanceAfter === "number" && <span className="num muted">잔액 {fmt(e.balanceAfter)}P</span>}
            </div>
          </li>
        ))}
      </ul>
      {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={setPage} />}
    </Card>
  );
}

function MyActivity() {
  const { token } = useAuth();
  const [tab, setTab] = useState<"posts" | "comments">("posts");
  const q = useQuery({
    queryKey: ["board", "my-activity", token],
    queryFn: () => apiFetch<Activity>(API.board, { body: { action: "my-activity" } }),
  });
  const d = q.data;
  const boardPath = (b: string | null) => (b === "review" ? "/board-review.html" : "/board-free.html");

  return (
    <Card
      title="내 활동"
      flush
      extra={
        <div role="tablist" className="segment" style={{ marginLeft: "auto" }}>
          <button type="button" role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}>
            내 글 {d?.postCount ?? ""}
          </button>
          <button type="button" role="tab" aria-selected={tab === "comments"} onClick={() => setTab("comments")}>
            내 댓글 {d?.commentCount ?? ""}
          </button>
        </div>
      }
    >
      <div className={styles.maStats}>
        <div>
          <span className="muted">쓴 글</span>
          <b className="num">{d ? fmt(d.postCount) : "-"}</b>
        </div>
        <div>
          <span className="muted">쓴 댓글</span>
          <b className="num">{d ? fmt(d.commentCount) : "-"}</b>
        </div>
        <div>
          <span className="muted">후기 보상</span>
          <b className="num">{d ? `+${fmt(d.rewardTotal)}P` : "-"}</b>
        </div>
      </div>
      {q.isError && <EmptyState>내 활동을 불러오지 못했어요.</EmptyState>}
      {d && tab === "posts" && d.posts.length === 0 && <EmptyState>아직 쓴 글이 없어요.</EmptyState>}
      {d && tab === "comments" && d.comments.length === 0 && <EmptyState>아직 쓴 댓글이 없어요.</EmptyState>}
      {d && tab === "posts" &&
        d.posts.map((p) => (
          <Link key={p.id} to={`${boardPath(p.board)}?post=${p.id}`} className={styles.maItem}>
            <span className={`tag ${p.board === "review" ? "tag-gold" : "tag-blue"}`}>{p.board === "review" ? "후기" : "자유"}</span>
            <span className={styles.maMain}>
              <span className={styles.maTitle}>
                {p.title}
                {p.commentCount > 0 && <span className={styles.cc}>[{p.commentCount}]</span>}
                {p.paid && <span className="tag tag-accent">+100P</span>}
                {p.board === "free" && <span className="tag">익명으로 올림</span>}
                {p.hidden && <span className="tag tag-live">신고로 가려짐</span>}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {p.broadcast ? `${p.broadcast} 방송 · ` : ""}
                {relTime(p.createdAt)}
              </span>
            </span>
          </Link>
        ))}
      {d && tab === "comments" &&
        d.comments.map((c, i) => (
          <Link key={i} to={`${boardPath(c.board)}?post=${c.postId}`} className={styles.maItem}>
            {c.board && <span className={`tag ${c.board === "review" ? "tag-gold" : "tag-blue"}`}>{c.board === "review" ? "후기" : "자유"}</span>}
            <span className={styles.maMain}>
              <span className={styles.maTitle}>
                {c.body}
                {c.hidden && <span className="tag tag-live">신고로 가려짐</span>}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {c.postTitle === null ? "삭제된 글" : c.postTitle === "" ? "가려진 글" : `글: ${c.postTitle}`} · {relTime(c.createdAt)}
              </span>
            </span>
          </Link>
        ))}
      <p className="muted" style={{ fontSize: 12, padding: "10px 12px 6px" }}>
        익명으로 쓴 글도 여기선 나에게만 보여요. 누르면 그 글로 이동해요.
      </p>
    </Card>
  );
}
