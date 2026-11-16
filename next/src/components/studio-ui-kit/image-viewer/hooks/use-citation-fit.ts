import { useEffect, useRef } from "react";
import type { HighlightValueWithId } from "../../shared/types/highlight";
import {
  calculateZoomForBboxAxis,
  getBoundingBox,
  resolveFocusTarget,
  type BboxFitAxis,
} from "../utils/bbox-utils";
import { MAX_ZOOM_RATIO, MIN_ZOOM_RATIO } from "../constants/image-viewer";

interface Transform {
  scale: number;
  rotation: number;
  tx: number;
  ty: number;
  matrix: number[][];
}

/**
 * 선택된 인용을 고른 축에 맞춰 볼 때의 배율·중심점. 맞출 수 없으면 null.
 *
 * 배치를 정하는 곳이 여러 군데면 서로 덮어써서(페이지 이동·이미지 로드·모드
 * 변경) 어떤 경로에서는 배율이 풀린다. 그래서 계산은 여기 한 곳에 두고,
 * 적용 시점은 호출부가 한 줄기로 정한다.
 */
export function computeCitationFocus(params: {
  axis: BboxFitAxis | null;
  highlight: HighlightValueWithId | null;
  imageSize: { width: number; height: number };
  canvasSize: { width: number; height: number };
  currentPageIndex: number;
}): { scale: number; centerX: number; centerY: number } | null {
  const { axis, highlight, imageSize, canvasSize, currentPageIndex } = params;
  if (!axis || !highlight) return null;
  // 인용이 있는 페이지에서만 맞춘다 (highlight.page 는 1-base).
  if (highlight.page !== currentPageIndex + 1) return null;
  if (imageSize.width <= 0 || imageSize.height <= 0) return null;
  if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;

  const focusTarget = resolveFocusTarget(highlight);
  if (!focusTarget) return null;

  const bbox = getBoundingBox(
    focusTarget.coordinates,
    imageSize,
    focusTarget.isRatioCoordinates,
  );
  if (!bbox) return null;

  return {
    scale: calculateZoomForBboxAxis(
      bbox,
      canvasSize,
      axis,
      undefined,
      MIN_ZOOM_RATIO,
      MAX_ZOOM_RATIO,
    ),
    centerX: bbox.centerX,
    centerY: bbox.centerY,
  };
}

interface UseCitationFitParams {
  /** 맞출 축 — null 이면 이 훅은 아무것도 하지 않는다(전체 페이지 보기). */
  axis: BboxFitAxis | null;
  selectedHighlight: HighlightValueWithId | null;
  imageSize: { width: number; height: number };
  canvasSize: { width: number; height: number };
  currentPageIndex: number;
  /**
   * 현재 페이지 이미지가 실제로 그려진 뒤에만 맞춘다. 로드 중에 맞추면 로드
   * 완료 시점의 fit 이 뒤늦게 덮어써 인용을 클릭해 페이지를 옮길 때 배율이
   * 풀린다. 준비 전에는 null, 준비되면 그 이미지를 가리키는 키.
   */
  readyImageKey: string | null;
  /** 목표 배율·목표 지점을 한 번에 적용한다. */
  focusOn: (params: {
    scale: number;
    centerX: number;
    centerY: number;
  }) => Transform | null;
  /** 모드를 끌 때 전체 페이지 보기로 되돌린다. */
  fitToScreen: () => Transform | null;
}

/**
 * 선택된 인용 bbox 가 캔버스의 한 축을 채우도록 맞춘다.
 *
 * `useAutoFocusBbox`(Table View)와 달리 **사용자가 고른 모드**를 따르는 훅이다.
 * 그래서 축·인용·페이지·캔버스 크기가 바뀔 때만 다시 맞추고, 그 사이의
 * 확대·이동은 건드리지 않는다. 모드를 끄면 한 번 전체 페이지로 되돌린 뒤 손을
 * 뗀다. 인용이 없는 페이지로 넘어가면 개입하지 않는다 — 그 페이지는 뷰어의
 * 기본 fit 이 맡는다.
 */
export function useCitationFit({
  axis,
  selectedHighlight,
  imageSize,
  canvasSize,
  currentPageIndex,
  readyImageKey,
  focusOn,
  fitToScreen,
}: UseCitationFitParams) {
  // 마지막으로 적용한 조합 — 같은 조합에 두 번 개입하지 않는다(사용자 줌 보존).
  const appliedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!axis || !selectedHighlight) {
      // 모드를 껐거나 인용이 사라진 첫 프레임에만 전체 페이지로 되돌린다.
      if (appliedKeyRef.current !== null) {
        appliedKeyRef.current = null;
        fitToScreen();
      }
      return;
    }

    // 이미지가 실제로 그려진 뒤에만 맞춘다 — 로드 중에 맞추면 로드 완료 시점의
    // 배치가 뒤늦게 덮어쓴다.
    if (!readyImageKey) return;

    const key = [
      selectedHighlight.id,
      axis,
      readyImageKey,
      currentPageIndex,
      `${canvasSize.width}x${canvasSize.height}`,
      `${imageSize.width}x${imageSize.height}`,
    ].join("::");
    if (appliedKeyRef.current === key) return;

    const focus = computeCitationFocus({
      axis,
      highlight: selectedHighlight,
      imageSize,
      canvasSize,
      currentPageIndex,
    });
    if (!focus) return;

    appliedKeyRef.current = key;
    focusOn(focus);
  }, [
    axis,
    selectedHighlight,
    imageSize,
    canvasSize,
    currentPageIndex,
    readyImageKey,
    focusOn,
    fitToScreen,
  ]);
}
