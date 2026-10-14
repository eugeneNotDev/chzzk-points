import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "../../components/ui";
import { Pagination } from "../../components/Pagination";
import { TitleBadge } from "../../components/TitleBadge";
import { apiFetch } from "../../lib/auth";
import { API } from "../../lib/config";
import { adminCall, fmtDateTime, num, type UserDetail } from "../../lib/admin";
import { LogRow } from "./LogRow";
import { TitlesModal } from "./TitlesModal";
import styles from "./Admin.module.css";

type Block = { blocked: boolean; forever: boolean; until: string | null };
const DURATION_LABEL: Record<string, string> = { day: "하루", week: "일주일", month: "한 달", forever: "계속" };

export function UserDetailModal({ channelId, onClose, onChanged }: { channelId: string | null; onClose: () => void; onChanged?: () => void }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [titlesOpen, setTitlesOpen] = useState(false);
  useEffect(() => {
    setPage(1);
    setTitlesOpen(false);
  }, [channelId]);

  const key = ["admin", "user-detail", channelId];
  const q = useQuery({
    queryKey: [...key, page],
    enabled: !!channelId,
    placeholderData: keepPreviousData,
    queryFn: () => adminCall<UserDetail>({ action: "get-user-detail", channelId, page }),
  });
  const d = q.data && q.data.channelId === channelId ? q.data : undefined;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    onChanged?.();
  };

  const equipped = d?.ownedTitles.find((t) => t.equipped);

  return (
    <>
      <Modal open={!!channelId} onClose={onClose} wide title={d ? d.channelName || "(이름 없음)" : q.isError ? "불러오지 못했어요." : "불러오는 중..."} subtitle={d ? `가입일 ${fmtDateTime(d.createdAt)}${d.banned ? " · 밴됨" : ""}` : undefined}>
        {d && (
          <div className={styles.detail}>
            <div className={styles.detailStats}>
              <div>
                <strong className="num">{num(d.balance)}P</strong>
                <span>현재 잔액</span>
              </div>
              <div>
                <strong className="num">{num(d.maxBalanceReached)}P</strong>
                <span>역대 최고 보유</span>
              </div>
              <div>
                <strong className="num">{num(d.attendanceCount)}회</strong>
                <span>출석체크</span>
              </div>
              <div>
                <strong>{d.isPublic ? "공개" : "비공개"}</strong>
                <span>공개 설정</span>
              </div>
            </div>

            <div className={styles.detailRow}>
              <div>
                <h4>칭호</h4>
                <p className={styles.muted}>
                  {d.ownedTitles.length === 0 ? (
                    "보유한 칭호가 없어요."
                  ) : (
                    <>
                      보유 {num(d.ownedTitles.length)}개 · {equipped ? <>장착 중 <TitleBadge name={equipped.name} value={equipped.color} /></> : "장착 안 함"}
                    </>
                  )}
                </p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTitlesOpen(true)}>
                칭호 관리
              </button>
            </div>

            {channelId && <MinigameBlock channelId={channelId} name={d.channelName || ""} />}

            <h4 className={styles.detailH}>포인트 내역</h4>
            {d.log.length === 0 ? (
              <p className={styles.muted}>내역이 없어요.</p>
            ) : (
              <div className={styles.logList}>
                {d.log.map((e) => (
                  <LogRow key={e.id} e={e} showName={false} onUndone={refresh} />
                ))}
              </div>
            )}
            <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
          </div>
        )}
      </Modal>
      {d && channelId && <TitlesModal open={titlesOpen} onClose={() => setTitlesOpen(false)} channelId={channelId} name={d.channelName || "유저"} owned={d.ownedTitles} onChanged={refresh} />}
    </>
  );
}

// 미니게임 차단 — 기간을 정해 룰렛·가위바위보·홀짝 참여를 막음(무료 뽑기·투표는 그대로).
function MinigameBlock({ channelId, name }: { channelId: string; name: string }) {
  const qc = useQueryClient();
  const key = ["admin", "minigame-block", channelId];
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<Block>(`${API.adminMinigameBlock}?channelId=${encodeURIComponent(channelId)}`) });
  const [duration, setDuration] = useState("day");
  const [busy, setBusy] = useState(false);
  const s = q.data;
  const set = async (dur: string) => {
    const msg =
      dur === "off" ? `${name}님의 미니게임 차단을 풀까요?` : `${name}님의 미니게임 참여를 ${DURATION_LABEL[dur]} 막을까요?\n(룰렛·가위바위보·홀짝 불가, 무료 뽑기·투표는 가능)`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const r = await apiFetch<Block>(API.adminMinigameBlock, { body: { channelId, duration: dur } });
      qc.setQueryData(key, r);
    } catch {
      alert("변경하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  const status = !s
    ? q.isError
      ? "상태를 불러오지 못했어요."
      : "불러오는 중..."
    : !s.blocked
      ? "참여 가능"
      : s.forever
        ? "차단 중 — 기간 없이 계속"
        : `차단 중 — ${new Date(s.until!).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}까지`;
  return (
    <div className={styles.detailRow}>
      <div>
        <h4>미니게임</h4>
        <p className={s?.blocked ? styles.blockedText : styles.muted}>{status}</p>
      </div>
      <div className={styles.inline}>
        <select className="select" value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="차단 기간">
          {Object.entries(DURATION_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-danger btn-sm" disabled={!s || busy} onClick={() => set(duration)}>
          {s?.blocked ? "기간 바꾸기" : "차단"}
        </button>
        {s?.blocked && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => set("off")}>
            해제
          </button>
        )}
      </div>
    </div>
  );
}
