// 페이지가 사라지기 직전(새로 고침·탭 닫기·다른 앱으로 전환)을 알려 주는 구독(순수). 대기 중인
// 쓰기를 그 자리에서 마치는 데 쓴다. `beforeunload` 와 달리 bfcache 를 막지 않는다.

type EventTargetLike = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/**
 * `pagehide` 와 `visibilitychange`(숨겨질 때만)에 `onHide` 를 건다. 돌려준 함수가 둘 다 푼다.
 * 모바일 브라우저는 탭을 닫을 때 `pagehide` 없이 숨김만 알리기도 해서 둘 다 듣는다.
 */
export function subscribeHide(
  win: EventTargetLike,
  doc: EventTargetLike & { visibilityState: string },
  onHide: () => void,
): () => void {
  const onPageHide = () => onHide();
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") onHide();
  };
  win.addEventListener("pagehide", onPageHide);
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    win.removeEventListener("pagehide", onPageHide);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
