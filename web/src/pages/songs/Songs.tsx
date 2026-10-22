// 방종곡 신청 — songs 함수. 신청은 무료, 하루 1곡(한국시간 0시 초기화), 대기 중인 곡과 중복 불가.
// 신청 사유(선택, 80자)를 같이 적을 수 있고, 리스트에선 한 줄로 보이다가 누르면 말풍선으로 펼쳐짐.
// 관리자는 "틀었음"(기록으로 이동)·삭제, 아래에서 틀었던 곡 기록 검색·되돌리기.
import { SkelInline } from "../../components/Skeleton";
import { LoadError } from "../../components/LoadError";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Headphones, Music2, Quote, Search, X } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { ApiError, apiFetch, startLogin, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import styles from "./Songs.module.css";
import { SkeletonList } from "../../components/Skeleton";

type Song = { id: number; title: string; artist: string; reason: string | null; requester: string | null; anonymous?: boolean; createdAt: string; mine: boolean };
type SongList = { items: Song[]; canRequest: boolean; requestedToday: boolean; isAdmin: boolean; loggedIn: boolean };
type HistItem = { id: number; title: string; artist: string; reason: string | null; requester: string | null; playedAt: string };

const ERR: Record<string, string> = {
  duplicate: "이미 리스트에 있는 곡이에요.",
  already_today: "오늘은 이미 신청했어요. 내일 0시에 다시 신청할 수 있어요.",
  invalid_title: "곡 제목을 입력해주세요. (최대 60자)",
  invalid_artist: "가수를 입력해주세요. (최대 40자)",
  invalid_reason: "신청 사유는 80자까지 쓸 수 있어요.",
  banned: "이용이 제한된 계정이에요.",
  unauthorized: "로그인이 필요해요.",
  not_found: "이미 처리된 곡이에요. 새로고침해 주세요.",
};
function errText(e: unknown) {
  if (!(e instanceof ApiError)) return "처리하지 못했어요. 잠시 후 다시 시도해주세요.";
  const b = e.body as { error?: string; title?: string; artist?: string; position?: number };
  if (b.error === "duplicate" && b.title) return `이미 리스트에 있는 곡이에요 — ${b.position ? b.position + "번 " : ""}「${b.title} - ${b.artist}」`;
  return ERR[b.error ?? ""] || "처리하지 못했어요. 잠시 후 다시 시도해주세요.";
}
const call = <T,>(payload: Record<string, unknown>) => apiFetch<T>(API.songs, { body: payload });

function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}
function kstDate(iso: string) {
  const k = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${k.getUTCFullYear()}.${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
}

// 두 번 눌러야 실행되는 버튼(취소·삭제) — 확인창 대신 3초 동안 글자가 바뀜.
function ArmedButton({ className, label, armedLabel, onConfirm, children, ...rest }: {
  className: string;
  label?: string;
  armedLabel: string;
  onConfirm: () => Promise<unknown>;
  children?: React.ReactNode;
  title?: string;
  "aria-label"?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`${className} ${armed ? styles.armed : ""}`}
      disabled={busy}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 3000);
          return;
        }
        clearTimeout(timer.current);
        setBusy(true);
        await onConfirm().catch(() => undefined);
        setBusy(false);
        setArmed(false);
      }}
      {...rest}
    >
      {armed ? armedLabel : (children ?? label)}
    </button>
  );
}

