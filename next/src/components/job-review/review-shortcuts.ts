/**
 * 검수 화면 전역 단축키. ⌘/Ctrl+S 는 저장, ⌘/Ctrl+Enter 는 머리의 주 동작(검수 완료 또는 저장하고
 * 완료)이다. 입력 요소가 이미 처리한 키(예: 여러 줄 값 입력의 ⌘/Ctrl+Enter 확정)와 한글 조합 중인
 * 키는 건드리지 않는다. 대화상자 안이나 입력칸(검색칸 포함) 안에서는 주 동작을 부르지 않는다.
 * 입력칸 안의 ⌘/Ctrl+S 는 부르는 쪽이 입력을 먼저 확정(blur)한 뒤 저장한다.
 */

export type ReviewShortcut = "save" | "complete";

/** 버튼의 `aria-keyshortcuts` 값. */
export const SAVE_KEYSHORTCUTS = "Meta+S Control+S";
export const COMPLETE_KEYSHORTCUTS = "Meta+Enter Control+Enter";

export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  defaultPrevented: boolean;
}

export function reviewShortcutOf(
  event: ShortcutKeyEvent,
  { inDialog, inEditable = false }: { inDialog: boolean; inEditable?: boolean },
): ReviewShortcut | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return null;
  }
  if (event.key === "s" || event.key === "S") return "save";
  if (event.key === "Enter" && !inDialog && !inEditable) return "complete";
  return null;
}

/** 이벤트 대상이 열린 대화상자(시트, 확인 창) 안인지. */
export function isInDialog(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="dialog"], [role="alertdialog"]') !== null
  );
}
