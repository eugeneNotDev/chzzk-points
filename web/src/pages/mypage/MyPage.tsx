// 마이페이지 — 포인트·칭호·등급 요약, 앱 설치/방송 알림, 칭호 장착, 랭킹 공개 설정, 포인트 내역, 내 활동.
import { SkeletonList } from "../../components/Skeleton";
import { SkelInline } from "../../components/Skeleton";
import { LoadError } from "../../components/LoadError";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppInstallCard } from "../../components/AppInstallCard";
import { Avatar } from "../../components/Avatar";
import { Card, EmptyState } from "../../components/Card";
import { Pagination } from "../../components/Pagination";
import { TitleStage, TitleText } from "../../components/TitlePlate";
import { SpecialTitleLine } from "../../components/TitleBadge";
import { TitlePreview } from "../shop/TitlePreview";
import { LoginNeeded, Modal, PageHead } from "../../components/ui";
import { apiFetch, ApiError, getChannelId, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { fmt, relTime } from "../../lib/format";
import { useMe, useTitles, type Me, type SpecialOwned } from "../../lib/queries";
import { PillTabs } from "../../components/PillTabs";
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
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function MyPage() {
  const auth = useAuth();
  // 알림에서 "특수 칭호를 받았어요"를 누르면 ?titles=special 로 와서 칭호 창이 특수 칭호 탭으로 열림
  const [params, setParams] = useSearchParams();
  const linked = params.get("titles");
  const [titlesOpen, setTitlesOpen] = useState(!!linked);
  const [titlesTab, setTitlesTab] = useState<"title" | "special">(linked === "special" ? "special" : "title");
  const [lastLinked, setLastLinked] = useState(linked);
  if (linked !== lastLinked) {
    setLastLinked(linked);
    if (linked) {
      setTitlesTab(linked === "special" ? "special" : "title");
      setTitlesOpen(true);
    }
  }
  const closeTitles = () => {
    setTitlesOpen(false);
    if (linked) setParams({}, { replace: true });
  };
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
  const shownSpecial = profile?.specialTitles?.find((t) => t.id === profile.selectedSpecialId) ?? null;

  return (
    <div className="page">
      <PageHead title="마이페이지" />

      <Card className={styles.summary}>
        <div className={styles.who}>
          <Avatar name={auth.channelName} image={auth.profileImage} size={56} />
          <div className={styles.whoText}>
            <span className={styles.name}>{profile?.channelName || auth.channelName || <SkelInline w={110} h={20} />}</span>
            <span className="muted">치지직 계정으로 로그인됨</span>
          </div>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className="muted">현재 포인트</span>
            <b className={`num ${styles.balance} ${profile && profile.balance < 0 ? styles.neg : ""}`}>
              {profile ? <AnimatedNumber value={profile.balance} /> : <SkelInline w={110} h={26} />}
              <small>P</small>
            </b>
          </div>
          <button type="button" className={`${styles.stat} ${styles.statBtn}`} onClick={() => {
              setTitlesTab("title");
              setTitlesOpen(true);
            }} aria-haspopup="dialog" title="눌러서 칭호 바꾸기">
            <span className="muted">칭호</span>
            <span className={`${styles.statVal} ${styles.titleVal}`}>
              {shownSpecial && <SpecialTitleLine list={[shownSpecial]} />}
              {equipped ? <TitleText name={equipped.name} value={equipped.color} /> : !shownSpecial && "미장착"}
            </span>
          </button>
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
      <TitlesModal open={titlesOpen} onClose={closeTitles} profile={profile} tab={titlesTab} onTab={setTitlesTab} />

      <div className={styles.cols}>
        <div className={styles.col}>
          <PublicCard profile={profile} />
          <AppInstallCard />
          <MyActivity />
        </div>
        <div className={styles.col}>
          <PointsLog />
        </div>
      </div>
    </div>
  );
}

// 칭호 관리 — 마이페이지 위 "칭호" 박스를 누르면 뜸. 칭호 / 특수 칭호 탭.
function TitlesModal({
  open,
  onClose,
  profile,
  tab,
  onTab: setTab,
}: {
  open: boolean;
  onClose: () => void;
  profile: Me | undefined;
  tab: "title" | "special";
  onTab: (t: "title" | "special") => void;
}) {
  const titles = useTitles();
  const ownedCount = (titles.data ?? []).filter((t) => (profile?.purchasedTitleIds ?? []).includes(t.id)).length;
  const spCount = profile?.specialTitles?.length ?? 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="내 칭호"
      actions={
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
      }
    >
      <PillTabs
        size="sm"
        label="칭호 종류"
        value={tab}
        onChange={setTab}
        options={[
          { value: "title", label: `칭호 ${ownedCount}` },
          { value: "special", label: `특수 칭호 ${spCount}` },
        ]}
      />
      <div className={styles.tabBody}>{tab === "title" ? <TitleList profile={profile} /> : <SpecialList profile={profile} />}</div>
    </Modal>
  );
}

