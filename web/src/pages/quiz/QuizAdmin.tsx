// 퀴즈(유진고사) — 관리자(유진 알파 계정). 서버: admin-quiz 함수.
//  모의고사: 문항 만들기 → 제출 받기(제한시간 없음) → 제출 마감 → 방송에서 시험지 한 장씩 ○/✕ 채점 → 결과 발표 → 보상 지급
//  OX: 진행 시작 → 문제 출제(대기열/즉석) → 정답 공개 → 종료 → 보상 지급
// 테스트 회차는 보상 지급을 눌러도 포인트가 안 들어가고 "누구에게 얼마"만 남음.
// 모의고사는 QuizAdminExam, OX는 QuizAdminOx, 같이 쓰는 건 quizAdminShared에 있음
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings, Trash2 } from "lucide-react";
import { Card, EmptyState } from "../../components/Card";
import { Select } from "../../components/Select";
import { Modal } from "../../components/ui";
import { confirmDialog } from "../../lib/dialog";
import { fmt } from "../../lib/format";
import { type QuizStatus } from "../../lib/quiz";
import { readStorage, writeStorage } from "../../lib/storage";
import { adminCall, useAct, useQuizAdminLive, type Detail, type ListItem, type QuizRow } from "./quizAdminShared";
import { ExamAdmin } from "./QuizAdminExam";
import { OxAdmin } from "./QuizAdminOx";
import styles from "./Quiz.module.css";

// Quiz.tsx가 여기서 방송 화면들을 lazy로 불러감
export { ExamGradeStream } from "./QuizAdminExam";
export { OxStream } from "./QuizAdminOx";

const LAST_ADMIN_KEY = "chzzk_quiz_admin_last";
const STATUS_LABEL: Record<"exam" | "ox", Record<QuizStatus, string>> = {
  exam: { draft: "준비 중", open: "제출 받는 중", closed: "채점 중", revealed: "발표 끝" },
  ox: { draft: "준비 중", open: "진행 중", closed: "진행 중", revealed: "종료" },
};

export default function QuizAdmin() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["quiz-admin-list"], queryFn: () => adminCall<{ quizzes: ListItem[] }>({ action: "list" }) });
  const [selId, setSelIdRaw] = useState<number | null>(null);
  // 마지막으로 다룬 회차를 기억해 두고 다음에 관리 탭을 열면 그 회차부터 보여줌
  const setSelId = (id: number | null) => {
    setSelIdRaw(id);
    writeStorage(LAST_ADMIN_KEY, id == null ? null : String(id));
  };
  const [createKind, setCreateKind] = useState<"exam" | "ox" | null>(null);
  const all = list.data?.quizzes ?? [];
  // 보상 지급까지 끝난 회차는 관리 탭에서 아예 빠짐(결과는 지난 기록에서 봄)
  const isDone = (i: ListItem) => !!i.rewardedAt;
  const items = all.filter((i) => !isDone(i) || i.id === selId);

  // 처음 들어왔을 때만 진행 중인 회차를 골라둠(새로 만든 회차는 목록이 새로 오기 전에도 그대로 선택돼 있게)
  useEffect(() => {
    if (selId == null && list.isSuccess) {
      const last = Number(readStorage(LAST_ADMIN_KEY));
      const first = all.find((i) => i.id === last && !isDone(i)) ?? all.find((i) => !isDone(i));
      if (first) setSelIdRaw(first.id);
    }
  }, [all, selId, list.isSuccess]);

  const detail = useQuery({
    queryKey: ["quiz-admin", selId],
    enabled: selId != null,
    // 바뀌면 quiz_pings 실시간 신호로 바로 받음(아래 useQuizAdminLive). 주기적으로 받는 건 신호를 놓쳤을 때 대비용
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      return d.quiz.status === "open" || d.quiz.status === "closed" ? 15_000 : false;
    },
    queryFn: () => adminCall<Detail>({ action: "get", quizId: selId }),
  });
  useQuizAdminLive(selId);
  const d = detail.data;
  const options = items.map((i) => ({
    value: String(i.id),
    label: `${i.kind === "exam" ? "모의고사" : "OX"} · ${i.title} · ${STATUS_LABEL[i.kind][i.status]}${i.isTest ? " · 테스트" : ""}`,
  }));

  return (
    <>
      <Card className={styles.admin} title="회차">
        <div className={styles.adminTop}>
          {options.length > 0 ? (
            <Select label="회차 고르기" className={styles.grow} value={String(selId ?? options[0].value)} options={options} onChange={(v) => setSelId(Number(v))} />
          ) : (
            <span className={`muted ${styles.flex1}`}>
              진행 중이거나 준비 중인 회차가 없어요. 새로 만들어 주세요.
            </span>
          )}
          
          <button type="button" className="btn btn-sm" onClick={() => setCreateKind("exam")}>
            <Plus size={16} aria-hidden="true" /> 새 모의고사
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setCreateKind("ox")}>
            <Plus size={16} aria-hidden="true" /> 새 OX 퀴즈
          </button>
        </div>
      </Card>

      {createKind && (
        <QuizSettingsModal
          kind={createKind}
          onClose={() => setCreateKind(null)}
          onSaved={(id) => {
            setCreateKind(null);
            if (id) setSelId(id);
          }}
        />
      )}

      {selId != null && detail.isLoading && <span className={`skeleton ${styles.h320}`} />}
      {d && d.quiz.id === selId && (
        <QuizDetail
          key={d.quiz.id}
          d={d}
          onFinished={() => {
            // 지운 회차는 바로 화면에서 빼기(목록 새로 받기 전에 다시 골라지지 않게)
            qc.setQueryData<{ quizzes: ListItem[] }>(["quiz-admin-list"], (old) => (old ? { quizzes: old.quizzes.filter((x) => x.id !== d.quiz.id) } : old));
            qc.removeQueries({ queryKey: ["quiz-admin", d.quiz.id] });
            setSelId(null);
          }}
        />
      )}
    </>
  );
}

