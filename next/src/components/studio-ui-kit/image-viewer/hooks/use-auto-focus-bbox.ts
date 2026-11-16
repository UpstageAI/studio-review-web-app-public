import { useEffect, useRef } from "react";
import type { HighlightValueWithId } from "../../shared/types/highlight";
import {
  getBoundingBox,
  calculateZoomForBbox,
  resolveFocusTarget,
} from "../utils/bbox-utils";
import { MIN_ZOOM_RATIO } from "../constants/image-viewer";

/** 기존 자동 포커스 동작의 확대 상한. */
const AUTO_FOCUS_MAX_ZOOM_RATIO = 5;

interface Transform {
  scale: number;
  rotation: number;
  tx: number;
  ty: number;
  matrix: number[][];
}

interface UseAutoFocusBboxParams {
  /** 자동 포커스 활성화 여부 */
  enabled: boolean;
  /** 선택된 하이라이트 */
  selectedHighlight: HighlightValueWithId | null;
  /** 이미지 원본 크기 */
  imageSize: { width: number; height: number };
  /** 캔버스(뷰포트) 크기 */
  canvasSize: { width: number; height: number };
  /** 현재 페이지 인덱스 */
  currentPageIndex: number;
  /** 줌 함수 (선택적 anchor point 지원) */
  zoomTo: (scale: number, anchorPoint?: { x: number; y: number }) => void;
  /** 리셋 함수 (이미지를 캔버스에 fit, 새 transform 반환) */
  fitToScreen: () => Transform | null;
  /** Pan 함수 (offset 기반 이동) */
  panTo: (offset: { x: number; y: number }) => void;
  /** 현재 transform — 같은 페이지 안에서 zoom 유지하고 pan 만 보정할 때 사용 */
  transform?: Transform | null;
  /** 새로 선택된 하이라이트로 포커스를 시작할 때 호출되는 콜백 */
  onFocusStart?: () => void;
  /**
   * 포커스 동작 완료 시 호출되는 콜백. 선택이 해제되거나 기능이 꺼져 포커스가
   * 더 이상 필요 없을 때도 호출된다.
   */
  onFocusComplete?: () => void;
  /** 최소 줌 레벨 */
  minZoom?: number;
  /** 최대 줌 레벨 */
  maxZoom?: number;
}

/**
 * 선택된 하이라이트의 bbox 영역으로 자동 줌/포커스하는 커스텀 훅
 *
 * - selectedHighlight가 변경될 때마다 해당 bbox 영역으로 자동 확대
 * - word coordinates가 있으면 해당 영역을, 없으면 main coordinates를 기준으로 계산
 * - bbox가 화면의 70% 정도를 차지하도록 줌 레벨 조정
 */
