import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useResizeDetector } from "react-resize-detector";
import { cn } from "@/lib/utils";
import { useImageTool } from "../../hooks/use-image-tool";
import type { HighlightValueWithId } from "../../../shared/types/highlight";
import { HighlightPolygon } from "./highlight-polygon";
import { highlightRenderKey } from "./highlight-render-key";

export interface ImageCanvasProps {
  imageUrl: string;
  cssTransform: string;
  onResizeCanvas: (size: { width: number; height: number }) => void;
  onMoveImage: (offset: { x: number; y: number }) => void;
  /** 끌어서 옮길 수 있는지 — 페이지가 캔버스를 넘칠 때만 켠다. 기본 true. */
  panEnabled?: boolean;
  onImageSizeChanged: (size: { width: number; height: number }) => void;
  onImageLoaded(): void;
  onImageError?(): void;
  selectedHighlight?: HighlightValueWithId | null;
  hoveredHighlight?: HighlightValueWithId | null;
  highlightColor: string;
  wordHighlightColor: string;
  currentPageIndex: number;
  /**
   * 선택된 하이라이트가 없을 때 기본으로 렌더링할 전체 하이라이트 목록
   * - DP Preview 등에서 현재 페이지의 모든 element 하이라이트를 보여줄 때 사용
   * - preview 리스트에는 스타일을 입히지 않고, 이미지 캔버스에만 표시하고 싶을 때 사용
   */
  allHighlights?: HighlightValueWithId[] | null;
  /**
   * 이미지 캔버스에서 하이라이트를 클릭했을 때 호출되는 콜백
   * - DP Preview 리스트와 동기화할 때 사용
   */
  onHighlightSelect?: (highlight: HighlightValueWithId | null) => void;
  /**
   * 이미지 캔버스에서 하이라이트를 호버했을 때 호출되는 콜백
   */
  onHighlightHover?: (highlight: HighlightValueWithId | null) => void;
  compactPadding?: boolean;
  comparisonMode?: boolean;
  highlightSequence?: number;
  comparisonContent?: Record<
    string,
    { text?: string; pending?: boolean; sourceText?: string }
  >;
  testId?: string;
}

/**
 * padding·border 를 뺀 content box 크기. useResizeDetector 가 알리는 값과 같은
 * 상자다. border box 를 쓰면 캔버스가 wrapper 의 content box 보다 커져, 높이로
 * 맞춘 페이지는 넘친 만큼 아래가 잘리고 폭으로 맞춘 페이지는 padding 으로 넘친다.
 */
function contentBoxSize(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const px = (value: string) => parseFloat(value) || 0;
  return {
    width:
      rect.width -
      px(style.paddingLeft) -
      px(style.paddingRight) -
      px(style.borderLeftWidth) -
      px(style.borderRightWidth),
    height:
      rect.height -
      px(style.paddingTop) -
      px(style.paddingBottom) -
      px(style.borderTopWidth) -
      px(style.borderBottomWidth),
  };
}

