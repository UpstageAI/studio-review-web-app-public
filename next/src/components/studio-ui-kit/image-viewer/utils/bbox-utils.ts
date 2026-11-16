type Coordinate = { x: number; y: number };

type FocusCoordinateSource = {
  word_coordinates?: Coordinate[][] | null;
  coordinates?: Coordinate[] | null;
};

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * Coordinates 배열로부터 bounding rectangle을 계산
 */
export function getBoundingBox(
  coordinates: Coordinate[],
  imageSize: { width: number; height: number },
  isRatioCoordinates: boolean,
): BoundingBox | null {
  if (!coordinates || coordinates.length === 0) {
    return null;
  }

  // Ratio coordinates를 pixel coordinates로 변환
  const pixelCoords = isRatioCoordinates
    ? coordinates.map(coord => ({
        x: coord.x * imageSize.width,
        y: coord.y * imageSize.height,
      }))
    : coordinates;

  const minX = Math.min(...pixelCoords.map(c => c.x));
  const minY = Math.min(...pixelCoords.map(c => c.y));
  const maxX = Math.max(...pixelCoords.map(c => c.x));
  const maxY = Math.max(...pixelCoords.map(c => c.y));

  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX,
    centerY,
  };
}

/**
 * Coordinates가 ratio (0-1.25) 기반인지 확인
 */
export function areRatioCoordinates(coordinates: Coordinate[]): boolean {
  if (!coordinates || coordinates.length === 0) return false;
  return coordinates.every(
    coord => coord.x >= 0 && coord.x <= 1.25 && coord.y >= 0 && coord.y <= 1.25,
  );
}

/**
 * 포커스 대상 좌표를 고른다 — word_coordinates(주황색)가 있으면 그 영역을,
 * 없으면 main coordinates(파란색)로 폴백한다.
 */
export function resolveFocusCoordinates(highlight: {
  word_coordinates?: Coordinate[][] | null;
  coordinates?: Coordinate[] | null;
}): Coordinate[] | null {
  const wc = highlight.word_coordinates;
  if (wc && wc.length > 0) {
    const flat = wc.flat();
    if (flat.length >= 3) return flat;
  }
  if (highlight.coordinates && highlight.coordinates.length >= 3) {
    return highlight.coordinates;
  }
  return null;
}

/**
 * 포커스 좌표와 단위를 함께 고른다. main polygon이 있으면 word 좌표도 같은
 * 좌표계를 상속하고, main이 비어 있으면 실제 포커스 좌표에서 단위를 추론한다.
 */
export function resolveFocusTarget(
  highlight: FocusCoordinateSource,
): { coordinates: Coordinate[]; isRatioCoordinates: boolean } | null {
  const coordinates = resolveFocusCoordinates(highlight);
  if (!coordinates) return null;
  const unitCoordinates = highlight.coordinates?.length
    ? highlight.coordinates
    : coordinates;

  return {
    coordinates,
    isRatioCoordinates: areRatioCoordinates(unitCoordinates),
  };
}

/** 인용 bbox 를 어느 축에 맞출지 — 폭 채우기 / 높이 채우기 */
export type BboxFitAxis = "width" | "height";

/**
 * Bbox 가 캔버스의 한 축을 채우도록 줌 레벨을 계산한다.
 *
 * `calculateZoomForBbox` 는 bbox 전체가 화면 안에 들어오도록 두 축 중 작은
 * 배율을 고르지만, 여기서는 사용자가 고른 축만 기준으로 삼는다 — 인용 문장을
 * 폭에 꽉 채워 읽고 싶을 때 반대 축이 배율을 깎으면 안 된다.
 *
 * @param bbox - Bounding box (pixel coordinates)
 * @param canvasSize - 캔버스(뷰포트) 크기
 * @param axis - 채울 축
 * @param targetRatio - 축을 채우는 비율 (0-1, 기본 0.94 — 가장자리 여백)
 * @param minZoom - 최소 줌 레벨
 * @param maxZoom - 최대 줌 레벨
 */
export function calculateZoomForBboxAxis(
  bbox: BoundingBox,
  canvasSize: { width: number; height: number },
  axis: BboxFitAxis,
  targetRatio: number = 0.94,
  minZoom: number = 0.1,
  maxZoom: number = 5,
): number {
  if (
    !bbox ||
    bbox.width <= 0 ||
    bbox.height <= 0 ||
    canvasSize.width <= 0 ||
    canvasSize.height <= 0
  ) {
    return 1;
  }

  const zoom =
    axis === "width"
      ? (canvasSize.width * targetRatio) / bbox.width
      : (canvasSize.height * targetRatio) / bbox.height;

  return Math.max(minZoom, Math.min(maxZoom, zoom));
}

/**
 * Bbox가 화면의 목표 비율(기본 70%)을 차지하도록 줌 레벨을 계산
 * @param bbox - Bounding box (pixel coordinates)
 * @param imageSize - 원본 이미지 크기
 * @param canvasSize - 캔버스(뷰포트) 크기
 * @param targetRatio - 목표 화면 비율 (0-1, 기본 0.7)
 * @param minZoom - 최소 줌 레벨
 * @param maxZoom - 최대 줌 레벨
 */
export function calculateZoomForBbox(
  bbox: BoundingBox,
  imageSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
  targetRatio: number = 0.7,
  minZoom: number = 0.1,
  maxZoom: number = 5,
): number {
  if (
    !bbox ||
    bbox.width <= 0 ||
    bbox.height <= 0 ||
    canvasSize.width <= 0 ||
    canvasSize.height <= 0 ||
    imageSize.width <= 0 ||
    imageSize.height <= 0
  ) {
    return 1;
  }

  // 목표 크기 (캔버스의 targetRatio 비율)
  const targetWidth = canvasSize.width * targetRatio;
  const targetHeight = canvasSize.height * targetRatio;

  // Bbox가 목표 크기에 맞추기 위해 필요한 스케일 계산
  // bbox를 확대했을 때 목표 크기가 되려면 얼마나 확대해야 하는지
  const scaleX = targetWidth / bbox.width;
  const scaleY = targetHeight / bbox.height;

  // 작은 쪽을 선택 (bbox가 목표 영역 안에 완전히 들어가도록)
  let finalZoom = Math.min(scaleX, scaleY);

  // 최소/최대 줌 제한 적용
  finalZoom = Math.max(minZoom, Math.min(maxZoom, finalZoom));

  return finalZoom;
}

/**
 * Bbox를 화면 중앙에 배치하기 위한 pan offset을 계산
 * @param bbox - Bounding box (pixel coordinates)
 * @param canvasSize - 캔버스(뷰포트) 크기
 * @param currentScale - 현재 적용된 스케일
 */
export function calculatePanOffsetForBbox(
  bbox: BoundingBox,
  canvasSize: { width: number; height: number },
  currentScale: number,
): { x: number; y: number } {
  if (!bbox || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return { x: 0, y: 0 };
  }

  // Bbox의 중심을 화면 중심에 맞추기 위한 offset 계산
  // 스케일이 적용된 bbox 중심 좌표
  const scaledBboxCenterX = bbox.centerX * currentScale;
  const scaledBboxCenterY = bbox.centerY * currentScale;

  // 화면 중심 좌표
  const canvasCenterX = canvasSize.width / 2;
  const canvasCenterY = canvasSize.height / 2;

  // Pan offset = 화면 중심 - bbox 중심
  const offsetX = canvasCenterX - scaledBboxCenterX;
  const offsetY = canvasCenterY - scaledBboxCenterY;

  return { x: offsetX, y: offsetY };
}