function Steps({ quiz }: { quiz: QuizRow }) {
  const steps = quiz.kind === "exam" ? ["문제 준비", "제출 받기", "채점", "결과 발표", "보상 지급"] : ["문제 준비", "진행", "종료", "보상 지급"];
  const idx =
    quiz.kind === "exam"
      ? quiz.rewarded_at
        ? 5
        : { draft: 0, open: 1, closed: 2, revealed: 4 }[quiz.status]
      : quiz.rewarded_at
        ? 4
        : { draft: 0, open: 1, closed: 1, revealed: 3 }[quiz.status];
  return (
    <ol className={styles.steps} aria-label="진행 단계">
      {steps.map((s, i) => (
        <li key={s} className={i === idx ? styles.stepNow : i < idx ? styles.stepDone : ""} aria-current={i === idx ? "step" : undefined}>
          {i < idx ? "✓ " : `${i + 1}. `}
          {s}
        </li>
      ))}
    </ol>
  );
}

function QuizDetail({ d, onFinished }: { d: Detail; onFinished: () => void }) {
  const { act, busy } = useAct();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const quiz = d.quiz;

  async function remove() {
    if (!(await confirmDialog(`"${quiz.title}" 회차를 삭제할까요? 답안·응답도 같이 지워져요.`, { danger: true }))) return;
    if (await act({ action: "delete", quizId: quiz.id }, "삭제했어요.")) onFinished();
  }

  return (
    <>
      <Card
        className={styles.admin}
        title={quiz.title}
        extra={
          <div className={`${styles.actions} ${styles.mlAuto}`}>
            {quiz.is_test && <span className={`tag ${styles.testTag}`}>테스트 회차</span>}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} aria-hidden="true" /> 설정
            </button>
            {(quiz.status === "draft" || quiz.is_test) && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={remove}>
                <Trash2 size={16} aria-hidden="true" /> 삭제
              </button>
            )}
          </div>
        }
      >
        <Steps quiz={quiz} />
      </Card>
      {settingsOpen && <QuizSettingsModal kind={quiz.kind} quiz={quiz} onClose={() => setSettingsOpen(false)} onSaved={() => setSettingsOpen(false)} />}
      {quiz.status === "revealed" && <Payouts d={d} onPaid={onFinished} />}
      {quiz.kind === "exam" ? <ExamAdmin d={d} /> : <OxAdmin d={d} />}
    </>
  );
}

