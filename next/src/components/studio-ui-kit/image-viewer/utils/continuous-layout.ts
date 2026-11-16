export const PAGE_GAP = 12;

export interface ContinuousLayout {
  /** 각 페이지의 위쪽 위치(px) */
  offsets: number[];
  /** 각 페이지의 높이(px) */
  heights: number[];
  /** 스택 전체 높이(px) */
  totalHeight: number;
}

/**
 * 표시 폭(`pageWidth`)에 맞춰 각 페이지의 높이와 위치를 계산한다.
 *
 * 아직 안 그려진 페이지는 크기를 모르므로 `defaultAspect`(먼저 그려진 페이지의
 * 비율)로 자리를 잡아 둔다. 실제로 그려지면 그 페이지만 제 비율로 바뀐다.
 */
export function computeContinuousLayout(params: {
  count: number;
  pageWidth: number;
  /** 페이지별 세로/가로 비율. 모르면 null */
  aspects: (number | null)[];
  defaultAspect: number;
  gap?: number;
}): ContinuousLayout {
  const { count, pageWidth, aspects, defaultAspect, gap = PAGE_GAP } = params;
  const offsets: number[] = [];
  const heights: number[] = [];
  let top = 0;

  for (let i = 0; i < count; i += 1) {
    const aspect = aspects[i] ?? defaultAspect;
    const height = Math.max(1, pageWidth * aspect);
    offsets.push(top);
    heights.push(height);
    top += height + gap;
  }

  return {
    offsets,
    heights,
    // 마지막 페이지 뒤의 여백은 빼서 바닥에 빈 칸이 남지 않게 한다.
    totalHeight: Math.max(0, top - (count > 0 ? gap : 0)),
  };
}

/**
 * 화면을 가장 많이 차지한 페이지 — 툴바의 현재 페이지 표시에 쓴다.
 *
 * "화면 위쪽에 걸친 페이지"로 정하면 스크롤을 조금만 내려도 번호가 먼저 바뀌어
 * 아직 읽고 있는 페이지와 어긋난다.
 */
export function pageAtViewport(
  layout: ContinuousLayout,
  viewportTop: number,
  viewportHeight: number,
): number {
  const { offsets, heights } = layout;
  if (offsets.length === 0) return 0;
  if (viewportHeight <= 0) return 0;

  const viewportBottom = viewportTop + viewportHeight;
  let best = 0;
  let bestVisible = -1;

  for (let i = 0; i < offsets.length; i += 1) {
    const top = offsets[i];
    const bottom = top + heights[i];
    if (bottom <= viewportTop) continue;
    if (top >= viewportBottom) break;

    const visible =
      Math.min(bottom, viewportBottom) - Math.max(top, viewportTop);
    if (visible > bestVisible) {
      bestVisible = visible;
      best = i;
    }
  }

  return best;
}

/**
 * 실제로 그릴 페이지 범위. 44쪽짜리 문서를 통째로 그리면 이미지 수십 장을 동시에
 * 들고 있게 되므로, 보이는 곳과 그 앞뒤(`overscan`)만 그린다.
 */
export function visiblePageRange(
  layout: ContinuousLayout,
  viewportTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } {
  const { offsets, heights } = layout;
  if (offsets.length === 0) return { start: 0, end: -1 };

  const from = viewportTop - overscan;
  const to = viewportTop + viewportHeight + overscan;

  let start = offsets.length - 1;
  let end = 0;
  let found = false;

  for (let i = 0; i < offsets.length; i += 1) {
    const top = offsets[i];
    const bottom = top + heights[i];
    if (bottom < from) continue;
    if (top > to) break;
    if (!found) {
      start = i;
      found = true;
    }
    end = i;
  }

  return found ? { start, end } : { start: 0, end: -1 };
}

export type ContinuousFitMode = "pageWidth" | "width" | "height";

/**
 * 보기 방식에 맞는 페이지 표시 폭(px).
 *
 * - `pageWidth`: 페이지 너비를 화면 폭에 맞춘다 (이어서 스크롤하는 뷰어의 기준—
 *   한 장을 다 보이게 줄이면 글자가 작아지고, 어차피 세로로는 이어서 읽는다)
 * - `width`/`height`: 인용 bbox 가 화면의 그 축을 채우게 (bbox 는 이미지 좌표)
 */
