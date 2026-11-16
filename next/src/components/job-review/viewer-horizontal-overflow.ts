/**
 * 연속 스크롤 뷰어에서 세로 스크롤바 폭만큼 생기는 가로 스크롤을 숨기는 helper.
 *
 * Studio UI Kit 연속 스크롤 뷰어는 "페이지 폭 맞춤" 배율을 스크롤 요소의 바깥 폭(세로 스크롤바 포함)으로
 * 계산한다. 스크롤바가 자리를 차지하는 환경(Windows, macOS "항상 보기")에서는 페이지가 스크롤바 폭만큼
 * 넘쳐 쓸모없는 가로 스크롤이 생긴다. 뷰어 item 은 CLI 관리라 고치지 않고, 래퍼가 넘침이 스크롤바 폭
 * 이하일 때만 그 요소의 `overflow-x` 를 `hidden` 으로 둔다. 확대해 페이지가 실제로 더 넓어지면 다시
 * 풀어 가로로 옮겨 볼 수 있게 한다.
 */

/** 판단에 쓰는 스크롤 요소 크기(px). */
export interface ScrollBox {
  scrollWidth: number;
  clientWidth: number;
  offsetWidth: number;
}

/** 서브픽셀 반올림으로 생기는 1 px 차이는 넘침으로 보지 않는다. */
const ROUNDING_SLACK = 1;

/**
 * 가로 넘침이 세로 스크롤바 폭(바깥 폭 − 안쪽 폭) 이하이면 `true` — 숨겨도 볼 내용을 잃지 않는다.
 * 넘침이 없을 때도 `true` 다(숨겨도 차이가 없다).
 */
export function isGutterOnlyOverflow(box: ScrollBox): boolean {
  const overflow = box.scrollWidth - box.clientWidth;
  const gutter = Math.max(0, box.offsetWidth - box.clientWidth);
  return overflow <= gutter + ROUNDING_SLACK;
}

/** `el` 의 가로 스크롤을 넘침에 맞춰 숨기거나 되돌린다. 바꿨으면 `true`. */
export function syncHorizontalOverflow(
  el: ScrollBox & { style: { overflowX: string } },
): boolean {
  const next = isGutterOnlyOverflow(el) ? "hidden" : "";
  if (el.style.overflowX === next) return false;
  el.style.overflowX = next;
  return true;
}
