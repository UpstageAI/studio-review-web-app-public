// 앱 안 이동 전에 "떠날까요?" 를 묻는 작은 모듈 저장소. 요청은 한 번에 하나이고, 앱 Dialog(host)가
// 구독해 그린다. host 가 마운트되지 않은 화면에서는 브라우저 기본 확인 창으로 답한다.

/** 확인 창의 제목·확인 버튼 문구를 바꿀 때. 비우면 host 의 기본 문구("떠날까요?" · "나가기"). */
export interface LeaveConfirmOptions {
  title?: string;
  confirmLabel?: string;
}

/** 지금 열려 있는 확인 요청. `id` 는 요청마다 새로 붙는다. */
export interface LeaveConfirmRequest extends LeaveConfirmOptions {
  id: number;
  message: string;
}

let current: (LeaveConfirmRequest & { resolve(ok: boolean): void }) | null =
  null;
let snapshot: LeaveConfirmRequest | null = null;
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function replace(
  next: (LeaveConfirmRequest & { resolve(ok: boolean): void }) | null,
): void {
  current = next;
  snapshot = next && {
    id: next.id,
    message: next.message,
    title: next.title,
    confirmLabel: next.confirmLabel,
  };
}

/**
 * 확인 창을 띄우고 답을 기다린다. 떠나도 되면 `true`. 이미 열린 요청이 있으면 그 요청은 `false`(머무르기)
 * 로 닫고 새 요청으로 바꾼다.
 */
export function requestLeaveConfirm(
  message: string,
  options: LeaveConfirmOptions = {},
): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(window.confirm(message));
  const previous = current;
  return new Promise<boolean>(resolve => {
    replace({ id: nextId++, message, ...options, resolve });
    previous?.resolve(false);
    emit();
  });
}

/** 변경이 있으면 떠날지 묻는다. 떠나도 되면 `true`. 변경이 없으면 묻지 않는다. */
export function confirmLeave(
  dirty: boolean,
  message: string,
): Promise<boolean> {
  return dirty ? requestLeaveConfirm(message) : Promise.resolve(true);
}

export function subscribeLeaveConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLeaveConfirmRequest(): LeaveConfirmRequest | null {
  return snapshot;
}

/** 요청에 답한다. 이미 답했거나 다른 요청으로 바뀐 `id` 면 아무것도 하지 않는다. */
export function settleLeaveConfirm(id: number, ok: boolean): void {
  if (current?.id !== id) return;
  const { resolve } = current;
  replace(null);
  resolve(ok);
  emit();
}

/**
 * 확인 창을 그리는 host 를 등록한다. 돌려준 함수로 해제하며, 마지막 host 가 사라질 때 남은 요청은
 * `false` 로 닫는다.
 */
export function registerLeaveConfirmHost(): () => void {
  hosts++;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    hosts--;
    if (hosts === 0 && current) settleLeaveConfirm(current.id, false);
  };
}