export function pageWidthForFit(params: {
  mode: ContinuousFitMode;
  container: { width: number; height: number };
  imageSize: { width: number; height: number };
  bbox?: { width: number; height: number } | null;
  targetRatio?: number;
  minScale?: number;
  maxScale?: number;
}): number {
  const {
    mode,
    container,
    imageSize,
    bbox,
    targetRatio = 0.94,
    minScale = 0.1,
    maxScale = 5,
  } = params;
  if (container.width <= 0 || container.height <= 0) return 0;
  if (imageSize.width <= 0 || imageSize.height <= 0) return 0;

  const clampWidth = (width: number) => {
    const scale = Math.min(
      Math.max(width / imageSize.width, minScale),
      maxScale,
    );
    return scale * imageSize.width;
  };

  if (mode === "pageWidth" || !bbox || bbox.width <= 0 || bbox.height <= 0) {
    return clampWidth(container.width);
  }

  if (mode === "width") {
    return clampWidth(
      (container.width * targetRatio * imageSize.width) / bbox.width,
    );
  }

  // height — bbox 높이가 화면 높이를 채우도록
  const scale = (container.height * targetRatio) / bbox.height;
  return clampWidth(scale * imageSize.width);
}

/**
 * 이미지 위의 한 점을 화면 가운데 두는 스크롤 위치.
 * 스크롤 범위를 벗어나면 브라우저가 잘라 주므로 여기서는 음수만 막는다.
 */
export function scrollToCenterPoint(params: {
  pageTop: number;
  /** 이미지 좌표 → 표시 좌표 배율 */
  scale: number;
  point: { x: number; y: number };
  container: { width: number; height: number };
  /** 스택이 컨테이너보다 좁을 때 가운데 정렬로 생기는 왼쪽 여백 */
  stackOffsetX?: number;
}): { top: number; left: number } {
  const { pageTop, scale, point, container, stackOffsetX = 0 } = params;
  return {
    top: Math.max(0, pageTop + point.y * scale - container.height / 2),
    left: Math.max(0, stackOffsetX + point.x * scale - container.width / 2),
  };
}

/** 사용자가 보고 있던 배율 — 어떤 조합에서, 뷰어 폭이 얼마일 때의 값인지 함께 둔다 */
export interface StoredZoom {
  /** 어떤 조합(보기 방식·인용)에서 정해진 값인지 */
  key: string;
  scale: number;
  /** 그때의 뷰어 폭(px) — 크기가 바뀌면 보이던 비율을 지키는 데 쓴다 */
  containerWidth: number;
}

/** 배율을 고를 때 쓰는 조합 키 — 인용 맞춤일 때만 인용을 구분한다 */
export function zoomKey(
  mode: ContinuousFitMode,
  citationId?: string | null,
): string {
  return mode === "pageWidth" ? mode : `${mode}|${citationId ?? ""}`;
}

/**
 * 화면에 쓸 배율을 고른다.
 *
 * - 뷰어 크기가 바뀌면 보이던 비율을 지킨다. 폭이 넓어졌는데 배율을 그대로 두면
 *   문서가 상대적으로 작아 보여 "유지"로 느껴지지 않는다 — 폭이 커진 만큼 배율도
 *   키워 화면에서 차지하는 비율을 같게 둔다.
 * - 인용 맞춤(폭·높이)에서 다른 인용으로 옮기면 그 인용에 맞춰 새로 잡는다.
 * - 줌 고정은 조합이 달라도 쓰던 배율을 이어 간다 — 인용 맞춤으로 확대해 두고 줌
 *   고정으로 바꾸면 그 배율을 물려받는다.
 * - 쓰던 값이 없으면(처음 열 때) 기본 배율로 시작한다.
 */
export function resolveScale(params: {
  citationFitActive: boolean;
  stored: StoredZoom | null;
  key: string;
  fitScale: number;
  containerWidth: number;
}): number {
  const { citationFitActive, stored, key, fitScale, containerWidth } = params;
  if (!stored || stored.scale <= 0 || stored.containerWidth <= 0) {
    return fitScale;
  }
  if (citationFitActive && stored.key !== key) return fitScale;
  if (containerWidth <= 0) return stored.scale;
  return stored.scale * (containerWidth / stored.containerWidth);
}