function TitleList({ profile }: { profile: Me | undefined }) {
  const titles = useTitles();
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const owned = (titles.data ?? []).filter((t) => (profile?.purchasedTitleIds ?? []).includes(t.id));
  const previewT = previewId ? owned.find((t) => t.id === previewId) : undefined;

  async function equip(id: string) {
    if (!profile) return;
    const next = profile.selectedTitleId === id ? null : id;
    setBusy(true);
    setStatus({ text: "" });
    try {
      const data = await apiFetch<Me>(API.me, { body: { selectedTitleId: next } });
      qc.setQueryData(["me", getChannelId()], data);
      qc.invalidateQueries({ queryKey: ["ranking"] });
      setStatus({ text: next ? "칭호를 장착했어요." : "칭호를 해제했어요." });
    } catch (e) {
      setStatus({ text: e instanceof ApiError && e.body.error === "title_locked" ? "아직 잠긴 칭호예요." : "칭호 변경에 실패했어요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={`muted ${styles.tabDesc}`}>
        상점에서 구매했거나 선물받은 칭호예요. 랭킹에서 닉네임 옆에 붙고, 내 줄이 칭호 색으로 꾸며져요.
        <br />
        칭호를 누르면 장착한 모습을 미리 볼 수 있어요.
        <br />
        <Link to="/titles.html" className={styles.link}>
          칭호 상점 가기
        </Link>
      </p>
      {titles.isLoading && <span className={`skeleton ${styles.titlesSkel}`} />}
      {profile && titles.data && owned.length === 0 && <EmptyState>보유한 칭호가 없어요.</EmptyState>}
      <div className={styles.titleGrid}>
        {owned.map((t) => {
          const sel = profile?.selectedTitleId === t.id;
          return (
            <div key={t.id} className={`${styles.titleItem} ${sel ? styles.titleSel : ""}`}>
              <TitleStage name={t.name} value={t.color} sub={sel ? "장착 중" : undefined} onClick={() => setPreviewId(t.id)} />
              <span className={`muted ${styles.fs12}`}>
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
      <TitlePreview
        title={previewT ? { heading: `[${previewT.name}]`, name: previewT.name, color: previewT.color } : null}
        balance={profile?.balance ?? 0}
        actions={
          previewT && (
            <button type="button" className={`btn ${profile?.selectedTitleId === previewT.id ? "" : "btn-primary"}`} disabled={busy} onClick={() => equip(previewT.id)}>
              {profile?.selectedTitleId === previewT.id ? "장착 해제" : "장착하기"}
            </button>
          )
        }
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}

// 특수 칭호 — 랭킹 닉네임 위 작은 글씨. 관리자 지급·지난달 1~3위 칭호 중 하나를 골라 장착.
// 관리자가 고정한 칭호가 있으면(specialLocked) 그게 항상 보이고 바꿀 수 없음.
function SpecialList({ profile }: { profile: Me | undefined }) {
  const titles = useTitles();
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const list = profile?.specialTitles ?? [];
  if (!profile) return null;
  if (list.length === 0) return <EmptyState>가진 특수 칭호가 없어요. 관리자 지급이나 매달 랭킹 1~3위 보상으로 받을 수 있어요.</EmptyState>;
  const locked = !!profile.specialLocked;
  const shop = titles.data?.find((t) => t.id === profile.selectedTitleId) ?? null;
  const previewT = previewId != null ? list.find((t) => t.id === previewId) : undefined;
  const sourceText = (t: SpecialOwned) => (t.forced ? "관리자가 고정한 칭호" : t.source === "monthly" ? "랭킹 보상 · 다음 달 1일까지" : "관리자가 지급한 칭호");

  async function equip(id: number) {
    if (!profile || locked) return;
    const next = profile.selectedSpecialId === id ? null : id;
    setBusy(true);
    setStatus({ text: "" });
    try {
      const data = await apiFetch<Me>(API.me, { body: { selectedSpecialId: next } });
      qc.setQueryData(["me", getChannelId()], data);
      qc.invalidateQueries({ queryKey: ["ranking"] });
      setStatus({ text: next ? "특수 칭호를 장착했어요." : "특수 칭호를 해제했어요." });
    } catch (e) {
      const code = e instanceof ApiError ? e.body.error : "";
      setStatus({ text: code === "special_locked" ? "관리자가 고정한 칭호가 있어서 바꿀 수 없어요." : "특수 칭호 변경에 실패했어요.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const button = (t: SpecialOwned, cls = "btn-sm") => {
    const sel = profile.selectedSpecialId === t.id;
    if (locked) {
      return (
        <button type="button" className={`btn ${cls}`} disabled>
          {sel ? "고정됨" : "바꿀 수 없음"}
        </button>
      );
    }
    return (
      <button type="button" className={`btn ${cls} ${sel ? "" : "btn-primary"}`} disabled={busy} onClick={() => equip(t.id)}>
        {sel ? "장착 해제" : "장착하기"}
      </button>
    );
  };

  return (
    <>
      <p className={`muted ${styles.tabDesc}`}>
        {locked ? (
          <>
            관리자가 고정한 특수 칭호가 있어서 그 칭호가 항상 보여요.
            <br />
            해제하거나 다른 특수 칭호로 바꿀 수 없어요.
          </>
        ) : (
          <>
            랭킹에서 닉네임 위에 작게 붙는 칭호예요. 하나를 골라 장착할 수 있어요.
            <br />
            칭호를 누르면 장착한 모습을 미리 볼 수 있어요.
            <br />
            <b className={styles.bonusNote}>적립 보너스</b>가 있는 칭호는 장착하는 동안 출석·방송 코드·방송 후기·게시판 활동으로 받는 포인트가 늘어나요.
          </>
        )}
      </p>
      <div className={styles.titleGrid}>
        {list.map((t) => {
          const sel = profile.selectedSpecialId === t.id;
          return (
            <div key={t.id} className={`${styles.titleItem} ${sel ? styles.titleSel : ""}`}>
              <button type="button" className={styles.spStage} onClick={() => setPreviewId(t.id)} aria-label={`${t.name} 특수 칭호 미리보기`}>
                <SpecialTitleLine list={[t]} />
                {sel && <span className={styles.spSub}>{locked ? "고정" : "장착 중"}</span>}
              </button>
              {!!t.bonusPct && <span className={styles.bonusChip}>적립 +{t.bonusPct}%</span>}
              <span className={`muted ${styles.fs12}`}>
                {sourceText(t)}
              </span>
              {button(t)}
            </div>
          );
        })}
      </div>
      <p className={`status ${status.error ? "error" : "ok"}`}>{status.text}</p>
      <TitlePreview
        title={previewT ? { heading: previewT.name, name: previewT.name, color: previewT.color, special: true, shop: shop ? { name: shop.name, color: shop.color } : null } : null}
        balance={profile.balance}
        actions={previewT && button(previewT, "")}
        onClose={() => setPreviewId(null)}
      />
    </>
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
    qc.setQueryData(["me", getChannelId()], { ...profile, isPublic: next });
    try {
      await apiFetch(API.me, { body: { isPublic: next } });
      setStatus({ text: next ? "공개로 설정됐어요." : "비공개로 설정됐어요." });
      qc.invalidateQueries({ queryKey: ["ranking"] });
    } catch {
      qc.setQueryData(["me", getChannelId()], prev);
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
      <p className={`status ${status.error ? "error" : "ok"} ${styles.mt8}`}>
        {status.text}
      </p>
    </Card>
  );
}

function PointsLog() {
  const { channelId } = useAuth();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["points-log", channelId, page],
    placeholderData: (prev) => prev,
    queryFn: () => apiFetch<{ entries: LogEntry[]; page: number; totalPages: number }>(`${API.me}?action=points-log&page=${page}`),
  });
  return (
    <Card title="포인트 내역" flush>
      <p className={`muted ${styles.fs13} ${styles.p_0_12_8}`}>
        출석·상점·미니게임·관리자 지급/차감 내역을 최신순으로 보여줘요.
      </p>
      {q.isLoading && <SkeletonList rows={5} variant="log" />}
      {q.isError && <LoadError what="포인트 내역" onRetry={() => q.refetch()} />}
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
  const { channelId } = useAuth();
  const [tab, setTab] = useState<"posts" | "comments">("posts");
  const q = useQuery({
    queryKey: ["board", "my-activity", channelId],
    queryFn: () => apiFetch<Activity>(API.board, { body: { action: "my-activity" } }),
  });
  const d = q.data;
  const boardPath = (b: string | null) => (b === "review" ? "/board-review.html" : "/board-free.html");

  return (
    <Card
      title="내 활동"
      flush
      extra={
        <PillTabs
          size="sm"
          label="내 활동 종류"
          className={styles.maTabs}
          value={tab}
          onChange={setTab}
          options={[
            { value: "posts", label: `내 글 ${d?.postCount ?? ""}` },
            { value: "comments", label: `내 댓글 ${d?.commentCount ?? ""}` },
          ]}
        />
      }
    >
      <div className={styles.maStats}>
        <div>
          <span className="muted">쓴 글</span>
          <b className="num">{d ? fmt(d.postCount) : <SkelInline w={30} h={18} />}</b>
        </div>
        <div>
          <span className="muted">쓴 댓글</span>
          <b className="num">{d ? fmt(d.commentCount) : <SkelInline w={30} h={18} />}</b>
        </div>
        <div>
          <span className="muted">후기 보상</span>
          <b className="num">{d ? `+${fmt(d.rewardTotal)}P` : <SkelInline w={56} h={18} />}</b>
        </div>
      </div>
      {q.isError && <LoadError what="내 활동" onRetry={() => q.refetch()} />}
      {!d && !q.isError && <SkeletonList rows={3} variant="row" />}
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
              <span className={`muted ${styles.fs12}`}>
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
              <span className={`muted ${styles.fs12}`}>
                {c.postTitle === null ? "삭제된 글" : c.postTitle === "" ? "가려진 글" : `글: ${c.postTitle}`} · {relTime(c.createdAt)}
              </span>
            </span>
          </Link>
        ))}
      <p className={`muted ${styles.fs12} ${styles.p_10_12_6}`}>
        익명으로 쓴 글도 여기선 나에게만 보여요. 누르면 그 글로 이동해요.
      </p>
    </Card>
  );
}