// ── 회차 만들기 / 설정 ──
function QuizSettingsModal({ kind, quiz, onClose, onSaved }: { kind: "exam" | "ox"; quiz?: QuizRow; onClose: () => void; onSaved: (id?: number) => void }) {
  const { act, busy } = useAct();
  const [title, setTitle] = useState(quiz?.title ?? (kind === "exam" ? "2026년도 제3회 유진능력고사" : "OX 퀴즈"));
  const [subtitle, setSubtitle] = useState(quiz?.subtitle ?? "유진 영역");
  const [oxMode, setOxMode] = useState<"score" | "deathmatch">(quiz?.ox_mode ?? "deathmatch");
  const [ranks, setRanks] = useState((quiz?.reward_ranks ?? [5000, 3000, 1000]).join(", "));
  const [survivor, setSurvivor] = useState(String(quiz?.reward_survivor ?? 1000));
  const paid = !!quiz?.rewarded_at;

  async function save() {
    const rewardRanks = ranks
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((s) => Number(s.replace(/[^0-9]/g, "")));
    const body: Record<string, unknown> = { title, rewardRanks, rewardSurvivor: Number(survivor) || 0 };
    if (kind === "exam") body.subtitle = subtitle;
    else body.oxMode = oxMode;
    if (quiz) {
      if (await act({ action: "update", quizId: quiz.id, ...body }, "저장했어요.")) onSaved();
    } else {
      const r = await act<{ id: number }>({ action: "create", kind, isTest: false, ...body }, "회차를 만들었어요.");
      if (r) onSaved(r.id);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={quiz ? "회차 설정" : kind === "exam" ? "새 모의고사" : "새 OX 퀴즈"}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {quiz ? "저장" : "만들기"}
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <label className="field">
          <span className="field-label">제목</span>
          <input className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {kind === "exam" ? (
          <label className="field">
            <span className="field-label">시험지 큰 제목 — 예: 유진 영역, 게임 영역(비워두면 안 보임)</span>
            <input className="input" maxLength={30} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </label>
        ) : (
          <div className="field">
            <span className="field-label">방식</span>
            <div className="segment" role="tablist">
              <button type="button" role="tab" aria-selected={oxMode === "deathmatch"} onClick={() => setOxMode("deathmatch")}>
                데스매치(틀리면 탈락)
              </button>
              <button type="button" role="tab" aria-selected={oxMode === "score"} onClick={() => setOxMode("score")}>
                점수전(맞힌 개수)
              </button>
            </div>
          </div>
        )}
        {kind === "ox" && oxMode === "deathmatch" ? (
          <label className="field">
            <span className="field-label">최후 생존자 1명당 보상(P)</span>
            <input className="input num" inputMode="numeric" disabled={paid} value={survivor} onChange={(e) => setSurvivor(e.target.value.replace(/[^0-9]/g, ""))} />
          </label>
        ) : (
          <label className="field">
            <span className="field-label">순위 보상(P) — 1등부터 쉼표로</span>
            <input className="input num" disabled={paid} value={ranks} onChange={(e) => setRanks(e.target.value)} placeholder="5000, 3000, 1000" />
          </label>
        )}
      </div>
    </Modal>
  );
}

// ── 보상 지급 ──
function Payouts({ d, onPaid }: { d: Detail; onPaid: () => void }) {
  const { act, busy } = useAct();
  const quiz = d.quiz;
  const total = useMemo(() => d.payouts.reduce((n, p) => n + p.amount, 0), [d.payouts]);
  const paid = !!quiz.rewarded_at;

  async function pay() {
    const none = d.payouts.length === 0;
    const msg = none
      ? "보상 받을 사람이 없어요. 이대로 회차를 마칠까요? 관리 탭에서 사라지고 결과는 지난 기록에 남아요."
      : quiz.is_test
        ? `테스트 회차라 포인트는 안 들어가요. ${d.payouts.length}명 · 총 ${fmt(total)}P로 지급 기록만 남기고 마칠까요?`
        : `${d.payouts.length}명에게 총 ${fmt(total)}P를 지급하고 마칠까요? 되돌릴 수 없어요.`;
    if (!(await confirmDialog(msg, { okText: none ? "마치기" : "지급" }))) return;
    const r = await act({ action: "pay", quizId: quiz.id }, none ? "회차를 마쳤어요." : quiz.is_test ? "지급 기록을 남기고 마쳤어요(테스트)." : "보상을 지급하고 마쳤어요.");
    if (r) onPaid(); // 다 끝난 회차는 관리 탭에서 빼고 처음 화면으로
  }

  return (
    <Card className={styles.admin} title={paid ? "지급 내역" : "보상 지급 미리보기"} extra={quiz.is_test && <span className={`tag ${styles.testTag} ${styles.mlAuto}`}>테스트 · 실제 지급 안 됨</span>}>
      {d.payouts.length === 0 ? (
        <EmptyState>보상 받을 사람이 없어요.</EmptyState>
      ) : (
        <div className={styles.payList}>
          {d.payouts.map((p, i) => (
            <div key={i} className={styles.row}>
              <span>
                {p.label} · {p.channelName}
              </span>
              <b className={`num ${styles.cGold}`}>
                {fmt(p.amount)}P
              </b>
            </div>
          ))}
          <div className={`${styles.row} ${styles.payTotal}`}>
            <span>합계</span>
            <b className="num">{fmt(total)}P</b>
          </div>
        </div>
      )}
      {!paid && (
        <div className={`${styles.actions} ${styles.mt14}`}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={pay}>
            {d.payouts.length === 0 ? "보상 없이 마치기" : quiz.is_test ? "지급 기록만 남기고 마치기(테스트)" : "보상 지급하고 마치기"}
          </button>
        </div>
      )}
    </Card>
  );
}