export function ImageCanvas({
  imageUrl,
  cssTransform,
  onResizeCanvas,
  onMoveImage,
  panEnabled = true,
  onImageSizeChanged,
  onImageLoaded,
  onImageError,
  selectedHighlight,
  hoveredHighlight,
  highlightColor,
  wordHighlightColor,
  currentPageIndex,
  allHighlights,
  onHighlightSelect,
  onHighlightHover,
  compactPadding = false,
  comparisonMode = false,
  highlightSequence = 0,
  comparisonContent,
  testId,
}: ImageCanvasProps): React.JSX.Element {
  // 어떤 URL이 실제 SVG <image> 로드까지 끝났는지 보관한다. boolean 상태는
  // URL 교체 첫 렌더에서 이전 true 값이 남아 새 이미지의 깨진 placeholder를
  // 한 프레임 노출할 수 있다.
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null);
  const [actualImageSize, setActualImageSize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<SVGSVGElement>(null);

  const { ref, width = 0, height = 0 } = useResizeDetector<HTMLDivElement>();
  const imageTool = useImageTool(canvasRef, imageRef, onMoveImage, panEnabled);

  /**
   * 관측값이 도착하기 전(또는 마운트 타이밍에 따라 관측을 놓쳤을 때) 크기를 직접
   * 잰다. 이게 없으면 wrapper 가 실제로는 화면을 채우고 있는데도 관측값이 0 에
   * 머물러, 아래 -10 보정 때문에 캔버스가 음수 크기로 굳고 아무것도 그려지지
   * 않는다(문서가 빈 화면으로 남는다).
   */
  const [measured, setMeasured] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const size = contentBoxSize(el);
      if (size.width > 0 && size.height > 0) {
        setMeasured(prev =>
          prev.width === size.width && prev.height === size.height
            ? prev
            : size,
        );
      }
    };
    measure();
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [ref, imageUrl]);

  // 관측값이 있으면 그것을 쓰고, 직접 잰 값은 관측값이 없을(0 이하) 때만 쓴다.
  // 둘 중 큰 값을 쓰면 컨테이너가 줄어도 처음 잰 크기에 머물러 다시 맞추지 않는다.
  //
  // HACKs
  // wrapper 와 svg 의 width, height 값이 같으면
  // resize event 일어났을때도 wrapper 내부의 svg 크기 때문에 wrapper 크기가 변동되지 않는다.
  // 그래서 크기 변화 감지를 위해 10 정도 더 작게 svg 를 만들어서 감지한다.
  const observedWidth = width > 0 ? width : measured.width;
  const observedHeight = height > 0 ? height : measured.height;
  // 관측 전(0)에는 0 을 유지한다 — 음수로 내려가면 배율 계산이 뒤집힌다.
  const canvasWidth = observedWidth > 0 ? Math.max(observedWidth - 10, 0) : 0;
  const canvasHeight =
    observedHeight > 0 ? Math.max(observedHeight - 10, 0) : 0;
  const svgWidth = canvasWidth;
  const svgHeight = canvasHeight;

  useLayoutEffect(() => {
    // 아직 재지 못한 0 은 알리지 않는다. 페이지를 넘길 때 이 컴포넌트는 로딩
    // 화면 때문에 한 번 사라졌다 다시 붙는데, 그때 0 을 알리면 캔버스 크기가
    // 645 → 0 → 645 로 튀고, 돌아오는 순간을 "리사이즈"로 본 기본 fit 이
    // 읽던 확대 배율을 덮어쓴다.
    if (canvasWidth <= 0 || canvasHeight <= 0) return;
    onResizeCanvas({ width: canvasWidth, height: canvasHeight });
  }, [canvasWidth, canvasHeight, onResizeCanvas]);

  const imageLoaded = useMemo(() => {
    return imageUrl !== "" && loadedImageUrl === imageUrl;
  }, [imageUrl, loadedImageUrl]);

  const mode = allHighlights && allHighlights.length > 0 ? "all" : "single";

  return (
    <div
      // 배경은 두지 않는다 — 뷰어 루트가 칠한 캔버스 색이 비친다.
      className={cn(
        "relative grid h-full content-center justify-items-center",
        compactPadding ? "p-2" : "p-4",
        !imageLoaded && "opacity-0",
      )}
      ref={ref}
      data-testid={testId || "image-canvas"}
    >
      {imageUrl ? (
        <div
          className={`relative overflow-hidden ${imageTool.cursor}`}
          ref={canvasRef}
        >
          <svg
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{
              transform: cssTransform,
              overflow: "visible",
              transformOrigin: "top left",
            }}
            ref={imageRef}
          >
            <image
              href={imageUrl}
              onLoad={e => {
                // URL 교체 직전에 시작된 이전 요청의 load 이벤트는 무시한다.
                if (e.currentTarget.getAttribute("href") !== imageUrl) return;
                const bbox = e.currentTarget.getBBox();
                const size = {
                  width: bbox.width,
                  height: bbox.height,
                };
                setActualImageSize(size);
                onImageSizeChanged(size);
                setLoadedImageUrl(imageUrl);
                onImageLoaded();
              }}
              onError={e => {
                // URL 교체 직전에 시작된 이전 요청의 error 이벤트는 무시한다.
                if (e.currentTarget.getAttribute("href") !== imageUrl) return;
                onImageError?.();
              }}
            />

            {/* 선택된 하이라이트가 없을 때, 현재 페이지의 모든 하이라이트를 배경으로 렌더링
                - allHighlights 기반으로 hover된 하이라이트만 선택 스타일로 표시
                - 클릭/호버 시 상위로 이벤트를 전달하여 preview viewer와 동기화 */}
            {mode === "all" &&
              allHighlights?.map((highlight, index) => {
                const isActive = selectedHighlight?.id === highlight.id;
                return (
                  <HighlightPolygon
                    key={highlightRenderKey(
                      highlight,
                      index,
                      isActive,
                      highlightSequence,
                    )}
                    highlight={highlight}
                    isSelected={
                      comparisonMode
                        ? isActive
                        : selectedHighlight
                          ? isActive
                          : true // 선택된 하이라이트가 없을 때 모든 하이라이트를 선택 스타일로 표시
                    }
                    isBackground={comparisonMode && !isActive}
                    pulse={comparisonMode && isActive && highlightSequence > 0}
                    replacement={comparisonContent?.[highlight.id]}
                    isHovered={
                      hoveredHighlight
                        ? hoveredHighlight?.id === highlight.id
                        : false
                    }
                    highlightColor={highlightColor}
                    wordHighlightColor={wordHighlightColor}
                    currentPageIndex={currentPageIndex}
                    actualImageSize={actualImageSize}
                    onHover={onHighlightHover}
                    onClick={onHighlightSelect}
                  />
                );
              })}

            {mode === "single" && (
              <>
                {/* 호버된 하이라이트 (기본 하이라이트 위에 렌더링) */}
                <HighlightPolygon
                  highlight={hoveredHighlight ?? null}
                  isSelected={false}
                  isHovered={true}
                  highlightColor={highlightColor}
                  wordHighlightColor={wordHighlightColor}
                  currentPageIndex={currentPageIndex}
                  actualImageSize={actualImageSize}
                  onHover={onHighlightHover}
                  onClick={onHighlightSelect}
                />
                {/* 선택된 하이라이트 (가장 위에 렌더링) */}
                <HighlightPolygon
                  highlight={selectedHighlight ?? null}
                  isSelected={true}
                  isHovered={false}
                  highlightColor={highlightColor}
                  wordHighlightColor={wordHighlightColor}
                  currentPageIndex={currentPageIndex}
                  actualImageSize={actualImageSize}
                  onHover={onHighlightHover}
                  onClick={onHighlightSelect}
                />
              </>
            )}
          </svg>
        </div>
      ) : null}
    </div>
  );
}
