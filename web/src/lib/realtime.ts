// Supabase 실시간 구독 훅 — 테이블에 변화가 생기면 관련 화면 데이터를 다시 불러옴.
import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "./supabase";

let channelSeq = 0;

// table에 INSERT/UPDATE/DELETE가 오면 queryKeys를 다시 불러옴.
//  - minIntervalMs: 신호가 아무리 많이 와도 이 간격에 한 번만(마지막 신호는 놓치지 않음)
//  - 탭이 안 보이는 동안은 미뤘다가 다시 보일 때 한 번
// 랭킹은 ranking_pings(포인트가 움직일 때마다 트리거가 채우는 공개 신호용 테이블)를 구독함 —
// points_ledger는 RLS로 막혀있어서 직접 구독 못 함(0019_admin_features.sql).
export function useTableRefetch(
  table: string,
  queryKeys: QueryKey[],
  { event = "*", minIntervalMs = 1000, settleMs = 500 }: { event?: "*" | "INSERT" | "UPDATE" | "DELETE"; minIntervalMs?: number; settleMs?: number } = {},
) {
  const qc = useQueryClient();
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    let lastRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;

    const run = () => {
      timer = null;
      if (document.hidden) return;
      dirty = false;
      lastRun = Date.now();
      keysRef.current.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    };
    const ping = () => {
      dirty = true;
      if (document.hidden || timer) return;
      timer = setTimeout(run, Math.max(settleMs, lastRun + minIntervalMs - Date.now()));
    };
    const onVis = () => {
      if (!document.hidden && dirty) ping();
    };
    document.addEventListener("visibilitychange", onVis);

    const channel = supabase
      .channel(`rt_${table}_${++channelSeq}`)
      .on("postgres_changes" as never, { event, schema: "public", table }, ping)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(channel);
    };
  }, [table, event, minIntervalMs, settleMs, qc]);
}
