// 방송 스케줄 달력 — 하루에 한 건(방송 또는 휴방). 관리자는 날짜를 눌러 추가·수정·삭제.
import { SkelInline } from "../../components/Skeleton";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { Card } from "../../components/Card";
import { PageHead } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { kstToday, WEEK_KO } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { ScheduleEditor } from "./ScheduleEditor";
import styles from "./Schedule.module.css";

export type SchedRow = { day: string; kind: "live" | "off"; start_time: string | null; title: string; memo: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`; // m: 0~11

function gridRange(y: number, m: number) {
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((first + days) / 7);
  const f = (d: Date) => ymd(d.getFullYear(), d.getMonth(), d.getDate());
  return [f(new Date(y, m, 1 - first)), f(new Date(y, m, 1 - first + weeks * 7 - 1))] as const;
}

export default function Schedule() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const today = kstToday();
  const [ty, tm] = today.split("-").map(Number);
  const [view, setView] = useState({ y: ty, m: tm - 1 });
  const [selected, setSelected] = useState(today);
  const [editDay, setEditDay] = useState<string | null>(null);

  const [from, to] = gridRange(view.y, view.m);
  const q = useQuery({
    queryKey: ["schedule", "range", from, to],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("broadcast_schedule").select("day, kind, start_time, title, memo").gte("day", from).lte("day", to);
      if (error) throw error;
      return new Map(((data ?? []) as SchedRow[]).map((r) => [r.day, r]));
    },
  });
  const map = q.data ?? new Map<string, SchedRow>();

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const weeks = Math.ceil((first + days) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const dd = i - first + 1;
      const date = new Date(view.y, view.m, dd);
      return { day: ymd(date.getFullYear(), date.getMonth(), date.getDate()), d: date.getDate(), outside: dd < 1 || dd > days, col: i % 7 };
    });
  }, [view]);

  function move(delta: number) {
    const d = new Date(view.y, view.m + delta, 1);
    const next = { y: d.getFullYear(), m: d.getMonth() };
    setView(next);
    if (!selected.startsWith(`${next.y}-${pad(next.m + 1)}`)) {
      setSelected(next.y === ty && next.m === tm - 1 ? today : ymd(next.y, next.m, 1));
    }
  }

  const sel = map.get(selected);
  const [sy, sm, sd] = selected.split("-").map(Number);

  return (
    <div className="page">
      <PageHead title="방송 스케줄" desc="방송 일정과 쉬는 날을 확인할 수 있어요." />

      <div className={styles.layout}>
        <Card className={styles.calCard}>
          <div className={styles.top}>
            <button type="button" className="btn btn-ghost icon-btn" aria-label="이전 달" onClick={() => move(-1)}>
              <ChevronLeft size={20} />
            </button>
            <h2 className={styles.month}>
              {view.y}년 {view.m + 1}월
            </h2>
            <button type="button" className="btn btn-ghost icon-btn" aria-label="다음 달" onClick={() => move(1)}>
              <ChevronRight size={20} />
            </button>
            <button
              type="button"
              className={`btn btn-sm ${styles.mlAuto}`}
              onClick={() => {
                setView({ y: ty, m: tm - 1 });
                setSelected(today);
              }}
            >
              오늘
            </button>
          </div>

          <div className={styles.dow}>
            {WEEK_KO.map((w, i) => (
              <div key={w} className={i === 0 ? styles.sun : i === 6 ? styles.sat : ""}>
                {w}
              </div>
            ))}
          </div>
          <div className={styles.grid}>
            {cells.map((c) => {
              const row = map.get(c.day);
              const live = row?.kind === "live";
              const off = row?.kind === "off";
              const tbd = live && !row?.start_time;
              const cls = [
                styles.cell,
                c.outside && styles.other,
                c.day === today && styles.today,
                c.day === selected && styles.sel,
                live && styles.live,
                tbd && styles.tbd,
                off && styles.off,
                c.day < today && styles.past,
                c.col === 0 && styles.sun,
                c.col === 6 && styles.sat,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button key={c.day} type="button" className={cls} onClick={() => setSelected(c.day)} aria-pressed={c.day === selected} aria-label={`${c.day}${live ? " 방송" : off ? " 휴방" : ""}`}>
                  <span className={styles.cellHead}>
                    <span className={`${styles.num} num`}>{c.d}</span>
                    {live && <span className={`${styles.time} num`}>{tbd ? "미정" : row!.start_time}</span>}
                  </span>
                  {live && <span className={styles.cellTitle}>{row!.title}</span>}
                  {off && (
                    <span className={styles.offMark}>
                      <Moon size={12} aria-hidden="true" />
                      <span>휴방</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {q.isError && <p className="status error">스케줄을 불러오지 못했어요.</p>}
          <div className={styles.legend}>
            <span>
              <i className={styles.legLive} />
              방송
            </span>
            <span>
              <i className={styles.legTbd} />
              시간 미정
            </span>
            <span>
              <Moon size={12} aria-hidden="true" /> 휴방
            </span>
          </div>
        </Card>

        <Card className={styles.detail}>
          <div className={styles.detailDate}>
            <span className={`${styles.detailNum} num`}>{sd}</span>
            <span className="muted">
              {sm}월 · {WEEK_KO[new Date(sy, sm - 1, sd).getDay()]}요일
            </span>
          </div>
          <div className={styles.detailBody}>
            {q.isLoading && (
              <>
                <SkelInline w="60%" h={20} />
                <SkelInline w="40%" h={14} />
              </>
            )}
            {!q.isLoading && !sel && <p className="muted">{selected < today ? "방송이 없었어요." : "아직 정해진 일정이 없어요."}</p>}
            {sel?.kind === "off" && (
              <>
                <h3 className={styles.detailTitle}>
                  <Moon size={18} aria-hidden="true" /> 쉬는 날
                </h3>
                {sel.memo && <p className={styles.memo}>{sel.memo}</p>}
              </>
            )}
            {sel?.kind === "live" && (
              <>
                <span className={`tag ${sel.start_time ? "tag-accent" : "tag-gold"}`}>{sel.start_time ? `${sel.start_time} 시작` : "시간 미정"}</span>
                <h3 className={styles.detailTitle}>{sel.title}</h3>
                {sel.memo && <p className={styles.memo}>{sel.memo}</p>}
              </>
            )}
          </div>
          {isAdmin && (
            <button type="button" className="btn btn-sm" onClick={() => setEditDay(selected)}>
              {sel ? "수정" : "일정 추가"}
            </button>
          )}
        </Card>
      </div>

      {isAdmin && (
        <ScheduleEditor
          day={editDay}
          row={editDay ? (map.get(editDay) ?? null) : null}
          onClose={() => setEditDay(null)}
          onSaved={() => {
            setEditDay(null);
            qc.invalidateQueries({ queryKey: ["schedule"] });
          }}
        />
      )}
    </div>
  );
}