export function useAutoFocusBbox({
  enabled,
  selectedHighlight,
  imageSize,
  canvasSize,
  currentPageIndex,
  zoomTo,
  fitToScreen,
  panTo,
  transform,
  onFocusStart,
  onFocusComplete,
  minZoom = MIN_ZOOM_RATIO,
  maxZoom = AUTO_FOCUS_MAX_ZOOM_RATIO,
}: UseAutoFocusBboxParams) {
  // 이전 하이라이트 ID를 추적하여 중복 실행 방지
  const prevHighlightIdRef = useRef<string | null>(null);
  // 이전 하이라이트 page 추적 (같은 페이지로 이동 시 zoom/transform 보존)
  const prevHighlightPageRef = useRef<number | null>(null);
  // Debounce와 단계별 zoom/pan 지연을 모두 추적해 선택 변경 시 함께 취소한다.
  const timeoutRefs = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // 진행 중인 smooth-pan 애니메이션의 RAF id (새 click 으로 덮어쓸 때 cancel).
  const panRafRef = useRef<number | null>(null);
  // 처리 진행 상태 추적
  const isProcessingRef = useRef<boolean>(false);
  // 마지막으로 시작·완료를 알린 요청(기능 on/off, 선택 객체)
  const focusRequestRef = useRef<{
    enabled: boolean;
    highlight: HighlightValueWithId | null;
  } | null>(null);
  // 콜백을 ref로 저장 (의존성 문제 해결)
  const onFocusStartRef = useRef(onFocusStart);
  const onFocusCompleteRef = useRef(onFocusComplete);
  const zoomToRef = useRef(zoomTo);
  const fitToScreenRef = useRef(fitToScreen);
  const panToRef = useRef(panTo);
  // 현재 transform 을 ref 로 추적 (pan/zoom 으로 transform 이 바뀔 때마다 effect 가
  // 재실행되어 무한 루프에 빠지지 않도록 dep array 에 넣지 않고 ref 로만 읽음).
  const transformRef = useRef(transform);

  // 콜백이 변경되면 ref 업데이트
  useEffect(() => {
    onFocusStartRef.current = onFocusStart;
    onFocusCompleteRef.current = onFocusComplete;
  }, [onFocusStart, onFocusComplete]);

  useEffect(() => {
    zoomToRef.current = zoomTo;
    fitToScreenRef.current = fitToScreen;
    panToRef.current = panTo;
  }, [zoomTo, fitToScreen, panTo]);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    const clearPendingTimeouts = () => {
      timeoutRefs.current.forEach(clearTimeout);
      timeoutRefs.current.clear();
    };
    const scheduleTimeout = (callback: () => void, delay: number) => {
      const timeout = setTimeout(() => {
        timeoutRefs.current.delete(timeout);
        callback();
      }, delay);
      timeoutRefs.current.add(timeout);
    };

    // 완료 콜백을 안전하게 호출하는 함수 (중복 호출 방지)
    const completeCallback = () => {
      if (isProcessingRef.current) {
        isProcessingRef.current = false;
        onFocusCompleteRef.current?.();
      }
    };

    // 기능 on/off 나 선택이 바뀌면 포커스 시작(또는 불필요)을 먼저 알린다.
    // 이어서 같은 실행에서 완료가 불리면(이미 포커스한 하이라이트, 같은 페이지
    // 이동) 두 상태 변경이 한 번에 반영되어 오버레이가 깜박이지 않는다.
    const focusRequest = focusRequestRef.current;
    if (
      !focusRequest ||
      focusRequest.enabled !== enabled ||
      focusRequest.highlight !== selectedHighlight
    ) {
      focusRequestRef.current = { enabled, highlight: selectedHighlight };
      if (enabled && selectedHighlight?.id) onFocusStartRef.current?.();
      else onFocusCompleteRef.current?.();
    }

    // 비활성화 상태이거나 필수 데이터가 없으면 실행하지 않음
    if (!enabled || !selectedHighlight) {
      // 같은 하이라이트를 다시 선택하거나 기능을 다시 켜면 새로 포커스한다.
      prevHighlightIdRef.current = null;
      prevHighlightPageRef.current = null;
      return;
    }

    if (
      imageSize.width <= 0 ||
      imageSize.height <= 0 ||
      canvasSize.width <= 0 ||
      canvasSize.height <= 0
    ) {
      // Early return - 콜백 호출하지 않음 (아직 준비 안 됨)
      return;
    }

    const highlightId = selectedHighlight.id;

    // 같은 하이라이트면 중복 실행하지 않음
    if (highlightId === prevHighlightIdRef.current) {
      // 이미 처리된 하이라이트 - 콜백 호출 (완료 상태)
      onFocusCompleteRef.current?.();
      return;
    }

    // 같은 페이지 안에서 다른 하이라이트로 이동하는 경우엔 zoom/transform 을
    // 그대로 두고 bbox 폴리곤만 시각적으로 옮긴다 (fitToScreen 호출이 일으키는
    // 깜박임을 방지). 화면 밖에 있는 경우엔 zoom 은 유지한 채 pan 으로만 중앙
    // 정렬한다. 다른 페이지로 이동할 때만 새 bbox 로 재포커스 (zoom 포함).
    const prevPage = prevHighlightPageRef.current;
    if (
      prevHighlightIdRef.current !== null &&
      prevPage !== null &&
      prevPage === selectedHighlight.page
    ) {
      const currentTransform = transformRef.current;
      const focusTarget = resolveFocusTarget(selectedHighlight);
      if (currentTransform && focusTarget) {
        const bbox = getBoundingBox(
          focusTarget.coordinates,
          imageSize,
          focusTarget.isRatioCoordinates,
        );
        if (bbox) {
          // panTo/zoomTo 후엔 transform.tx/ty 가 stale 이므로 matrix 로 계산해야
          // 화면 좌표가 정확히 나온다.
          const m = currentTransform.matrix;
          const bboxScreenX =
            m[0][0] * bbox.centerX + m[0][1] * bbox.centerY + m[0][2];
          const bboxScreenY =
            m[1][0] * bbox.centerX + m[1][1] * bbox.centerY + m[1][2];
          const bboxScreenW = bbox.width * currentTransform.scale;
          const bboxScreenH = bbox.height * currentTransform.scale;
          // bbox 의 어떤 부분이라도 캔버스 밖이면 중앙으로 pan.
          const isOutside =
            bboxScreenX - bboxScreenW / 2 < 0 ||
            bboxScreenX + bboxScreenW / 2 > canvasSize.width ||
            bboxScreenY - bboxScreenH / 2 < 0 ||
            bboxScreenY + bboxScreenH / 2 > canvasSize.height;
          if (isOutside) {
            const totalDx = canvasSize.width / 2 - bboxScreenX;
            const totalDy = canvasSize.height / 2 - bboxScreenY;
            // Smooth pan: ~250ms ease-out cubic. panTo 는 누적이라 매 프레임마다
            // (curEased - prevEased) 만큼만 추가로 옮긴다.
            if (panRafRef.current !== null) {
              cancelAnimationFrame(panRafRef.current);
            }
            const start = performance.now();
            const duration = 250;
            let prevEased = 0;
            const stepFn = (now: number) => {
              const tNorm = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - tNorm, 3);
              const delta = eased - prevEased;
              prevEased = eased;
              panToRef.current({ x: totalDx * delta, y: totalDy * delta });
              if (tNorm < 1) {
                panRafRef.current = requestAnimationFrame(stepFn);
              } else {
                panRafRef.current = null;
              }
            };
            panRafRef.current = requestAnimationFrame(stepFn);
          }
        }
      }
      prevHighlightIdRef.current = highlightId;
      prevHighlightPageRef.current = selectedHighlight.page;
      onFocusCompleteRef.current?.();
      return;
    }

    // 처리 시작
    isProcessingRef.current = true;

    // 이전 선택에서 남은 단계별 동작 취소
    clearPendingTimeouts();

    // Debounce: 100ms 후 실행
    scheduleTimeout(() => {
      try {
        // word_coordinates (주황색) 우선, 없으면 main coordinates (파란색).
        const focusTarget = resolveFocusTarget(selectedHighlight);
        if (!focusTarget) {
          completeCallback();
          return;
        }

        // Bounding box 계산
        const bbox = getBoundingBox(
          focusTarget.coordinates,
          imageSize,
          focusTarget.isRatioCoordinates,
        );

        if (!bbox) {
          completeCallback();
          return;
        }

        // 적절한 줌 레벨 계산
        const targetZoom = calculateZoomForBbox(
          bbox,
          imageSize,
          canvasSize,
          0.7, // 화면의 70% 차지
          minZoom,
          maxZoom,
        );

        // Fit to screen으로 초기화하고 새 transform 받기
        const newTransform = fitToScreenRef.current();
        if (!newTransform) {
          completeCallback();
          return;
        }

        // 약간의 지연 후 새 transform 기반으로 bbox 위치 계산
        scheduleTimeout(() => {
          // fitToScreen()에서 반환된 새 transform 사용 (클로저 문제 해결)
          const bboxScreenX =
            newTransform.tx + bbox.centerX * newTransform.scale;
          const bboxScreenY =
            newTransform.ty + bbox.centerY * newTransform.scale;

          // 화면 중앙 좌표
          const screenCenterX = canvasSize.width / 2;
          const screenCenterY = canvasSize.height / 2;

          // bbox 화면 좌표를 anchor로 줌 - 이 점이 고정됨
          zoomToRef.current(targetZoom, {
            x: bboxScreenX,
            y: bboxScreenY,
          });

          // 줌 후 bbox를 화면 중앙으로 이동
          scheduleTimeout(() => {
            // 중앙으로 이동하기 위한 offset
            const offsetX = screenCenterX - bboxScreenX;
            const offsetY = screenCenterY - bboxScreenY;

            panToRef.current({ x: offsetX, y: offsetY });

            // 모든 애니메이션 완료 후 하이라이트 ID 저장 및 콜백 호출
            scheduleTimeout(() => {
              // 애니메이션 완료 후 ID 저장 (중복 실행 방지)
              prevHighlightIdRef.current = highlightId;
              prevHighlightPageRef.current = selectedHighlight.page;
              completeCallback();
            }, 100);
          }, 50);
        }, 100);
      } catch (error) {
        console.error("Auto-focus bbox error:", error);
        completeCallback();
      }
    }, 100);

    // Cleanup
    return () => {
      clearPendingTimeouts();
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      // 처리 중 상태 초기화 (콜백 호출 안 함 - overlay가 컴포넌트 내부에 있음)
      isProcessingRef.current = false;
    };
  }, [
    enabled,
    selectedHighlight,
    imageSize,
    canvasSize,
    currentPageIndex,
    minZoom,
    maxZoom,
  ]);
}
