export function panWithinPageOffset(params: {
  /** 이미지 좌상단의 현재 화면 좌표 */
  left: number;
  top: number;
  /** 현재 배율이 적용된 이미지 크기 */
  shownWidth: number;
  shownHeight: number;
  canvas: { width: number; height: number };
  /** 휠 delta (아래로 스크롤이 양수) */
  deltaX: number;
  deltaY: number;
}): { x: number; y: number } | null {
  const { left, top, shownWidth, shownHeight, canvas, deltaX, deltaY } = params;
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  if (shownWidth <= 0 || shownHeight <= 0) return null;

  // 넘치지 않는 축은 가운데 정렬을 유지한다 (min===max===현재 위치).
  const overflowsX = shownWidth > canvas.width + 1;
  const overflowsY = shownHeight > canvas.height + 1;

  const nextLeft = overflowsX
    ? Math.min(0, Math.max(canvas.width - shownWidth, left - deltaX))
    : left;
  const nextTop = overflowsY
    ? Math.min(0, Math.max(canvas.height - shownHeight, top - deltaY))
    : top;

  const x = nextLeft - left;
  const y = nextTop - top;
  // 경계에 닿아 더 못 움직이면 페이지 전환에 양보한다.
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return null;

  return { x, y };
}
