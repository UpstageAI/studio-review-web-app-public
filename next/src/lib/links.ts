// 앱 안 링크 클릭의 공용 판정.

import type { MouseEvent } from "react";

/** 새 탭·새 창으로 여는 클릭(⌘/Ctrl, Shift, Alt, 가운데 단추). 이 탭은 이동하지 않는다. */
export function isNewTabClick(
  event: Pick<
    MouseEvent,
    "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
