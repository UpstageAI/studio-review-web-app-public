/**
 * 연속 스크롤 뷰어의 스크롤 상태를 실제 위치에 맞추는 helper.
 *
 * Studio UI Kit 연속 스크롤 뷰어는 스크롤 위치를 `scroll` 이벤트가 올 때만 상태로 갱신하고, 밖에서
 * 페이지를 바꾸면 `scrollTo` 로 옮긴다. 그래서 프로그램 이동 직후 scroll 이벤트가 처리되기 전에 다음
 * 이동(예: ▶ 직후 ◀, PageDown 직후 PageUp)이 오면 옛 위치를 기준으로 "이미 그 페이지" 라고 보고 요청을
 * 버리고, 늦게 온 scroll 이벤트가 앞 이동의 페이지를 다시 고른다. 뷰어 item 은 CLI 관리라 고치지 않고,
 * 래퍼가 이동 직후 스크롤 요소에 `scroll` 이벤트를 한 번 보내 상태를 지금 위치로 맞춘다.
 *
 * 뷰어 item 의 스크롤 요소 testid(`${testId}-scroll`)와 그 요소의 `onScroll` 에 기댄다. 요소가 없으면
 * (한 장씩 모드·아직 그리기 전) 아무것도 하지 않는다.
 */

/** `DocumentViewer` 가 뷰어 item 에 넘기는 testid. 스모크·측정 하네스도 같은 문자열을 쓴다. */
export const VIEWER_TESTID = "job-review-viewer";

/** 뷰어 item 이 연속 스크롤 요소에 붙이는 testid 선택자. */
export function viewerScrollSelector(testId: string): string {
  return `[data-testid="${testId}-scroll"]`;
}

/** `resyncViewerScroll` 이 쓰는 최소 DOM 모양(테스트에서 가짜 root 를 넘길 수 있게). */
export interface ScrollSyncRoot {
  querySelector(selectors: string): {
    dispatchEvent(event: Event): boolean;
  } | null;
}

/**
 * `root` 안의 연속 스크롤 요소에 `scroll` 이벤트(bubble 없음)를 한 번 보낸다. 보냈으면 `true`,
 * root 나 요소가 없으면 `false`.
 */
export function resyncViewerScroll(
  root: ScrollSyncRoot | null,
  testId: string,
): boolean {
  const scroller = root?.querySelector(viewerScrollSelector(testId));
  if (!scroller) return false;
  scroller.dispatchEvent(new Event("scroll"));
  return true;
}