export default function Songs() {
  const { isLoggedIn, channelId } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["songs", channelId],
    queryFn: () => call<SongList>({ action: "list" }),
    // 다른 시청자 신청이 들어오면 보이도록 30초마다(탭이 보일 때만) 새로고침
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const s = q.data;
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["songs"] });
  const act = async (payload: Record<string, unknown>, okText?: string) => {
    try {
      await call(payload);
      if (okText) setMsg({ text: okText, ok: true });
      await reload();
    } catch (e) {
      setMsg({ text: errText(e) });
      throw e;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn) return startLogin();
    if (busy || !s?.canRequest) return;
    const t = title.trim();
    const a = artist.trim();
    if (!t) return setMsg({ text: ERR.invalid_title });
    if (!a) return setMsg({ text: ERR.invalid_artist });
    setBusy(true);
    setMsg(null);
    try {
      await call({ action: "request", title: t, artist: a, reason: reason.trim() || undefined });
      setTitle("");
      setArtist("");
      setReason("");
      setMsg({ text: "신청했어요! 방종 때 틀어드릴게요 🎵", ok: true });
    } catch (er) {
      setMsg({ text: errText(er) });
    }
    setBusy(false);
    reload();
  };

  const canType = isLoggedIn && !!s?.canRequest;
  let btnLabel = "불러오는 중";
  if (!isLoggedIn) btnLabel = "로그인하고 신청하기";
  else if (s && !s.canRequest) btnLabel = "오늘 신청 완료";
  else if (s) btnLabel = busy ? "신청 중..." : "신청하기";

  return (
    <div className="page">
      <PageHead title="방종곡 신청" desc="방송 끝날 때 틀었으면 하는 노래를 신청해주세요." />

      <div className="split">
      <aside className="split-aside split-aside-first">
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <span className={styles.heroIc} aria-hidden="true">
            <Music2 size={24} />
          </span>
          <div className={styles.heroText}>
            <h3>방종곡 신청하기</h3>
            <div className={styles.chips}>
              <span className={styles.chip}>
                대기 <b className="num">{s ? `${s.items.length}곡` : <SkelInline w={28} h={11} />}</b>
              </span>
              {isLoggedIn && s && (
                <span className={`${styles.chip} ${s.canRequest ? styles.chipOn : styles.chipDone}`}>
                  {s.canRequest ? (
                    <>
                      오늘 내 신청 <b>가능</b>
                    </>
                  ) : (
                    <>
                      오늘 내 신청 <b>완료</b> · 내일 0시에 다시 가능
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
        <form className={styles.form} onSubmit={submit} autoComplete="off">
          <input className="input" maxLength={60} placeholder="곡 제목" aria-label="곡 제목" disabled={!canType} value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" maxLength={40} placeholder="가수" aria-label="가수" disabled={!canType} value={artist} onChange={(e) => setArtist(e.target.value)} />
          <div className={styles.reasonBox}>
            <textarea
              className={`input ${styles.reason}`}
              maxLength={80}
              rows={2}
              placeholder="신청 사유 (선택)"
              aria-label="신청 사유"
              disabled={!canType}
              value={reason}
              onChange={(e) => setReason(e.target.value.replace(/\n/g, " "))}
            />
            <span className={`num ${styles.count}`}>{reason.length}/80</span>
          </div>
          <button type="submit" className="btn btn-primary" disabled={isLoggedIn && (!canType || busy)}>
            {btnLabel}
          </button>
        </form>
        {msg && <p className={msg.ok ? styles.msgOk : styles.msgErr}>{msg.text}</p>}
        <ul className={styles.rules}>
          <li>한 사람당 하루 1곡 (한국시간 0시 초기화)</li>
          <li>이미 리스트에 있는 곡은 중복 신청 불가</li>
          <li>방종 때 순서대로 틀어드려요</li>
          <li>신청 사유는 신청 리스트에 같이 보여요</li>
        </ul>
      </section>
      </aside>

      <div className="split-main">
      <Card title="신청 리스트" extra={<span className="muted">신청순</span>} flush>
        {s?.isAdmin && (
          <div className={styles.adminBar}>
            <span className="tag tag-blue">관리자</span>
            <span>
              방종 때 틀고 나서 <b>틀었음</b>을 누르면 리스트에서 빠지고 아래 기록으로 가요
            </span>
          </div>
        )}
        {q.isLoading && <SkeletonList rows={4} variant="row" />}
        {q.isError && <LoadError what="신청 리스트" onRetry={() => q.refetch()} />}
        {s && s.items.length === 0 && (
          <EmptyState>
            <Headphones size={28} aria-hidden="true" />
            <br />
            아직 신청된 곡이 없어요. 첫 곡을 신청해보세요!
          </EmptyState>
        )}
        <ol className={styles.list}>
          {s?.items.map((it, i) => {
            const mine = it.mine && !s.isAdmin;
            const isOpen = !!it.reason && open.has(it.id);
            return (
              <li key={it.id} className={`${styles.entry} ${i === 0 ? styles.first : ""} ${mine ? styles.mine : ""} ${it.reason ? styles.hasReason : ""}`}>
              <div
                className={styles.item}
                onClick={(e) => {
                  // 버튼(틀었음·삭제·취소)을 누른 건 펼치기로 치지 않음
                  if (it.reason && !(e.target as HTMLElement).closest("button")) toggle(it.id);
                }}
              >
                <span className={`${styles.no} num`}>{i + 1}</span>
                <div className={styles.main}>
                  {/* 시안 B: 곡 제목 · 가수를 한 줄에, 그 아래 사유 한 줄 */}
                  <div className={styles.title}>
                    <span className={styles.t}>{it.title}</span>
                    <span className={styles.artistInline}>· {it.artist}</span>
                    {mine && <span className="tag tag-accent">내 신청</span>}
                    {i === 0 && <span className="tag tag-gold">다음 곡</span>}
                  </div>
                  {it.reason && (
                    <div className={`${styles.fold1} ${!isOpen ? styles.shown : ""}`} aria-hidden={isOpen}>
                      <div className={styles.foldIn}>
                        <div className={styles.reasonLine}>
                          <Quote size={12} aria-hidden="true" />
                          <span>{it.reason}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className={styles.by}>
                  <div className={`${styles.nm} ${it.requester === "익명" ? styles.anon : ""}`} title={it.anonymous && it.requester !== "익명" ? "이름 비공개 — 다른 사람에겐 익명으로 보여요" : undefined}>
                    {it.requester || "익명"}
                    {it.anonymous && it.requester && it.requester !== "익명" && <span className={styles.anonMark}> (익명)</span>}
                  </div>
                  <div className={styles.tm}>{ago(it.createdAt)}</div>
                </div>
                {mine && (
                  <ArmedButton className={`${styles.del} ${styles.cancelX}`} armedLabel="취소?" title="신청 취소 (취소하면 오늘은 다시 신청할 수 없어요)" aria-label="신청 취소" onConfirm={() => act({ action: "cancel", id: it.id }, "신청을 취소했어요.")}>
                    <X size={16} aria-hidden="true" />
                  </ArmedButton>
                )}
                {s.isAdmin && (
                  <div className={styles.adminBtns}>
                    <PlayedButton
                      onClick={async () => {
                        await act({ action: "admin-played", id: it.id });
                        qc.invalidateQueries({ queryKey: ["songs-history"] });
                      }}
                    />
                    <ArmedButton className={styles.del} armedLabel="삭제?" title="삭제" aria-label="삭제" onConfirm={() => act({ action: "admin-delete", id: it.id })}>
                      <X size={16} aria-hidden="true" />
                    </ArmedButton>
                  </div>
                )}
                {it.reason && (
                  <button type="button" className={`${styles.fold} ${isOpen ? styles.foldOpen : ""}`} onClick={() => toggle(it.id)} aria-expanded={isOpen} aria-label={isOpen ? "신청 사유 접기" : "신청 사유 펼치기"}>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                )}
                {/* 버튼이 있는 줄(관리자·내 신청)은 화살표 자리를 비워 버튼 위치를 다른 줄과 맞춤 */}
                {!it.reason && (s.isAdmin || mine) && <span className={styles.foldSpace} aria-hidden="true" />}
              </div>
              {it.reason && (
                <div className={`${styles.fold1} ${styles.bubbleWrap} ${isOpen ? styles.shown : ""}`} aria-hidden={!isOpen}>
                  <div className={styles.foldIn}>
                    <div className={styles.bubble}>
                      <Quote size={14} aria-hidden="true" />
                      <p>{it.reason}</p>
                    </div>
                  </div>
                </div>
              )}
              </li>
            );
          })}
        </ol>
      </Card>

      {s?.isAdmin && <History />}
      </div>
      </div>
    </div>
  );
}

function PlayedButton({ onClick }: { onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={styles.played}
      disabled={busy}
      title="틀었음 (리스트에서 빼고 기록으로)"
      aria-label="틀었음"
      onClick={async () => {
        setBusy(true);
        await onClick().catch(() => undefined);
        setBusy(false);
      }}
    >
      <Check size={17} strokeWidth={3} aria-hidden="true" />
    </button>
  );
}

// 관리자 전용 — 틀었던 곡 기록 검색·되돌리기
function History() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["songs-history", query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => call<{ items: HistItem[]; hasMore: boolean; page: number }>({ action: "admin-history", q: query, page: pageParam }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const [failed, setFailed] = useState<Record<number, string>>({});

  const restore = async (id: number) => {
    try {
      await call({ action: "admin-restore", id });
      await qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["songs-history"] });
    } catch (e) {
      setFailed((f) => ({ ...f, [id]: e instanceof ApiError && e.body.error === "duplicate" ? "이미 대기 중" : "실패" }));
    }
  };

  return (
    <Card title="틀었던 곡 기록" flush>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
        }}
        autoComplete="off"
      >
        <input type="search" className="input" maxLength={40} placeholder="곡 제목 · 가수 · 신청자로 검색" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="btn btn-ghost">
          <Search size={16} aria-hidden="true" />
          검색
        </button>
      </form>
      {q.isError && <LoadError what="신청 기록" onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState>{query ? `"${query}" 검색 결과가 없어요.` : "아직 틀었던 곡이 없어요."}</EmptyState>}
      <ul className={styles.list}>
        {items.map((it) => (
          <li key={it.id} className={styles.item}>
            <div className={styles.main}>
              <div className={styles.title}>
                <span className={styles.t}>{it.title}</span>
              </div>
              <div className={styles.artist}>{it.artist}</div>
              {it.reason && (
                <div className={`${styles.reasonLine} ${styles.reasonWrap}`}>
                  <Quote size={12} aria-hidden="true" />
                  <span>{it.reason}</span>
                </div>
              )}
            </div>
            <div className={styles.by}>
              <div className={styles.nm}>{it.requester || "알 수 없음"}</div>
              <div className={styles.tm}>{kstDate(it.playedAt)} 재생</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!failed[it.id]} onClick={() => restore(it.id)}>
              {failed[it.id] || "되돌리기"}
            </button>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <div className={styles.more}>
          <button type="button" className="btn btn-ghost" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            더 보기
          </button>
        </div>
      )}
    </Card>
  );
}
