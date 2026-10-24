// 유진 키우기 v3 — 평행세계의 유진을 키우는 인생 게임(테스트 버전, 베타 빌드 전용).
// 화면 흐름: 로비 → 태어날 집 고르기(포인트) → 진행(해마다 이야기·주사위 갈림길·올해의 초점·사람·돈쓰기) → 인생 리포트, 그리고 도감.
// 인생 진행·결과는 전부 서버(life-game)가 정하고, 화면은 받은 기록을 속도에 맞춰 한 해씩 보여주기만 함.
// 넓은 화면에선 3단(상태·돈 / 올해 이야기·선택 / 초점·사람·쇼핑), 좁아지면 2단 → 1단으로 쌓임(컨테이너 폭 기준).
import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { startLogin, useAuth } from "../../lib/auth";
import { LoadError } from "../../components/LoadError";
import { useLifeLobby, useLifeVote, type Run } from "../../lib/life";
import styles from "./Life.module.css";
import { LifeVoteCard } from "./LifeVoteCard";
import { BirthView } from "./BirthView";
import { DexView } from "./DexView";
import { LobbyView } from "./LobbyView";
import { PlayView } from "./PlayView";
import { ReportView } from "./ReportView";
const LiveScreen = lazy(() => import("./LiveScreen"));

type Screen = { name: "lobby" } | { name: "birth" } | { name: "play"; run: Run } | { name: "report"; run: Run } | { name: "dex" };

export default function Life() {
  const { isLoggedIn, isAdmin } = useAuth();
  const q = useLifeLobby();
  const vote = useLifeVote();
  const qc = useQueryClient();
  const [screen, setScreen] = useState<Screen>({ name: "lobby" });

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0 });
  };
  const backToLobby = () => {
    qc.invalidateQueries({ queryKey: ["life-lobby"] });
    qc.invalidateQueries({ queryKey: ["life-dex"] });
    qc.invalidateQueries({ queryKey: ["me"] });
    go({ name: "lobby" });
  };

  // 방송 화면(OBS) — 진행 화면의 "방송 화면 열기"로 뜨는 창. 주인만.
  if (isAdmin && new URLSearchParams(location.search).get("screen") === "live") {
    return (
      <Suspense fallback={null}>
        <LiveScreen />
      </Suspense>
    );
  }
  const voteCard = vote.data?.open && !(isAdmin && screen.name === "play") ? <LifeVoteCard /> : null;

  if (!isLoggedIn) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <p className={styles.muted}>로그인하면 유진을 키울 수 있어요.</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={startLogin}>
            <LogIn size={18} aria-hidden="true" />
            치지직으로 로그인
          </button>
        </div>
      </div>
    );
  }
  if (q.isError && !q.data) {
    const notOpen = (q.error as { body?: { error?: string } })?.body?.error === "not_open";
    return (
      <div className={styles.page}>
        {voteCard}
        {notOpen ? !voteCard && <p className={styles.center}>아직 준비 중이에요.</p> : <LoadError what="유진 키우기" onRetry={() => q.refetch()} />}
      </div>
    );
  }
  const lobby = q.data;

  return (
    <div className={styles.page}>
      {lobby?.isTest && <div className={styles.testBar}>테스트 모드 · 본인만 보여요 · 포인트가 차감되지 않아요</div>}
      {voteCard}
      {screen.name === "lobby" && <LobbyView lobby={lobby} onStart={() => go({ name: "birth" })} onResume={(run) => go({ name: "play", run })} onReport={(run) => go({ name: "report", run })} onDex={() => go({ name: "dex" })} />}
      {screen.name === "birth" && lobby && <BirthView lobby={lobby} onBack={() => go({ name: "lobby" })} onStarted={(run) => go({ name: "play", run })} />}
      {screen.name === "play" && lobby && <PlayView key={screen.run.id} lobby={lobby} initial={screen.run} onReport={(run) => go({ name: "report", run })} onExit={backToLobby} />}
      {screen.name === "report" && <ReportView run={screen.run} onAgain={backToLobby} onDex={() => go({ name: "dex" })} />}
      {screen.name === "dex" && <DexView onBack={backToLobby} />}
    </div>
  );
}
