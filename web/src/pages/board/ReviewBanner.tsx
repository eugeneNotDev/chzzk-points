// 방송 후기 보상 안내 — 방송 중이거나 종료 후 12시간 안에, 방송마다 첫 후기 한 번만 100P.
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../lib/auth";
import { boardCall } from "../../lib/board";
import styles from "./Board.module.css";

export function ReviewBanner() {
  const { token } = useAuth();
  const q = useQuery({
    queryKey: ["board", "review-status", token],
    staleTime: 60_000,
    queryFn: () => boardCall<{ isLive: boolean; eligible: boolean; alreadyRewarded: boolean; reward: number }>({ action: "review-status" }),
  });
  const s = q.data;
  if (!s) return null;
  let title: string;
  let sub = "방송 중이거나 종료 후 12시간 안에, 방송마다 첫 후기 한 번만 지급돼요.";
  let dim = false;
  if (s.eligible && !s.alreadyRewarded) title = `${s.isLive ? "지금 방송 중!" : "이번 방송"} 후기를 남기면 ${s.reward}P!`;
  else if (s.eligible) {
    title = "이번 방송 후기 보상은 이미 받았어요";
    sub = "다음 방송 때 첫 후기를 남기면 또 받을 수 있어요.";
    dim = true;
  } else {
    title = `방송 후기를 남기면 ${s.reward}P!`;
    dim = true;
  }
  return (
    <div className={`${styles.banner} ${dim ? styles.bannerDim : ""}`}>
      <span className={`${styles.bannerIc} num`}>+{s.reward}</span>
      <span className={styles.bannerText}>
        <b>{title}</b>
        <span>{sub}</span>
      </span>
    </div>
  );
}
