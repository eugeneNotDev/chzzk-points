// 마이페이지 — 포인트·칭호·등급 요약, 앱 설치/방송 알림, 칭호 장착, 랭킹 공개 설정, 포인트 내역, 내 활동.
import { SkelInline } from "../../components/Skeleton";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AppInstallCard } from "../../components/AppInstallCard";
import { Avatar } from "../../components/Avatar";
import { Card } from "../../components/Card";
import { TitleText } from "../../components/TitlePlate";
import { SpecialTitleLine } from "../../components/TitleBadge";
import { LoginNeeded, PageHead } from "../../components/ui";
import { apiFetch, getChannelId, useAuth } from "../../lib/auth";
import { API } from "../../lib/config";
import { useMe, useTitles, type Me } from "../../lib/queries";
import styles from "./MyPage.module.css";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { MyActivity, PointsLog } from "./MyLogs";
import { TitlesModal } from "./MyTitles";

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
