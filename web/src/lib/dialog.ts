// 브라우저 기본 alert/confirm 대신 쓰는 사이트 디자인 알림창·확인창·토스트.
// 어디서든 함수로 부르면 되고(await), 화면은 main.tsx의 <DialogHost />가 그림.
//   await alertDialog("삭제에 실패했어요.");
//   if (!(await confirmDialog("이 글을 삭제할까요?", { danger: true, okText: "삭제" }))) return;
//   toast("저장했어요.");
import { useSyncExternalStore } from "react";

export type DialogReq = {
  id: number;
  kind: "alert" | "confirm" | "copy";
  title?: string;
  message: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  copyText?: string;
  resolve: (ok: boolean) => void;
};
export type Toast = { id: number; message: string; tone: "ok" | "error" | "info" };

let seq = 0;
let dialogs: DialogReq[] = [];
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function push(req: Omit<DialogReq, "id" | "resolve">) {
  return new Promise<boolean>((resolve) => {
    dialogs = [...dialogs, { ...req, id: ++seq, resolve }];
    emit();
  });
}

export function closeDialog(id: number, ok: boolean) {
  const d = dialogs.find((x) => x.id === id);
  if (!d) return;
  dialogs = dialogs.filter((x) => x.id !== id);
  emit();
  d.resolve(ok);
}

export async function alertDialog(message: string, opts: { title?: string; okText?: string } = {}) {
  await push({ kind: "alert", message, ...opts });
}

export function confirmDialog(message: string, opts: { title?: string; okText?: string; cancelText?: string; danger?: boolean } = {}) {
  // 확인 버튼 글자를 따로 안 줬으면 내용에 맞춰(삭제/회수/종료…) — "확인"보다 무슨 일이 일어나는지 분명하게
  let okText = opts.okText;
  let cancelText = opts.cancelText;
  if (!okText && opts.danger) {
    if (/취소할까요|해제할까요/.test(message)) {
      // "…을 취소할까요?"에 [취소][확인]이면 헷갈려서 [아니요][네]로
      okText = "네";
      cancelText = cancelText ?? "아니요";
    } else {
      okText = ["삭제", "회수", "종료", "밴"].find((v) => message.includes(v)) ?? "확인";
    }
  }
  return push({ kind: "confirm", message, ...opts, okText, cancelText });
}

// 클립보드 복사가 막혔을 때 — 주소를 보여주고 직접 복사하게(기존 prompt 대신)
export async function copyDialog(message: string, copyText: string) {
  await push({ kind: "copy", message, copyText });
}

export function toast(message: string, tone: Toast["tone"] = "ok") {
  const id = ++seq;
  toasts = [...toasts, { id, message, tone }].slice(-3);
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, tone === "error" ? 4200 : 2800);
}

export function useDialogState() {
  const d = useSyncExternalStore(subscribe, () => dialogs);
  const t = useSyncExternalStore(subscribe, () => toasts);
  return { dialogs: d, toasts: t };
}
