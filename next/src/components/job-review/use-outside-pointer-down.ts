import { useEffect, useEffectEvent } from "react";

/**
 * 고정 하이라이트를 풀지 않는 영역. 뷰어(`data-highlight-keep`)와 열린 오버레이(다이얼로그·시트·
 * 메뉴·선택 목록·툴팁) 안을 누르는 것은 "바깥" 으로 치지 않는다. 오버레이는 portal 로 body 에
 * 붙어 패널 DOM 밖에 있으므로 따로 적는다.
 */
export const HIGHLIGHT_KEEP_SELECTOR = [
  "[data-highlight-keep]",
  '[data-slot="dialog-content"]',
  '[data-slot="dialog-overlay"]',
  '[data-slot="sheet-content"]',
  '[data-slot="sheet-overlay"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="select-content"]',
  '[data-slot="tooltip-content"]',
].join(", ");

/** 스크롤바를 누른 것인지. 스크롤 영역의 내용 상자(client 영역) 밖을 누르면 스크롤바다. */
function onScrollbar(target: Element, event: PointerEvent): boolean {
  const scrollable =
    target.scrollHeight > target.clientHeight ||
    target.scrollWidth > target.clientWidth;
  return (
    scrollable &&
    (event.offsetX >= target.clientWidth ||
      event.offsetY >= target.clientHeight)
  );
}

/**
 * `enabled` 인 동안 문서 어디든 주 버튼으로 누를 때(`pointerdown`, capture) `isInside` 가 아니면
 * `onOutside` 를 부른다. 스크롤바를 누르는 것은 무시한다. 리스너는 `enabled` 일 때만 붙는다.
 */
export function useOutsidePointerDown(
  enabled: boolean,
  isInside: (target: Element) => boolean,
  onOutside: () => void,
): void {
  const inside = useEffectEvent(isInside);
  const outside = useEffectEvent(onOutside);
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const { target } = event;
      if (!(target instanceof Element)) return;
      if (onScrollbar(target, event) || inside(target)) return;
      outside();
    };
    document.addEventListener("pointerdown", handler, { capture: true });
    return () =>
      document.removeEventListener("pointerdown", handler, { capture: true });
  }, [enabled]);
}
