import { ImageCanvas } from "./image-canvas";
import { useImageRendering } from "./image-canvas/hooks/use-image-rendering";
import { useAutoFocusBbox } from "../hooks/use-auto-focus-bbox";
import {
  computeCitationFocus,
  useCitationFit,
} from "../hooks/use-citation-fit";
import type { BboxFitAxis } from "../utils/bbox-utils";
import { panWithinPageOffset } from "../utils/pan-within-page";
import {
  EDGE_FLIP_RESET_MS,
  createEdgeScrollAccumulator,
  createGestureFlipLock,
  isPageOverflowing,
  isWheelNotch,
} from "../utils/edge-scroll";
import {
  createLayoutSettleGate,
  layoutSettleKey,
} from "../utils/layout-settle";
import { cn } from "@/lib/utils";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { ImageViewToolbar } from "./tool-bar";
import { ContinuousImageViewer } from "./continuous-image-viewer";
import type { HighlightValueWithId } from "../../shared/types/highlight";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_WORD_HIGHLIGHT_COLOR,
  MIN_ZOOM_RATIO,
} from "../constants/image-viewer";
import { FrownIcon } from "lucide-react";

/**
 * 번역 함수 타입
 * 외부 패키지로 사용될 때 번역 함수를 주입받을 수 있도록 optional로 설정
 */
export type TranslateFunction = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface ImageViewerSectionProps {
  /**
   * Host-owned class names applied to the viewer root. The root paints the
   * canvas background (`bg-muted`), so a background class here recolors the
   * whole canvas.
   */
  className?: string;
  imgUrls: string[];
  currentPageIndex: number;
  onPageSelect: (index: number) => void;
  selectedHighlight?: HighlightValueWithId | null;
  hoveredHighlight?: HighlightValueWithId | null;
  /**
   * 하이라이트의 기본 색. `color`가 없는 하이라이트에 쓴다.
   * CSS 색 문자열이면 무엇이든 된다(`#2563eb`, `oklch(…)`, `var(--chart-2)`).
   */
  highlightColor?: string;
  /** 단어 하이라이트의 기본 색. `word_coordinates_color`가 없는 하이라이트에 쓴다. */
  wordHighlightColor?: string;
  /**
   * 선택된 하이라이트가 없을 때 이미지 캔버스에 배경으로 렌더링할 전체 하이라이트 목록
   * - DP Preview 등에서 사용
   */
  allHighlights?: HighlightValueWithId[] | null;
  /**
   * 이미지 캔버스에서 하이라이트를 클릭했을 때 호출되는 콜백
   */
  onHighlightSelect?: (highlight: HighlightValueWithId | null) => void;
  /**
   * 이미지 캔버스에서 하이라이트를 호버했을 때 호출되는 콜백
   */
  onHighlightHover?: (highlight: HighlightValueWithId | null) => void;
  /** 번역 대조처럼 선택 여부와 무관하게 모든 bbox를 옅게 유지하는 모드. */
  comparisonMode?: boolean;
  /** 같은 bbox 재선택 시 Paged는 pulse를, Continuous는 위치 이동을 다시 적용한다. */
  highlightSequence?: number;
  /** bbox 위에 원문 대신 표시할 번역 또는 미완료 스켈레톤. */
  comparisonContent?: Record<
    string,
    { text?: string; pending?: boolean; sourceText?: string }
  >;
  /**
   * 선택된 하이라이트로 자동 포커스/줌 여부 (Table View용)
   * - true: 하이라이트 선택 시 해당 bbox 영역으로 자동 확대
   * - false/undefined: 기존 동작 유지 (자동 확대 없음)
   */
  autoFocusOnHighlight?: boolean;
  /**
   * 선택된 인용(bbox)이 캔버스의 한 축을 채우도록 맞춘다 (Grace 채팅 인용 보기용).
   * - "width"/"height": 해당 축을 채우도록 확대하고 bbox 를 화면 중앙에 둔다
   * - null/undefined: 전체 페이지 보기 (기본)
   *
   * `autoFocusOnHighlight` 와 달리 페이지 이동·이미지 로드 시의 기본 fit 동작을
   * 바꾸지 않는다 — 사용자가 켠 동안 인용만 맞춰 준다.
   */
  citationFitAxis?: BboxFitAxis | null;
  /**
   * 페이지를 세로로 쌓아 이어서 스크롤한다 (Grace 채팅 뷰어).
   *
   * 한 장씩 갈아 끼우는 기본 방식은 "페이지 끝에서 얼마나 더 굴려야 다음 장인가"를
   * 우리가 정해야 해서, 트랙패드 관성·이미지 로딩과 얽혀 규칙이 계속 어긋났다.
   * 이어서 스크롤하면 그 판단이 사라진다. 회전·번역 대조·자동 포커스(Table View)는
   * 아직 기본 방식만 지원하므로, 그 경우에는 이 값이 켜져 있어도 기본 방식으로 그린다.
   */
  continuousScroll?: boolean;
  /**
   * 410px 미만의 호스트 컨테이너에서도 paged viewer가 줄어들도록 허용한다.
   * 이전 버전과 같은 기본 최소 너비를 유지하려면 false로 둔다.
   */
  allowNarrowLayout?: boolean;
  /** 좁은 패널에서 문서 주변 여백을 줄여 표시할지 여부 */
  compactCanvasPadding?: boolean;
  /**
   * 번역 함수 (optional)
   * 외부 패키지로 사용될 때 i18n을 주입받을 수 있도록 함
   * 제공되지 않으면 기본 영어 텍스트 사용
   */
  t?: TranslateFunction;
  testId?: string;
}

/** wheel 이벤트를 non-passive로 등록하여 preventDefault 가능하게 하는 hook */
function useNonPassiveWheel(
  ref: React.RefObject<HTMLDivElement | null>,
  handler: (e: WheelEvent) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [ref, handler]);
}

const MAX_RETRY = 3;
const RETRY_DELAY_MS = 1000;
/** 휠로 페이지를 이어서 넘길 때의 최소 간격(ms) */
const PAGE_FLIP_THROTTLE_MS = 150;
/** 기존 pinch/Ctrl+wheel 확대 상한. 툴바의 선택 범위와는 별개다. */
const WHEEL_MAX_ZOOM_RATIO = 5;

const PagedImageViewerSection: React.FC<ImageViewerSectionProps> = ({
  className,
  imgUrls,
  currentPageIndex,
  onPageSelect,
  selectedHighlight = null,
  hoveredHighlight = null,
  highlightColor = DEFAULT_HIGHLIGHT_COLOR,
  wordHighlightColor = DEFAULT_WORD_HIGHLIGHT_COLOR,
  allHighlights = null,
  onHighlightSelect,
  onHighlightHover,
  comparisonMode = false,
  highlightSequence = 0,
  comparisonContent,
  autoFocusOnHighlight = false,
  citationFitAxis = null,
  allowNarrowLayout = false,
  compactCanvasPadding = false,
  t,
  testId,
}) => {
  // 기본 번역 함수 (t가 없을 때 사용)
  const defaultT = (key: string) => {
    const defaults: Record<string, string> = {
      failedToLoadImage: "Failed to load image",
      pleaseTryAgain: "Please try again or refresh.",
      preparingPageImage: "Preparing page image...",
    };
    return defaults[key] || key;
  };

  const translate = t || defaultT;
  const [scale, setScale] = useState(1);
  const [cssTransform, setCssTransform] = useState("");
  const currentImageUrl = imgUrls[currentPageIndex] ?? null;
  // boolean 로만 보관하면 파일 교체 첫 렌더에서 이전 이미지의 ready/error 상태가
  // 새 URL에 잠깐 재사용된다. URL 과 상태를 함께 보관해 렌더 시점부터 새 이미지는
  // 반드시 loading 으로 취급한다 (깨진 SVG image placeholder 플래시 방지).
  const [imageLoadState, setImageLoadState] = useState<{
    url: string;
    status: "loading" | "retrying" | "ready" | "error";
  } | null>(null);
  // 새 URL 의 로드는 loading 에서 시작한다. URL 이 바뀐 렌더에서 바로 바꿔 두어야
  // 예전에 실패한 URL 로 돌아왔을 때 재시도하는 동안 이전 error 가 남지 않는다.
  const [requestedImageUrl, setRequestedImageUrl] = useState(currentImageUrl);
  if (requestedImageUrl !== currentImageUrl) {
    setRequestedImageUrl(currentImageUrl);
    if (currentImageUrl) {
      setImageLoadState({ url: currentImageUrl, status: "loading" });
    }
  }

  // 자동 포커스 로딩 상태 (Table View용). 켜고 끄는 시점은 포커스를 실제로
  // 진행하는 useAutoFocusBbox 가 알린다 — debounce·애니메이션을 거치는 외부
  // 동작이라 렌더 중에는 알 수 없다.
  const [isAutoFocusing, setIsAutoFocusing] = useState(false);

  /**
   * 렌더마다 새 함수를 넘기면 useImageRendering 이 돌려주는 fitToScreen·focusOn·
   * alignPage 도 매 렌더 새 함수가 되어, 이들을 deps 로 쓰는 배치 effect 가 매
   * 렌더 다시 돈다(= 사용자가 방금 한 확대·이동이 되돌려진다).
   */
  const imageScaleChangeHandler = useCallback((s: number) => {
    setScale(s);
  }, []);

  const {
    canvasSizeChangeHandler,
    canvasObjectMoveHandler,
    imageSizeChangeHandler,
    rotateBy,
    fitToScreen,
    alignPage,
    focusOn,
    panToPosition,
    zoomTo,
    imageSize,
    canvasSize,
    transform,
  } = useImageRendering({
    imageScaleChangeHandler,
    setCssTransform,
  });

  // 배치 계산에 쓰는 현재 값 — effect·핸들러의 stale closure 를 피해 ref 로 읽는다.
  const scaleRef = useRef(scale);
  const transformRef = useRef(transform);
  const imageSizeRef = useRef(imageSize);
  const canvasSizeRef = useRef(canvasSize);
  const currentPageIndexRef = useRef(currentPageIndex);
  const selectedHighlightRef = useRef(selectedHighlight);

  /**
   * 확대한 채 페이지를 넘기면 그 배율을 유지한다. 넘길 때마다 fit 으로 되돌리면
   * 읽던 배율이 풀려, 인용을 확대해 보다가 다음 페이지로 이어 읽을 수 없다.
   * 진행 방향의 첫 부분(아래로 넘기면 새 페이지 맨 위)이 보이게 붙인다.
   */
  const prevPageIndexRef = useRef(currentPageIndex);
  const pendingPageEntryRef = useRef<{
    scale: number;
    align: "top" | "bottom";
  } | null>(null);

  /**
   * 휠로 옮기려는 목표 위치(이미지 좌상단의 화면 좌표). 화면에 반영된 위치가
   * 아니라 "옮기려고 한" 위치다 — 트랙패드처럼 작은 이벤트가 빠르게 몰리면 화면
   * 반영이 이벤트보다 늦어, 반영된 위치로만 계산하면 같은 자리에서 맴돌며 이동이
   * 뭉개지고 페이지 끝에도 닿지 못한다(넘기려면 한참 굴려야 한다).
   * 휠 외의 경로로 배치가 바뀌면 버린다.
   */
  const panIntentRef = useRef<{ left: number; top: number } | null>(null);
  const dropPanIntent = useCallback(() => {
    panIntentRef.current = null;
  }, []);

  useEffect(() => {
    const prev = prevPageIndexRef.current;
    if (prev === currentPageIndex) return;
    prevPageIndexRef.current = currentPageIndex;

    const zoomedIn = isPageOverflowing({
      shownWidth: imageSizeRef.current.width * scaleRef.current,
      shownHeight: imageSizeRef.current.height * scaleRef.current,
      canvas: canvasSizeRef.current,
    });
    pendingPageEntryRef.current = zoomedIn
      ? {
          scale: scaleRef.current,
          align: currentPageIndex > prev ? "top" : "bottom",
        }
      : null;
  }, [currentPageIndex]);

  // 자동 포커스 시작·완료 콜백. 선택이 해제되거나 기능이 꺼질 때도 완료가
  // 불려 진행 중이던 오버레이를 즉시 걷는다.
  const handleInternalAutoFocusStart = useCallback(() => {
    setIsAutoFocusing(true);
  }, []);
  const handleInternalAutoFocusComplete = useCallback(() => {
    setIsAutoFocusing(false);
  }, []);

  // Auto-focus bbox hook (Table View용)
  useAutoFocusBbox({
    enabled: autoFocusOnHighlight,
    selectedHighlight,
    imageSize,
    canvasSize,
    currentPageIndex,
    zoomTo,
    fitToScreen,
    panTo: canvasObjectMoveHandler,
    transform,
    onFocusStart: handleInternalAutoFocusStart,
    onFocusComplete: handleInternalAutoFocusComplete,
  });

  // 사용자가 고른 인용 맞춤(폭/높이) — 자동 포커스와 달리 켠 동안만 개입한다.
  const citationFitAxisActive = autoFocusOnHighlight ? null : citationFitAxis;
  const citationFitAxisRef = useRef(citationFitAxisActive);
  /**
   * 인용 맞춤이 이 페이지의 배치를 맡고 있는지. 맡는 동안에는 페이지 이동·이미지
   * 로드 시의 기본 fit 을 걸지 않는다 — 걸면 맞춘 배율을 곧바로 덮어써, 인용
   * 사이를 오갈 때 선택이 반영되지 않는다.
   */
  const citationFitDriving =
    Boolean(citationFitAxisActive) &&
    selectedHighlight?.page === currentPageIndex + 1;

  /** 현재 페이지 이미지가 실제로 그려졌는지 — 배치는 그 뒤에 잡아야 안 덮인다. */
  const readyImageKey =
    currentImageUrl &&
    imageLoadState?.url === currentImageUrl &&
    imageLoadState.status === "ready"
      ? currentImageUrl
      : null;

  useCitationFit({
    axis: citationFitAxisActive,
    selectedHighlight,
    imageSize,
    canvasSize,
    currentPageIndex,
    readyImageKey,
    focusOn,
    fitToScreen,
  });

  // [currentImageUrl] effect·휠 핸들러는 deps 를 좁게 유지하므로 ref 로 읽는다.
  const citationFitDrivingRef = useRef(citationFitDriving);
  const readyImageKeyRef = useRef(readyImageKey);

  /**
   * 페이지 이미지가 준비된 시점의 배치를 한 곳에서 정한다.
   *
   * 이전에는 경로마다(페이지 변경 effect·이미지 로드 콜백·인용 맞춤 훅) 각자
   * fit 을 걸거나 건너뛰어서, 순서에 따라 배율이 풀리거나 아무도 fit 을 걸지
   * 않아 화면이 비는 일이 있었다. 우선순위는 인용 맞춤 → 확대 유지 → 전체 페이지.
   */
  const settleLayout = useCallback((): boolean => {
    if (autoFocusOnHighlight) return true; // Table View 는 useAutoFocusBbox 가 맡는다

    // 배치를 새로 잡으므로 휠로 옮기려던 목표는 버린다.
    panIntentRef.current = null;

    const focus = computeCitationFocus({
      axis: citationFitAxisRef.current,
      highlight: selectedHighlightRef.current,
      imageSize: imageSizeRef.current,
      canvasSize: canvasSizeRef.current,
      currentPageIndex: currentPageIndexRef.current,
    });
    if (focus && focusOn(focus)) {
      // 인용 맞춤이 이겼으면 넘어오며 들고 온 배율은 버린다.
      pendingPageEntryRef.current = null;
      return true;
    }

    const pending = pendingPageEntryRef.current;
    if (pending) {
      // 크기를 아직 모르면 붙이지 못한다 — fit 으로 덮지 말고 다음 기회를 기다린다.
      //
      // 성공해도 인수인계를 버리지 않는다. 페이지를 넘긴 뒤 크기가 한 번 더
      // 확정되는 경우(장마다 크기가 다른 문서, 로딩 화면 뒤 재측정)에 배치를 또
      // 정하는데, 그때 인수인계가 비어 있으면 기본 fit 이 걸려 배율이 풀린다.
      // 같은 값으로 다시 붙이는 것은 결과가 같아(멱등) 안전하고, 사용자가 직접
      // 확대·이동하면 그 시점에 버린다.
      return Boolean(alignPage(pending));
    }

    return Boolean(fitToScreen());
  }, [autoFocusOnHighlight, focusOn, alignPage, fitToScreen]);

  /**
   * 최신 값을 ref 에 모아 둔다 — 휠 핸들러·배치 effect 는 좁은 deps 를 유지해야
   * 해서 여기서 읽는다. 렌더 중에 대입하면 동시성 렌더에서 어긋날 수 있어
   * 커밋 뒤에 한 번에 맞춘다.
   */
  useEffect(() => {
    scaleRef.current = scale;
    transformRef.current = transform;
    imageSizeRef.current = imageSize;
    canvasSizeRef.current = canvasSize;
    currentPageIndexRef.current = currentPageIndex;
    selectedHighlightRef.current = selectedHighlight;
    citationFitAxisRef.current = citationFitAxisActive;
    citationFitDrivingRef.current = citationFitDriving;
    readyImageKeyRef.current = readyImageKey;
    zoomToRef.current = zoomTo;
    panToPositionRef.current = panToPosition;
  });

  /**
   * 페이지 이미지가 그려졌고 크기를 알게 된 뒤에 배치를 확정한다. 이 시점 하나로
   * 모으지 않으면(로드 전 미리 정하거나, 콜백에서 정하면) 뒤따라오는 기본 fit 이
   * 배율을 덮어써, 스크롤로 페이지를 넘길 때 확대가 풀린다.
   *
   * 조합(이미지·크기)마다 딱 한 번만 정한다. 매 렌더 정하면 사용자가 방금 굴린
   * 휠·확대가 그 렌더에서 되돌려져, 확대 상태에서 스크롤·줌이 먹지 않는다.
   * 적용에 실패했을 때(크기를 아직 모를 때)는 기록하지 않고 다음 기회를 노린다.
   */
  const settleGateRef = useRef(createLayoutSettleGate());
  useEffect(() => {
    const key = layoutSettleKey({ readyImageKey, imageSize, canvasSize });
    if (!key || !settleGateRef.current.shouldSettle(key)) return;
    if (settleLayout()) settleGateRef.current.markSettled(key);
  }, [readyImageKey, imageSize, canvasSize, settleLayout]);

  /**
   * 사용자가 직접 배율·위치를 잡으면 페이지 넘김 때 들고 온 인수인계는 버린다 —
   * 남겨 두면 다음 배치 확정에서 그 값으로 되돌아간다.
   */
  const dropPendingPageEntry = useCallback(() => {
    pendingPageEntryRef.current = null;
  }, []);

  // 페이지가 캔버스에 다 들어오면 옮길 곳이 없다 — 손 도구를 끈다(회전 중엔 유지).
  const panEnabled =
    Boolean(transform.rotation) ||
    imageSize.width * transform.scale > canvasSize.width + 1 ||
    imageSize.height * transform.scale > canvasSize.height + 1;

  const handleRotateRight = () => {
    dropPanIntent();
    rotateBy(90);
  };

  const handleReset = () => {
    dropPendingPageEntry();
    dropPanIntent();
    fitToScreen();
  };

  // 🖱️ 마우스 휠: Ctrl/Meta+wheel → 확대/축소, 확대 상태에서는 페이지 안 이동,
  //    페이지 끝에 닿으면 페이지 전환
  const wheelThrottleRef = useRef(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  // zoomTo 를 ref 에 보관 (useCallback의 stale closure 방지)
  const zoomToRef = useRef(zoomTo);
  const panToPositionRef = useRef(panToPosition);
  // 페이지 끝에서 모으는 스크롤량 — 이어서 더 굴렸을 때만 페이지를 넘긴다.
  const edgeScrollRef = useRef(createEdgeScrollAccumulator());
  // 한 번의 스크롤 제스처에 한 장만 넘긴다.
  const flipLockRef = useRef(createGestureFlipLock());
  /**
   * 페이지 이미지를 그리는 동안 굴린 스크롤로 예약된 넘김 (방향과 시각).
   * 이 구간의 스크롤을 버리면 이미지가 뜨는 수백 ms 동안 굴린 것이 헛돌아,
   * 한 장 넘기는 데 한참 굴려야 한다.
   */
  const queuedFlipRef = useRef<{ dir: number; at: number } | null>(null);
  /**
   * 이번 스크롤 제스처에서 페이지 안을 움직였는지. 움직여 내려가다 끝에 닿았다면
   * 거기서 한 번 걸리게 한다 — 세게 민 힘 그대로 다음 장까지 넘어가면 페이지
   * 아래쪽을 볼 새가 없다. 반대로 이미 끝에 있는 상태에서 새로 밀었다면 걸리지
   * 않고 바로 넘어간다(그 밀기가 "한 번 더"다).
   */
  const pannedThisGestureRef = useRef(false);
  /** 직전 휠 이벤트 시각 — 휠 눈금과 촘촘한 트랙패드 스크롤을 가르는 데 쓴다. */
  const prevWheelAtRef = useRef<number | null>(null);

  /**
   * 확대 상태의 휠 스크롤 — 페이지 안을 먼저 훑고, 그 방향 끝에 닿으면 false 를
   * 돌려 페이지 전환에 넘긴다. 계산은 panWithinPageOffset 가 맡는다.
   *
   * @returns 이동을 처리했으면 true (페이지 전환을 하지 않는다)
   */
  const panWithinPage = useCallback(
    (deltaX: number, deltaY: number): boolean => {
      const canvas = canvasSizeRef.current;
      const image = imageSizeRef.current;
      const current = transformRef.current;
      const matrix = current?.matrix;
      if (!matrix || canvas.width <= 0 || image.width <= 0) return false;

      // 회전 중에는 화면상의 상하좌우가 이미지 축과 어긋난다 — 개입하지 않는다.
      if (current?.rotation) return false;

      const scaleNow = current?.scale ?? scaleRef.current;
      // 이미지 좌상단의 현재 위치 — 아직 반영되지 않은 목표가 있으면 그쪽이 기준이다.
      const from = panIntentRef.current ?? {
        left: matrix[0][2],
        top: matrix[1][2],
      };
      const offset = panWithinPageOffset({
        left: from.left,
        top: from.top,
        shownWidth: image.width * scaleNow,
        shownHeight: image.height * scaleNow,
        canvas,
        deltaX,
        deltaY,
      });
      if (!offset) return false;

      const next = { left: from.left + offset.x, top: from.top + offset.y };
      panIntentRef.current = next;
      panToPositionRef.current(next);
      return true;
    },
    [],
  );

  /**
   * 손 도구 드래그 — 휠과 같은 경계로 자른다. 페이지가 캔버스를 넘치는 축만
   * 움직이고 페이지 끝을 넘어 빈 곳을 드러내지 않는다. 회전 중에는 화면 축과
   * 이미지 축이 어긋나므로 휠처럼 개입하지 않고 기존대로 옮긴다.
   *
   * 기준 위치는 반영된 transform 이다. 드래그 이동량은 화면에 그려진 이미지
   * 위치를 기준으로 재므로, 아직 반영되지 않은 목표(panIntent)를 쓰면 이중으로 옮긴다.
   */
  const dragWithinPage = useCallback(
    (offset: { x: number; y: number }) => {
      dropPanIntent();
      const canvas = canvasSizeRef.current;
      const image = imageSizeRef.current;
      const current = transformRef.current;
      const matrix = current?.matrix;
      if (
        !matrix ||
        current?.rotation ||
        canvas.width <= 0 ||
        image.width <= 0
      ) {
        canvasObjectMoveHandler(offset);
        return;
      }
      const scaleNow = current?.scale ?? scaleRef.current;
      const from = { left: matrix[0][2], top: matrix[1][2] };
      const moved = panWithinPageOffset({
        left: from.left,
        top: from.top,
        shownWidth: image.width * scaleNow,
        shownHeight: image.height * scaleNow,
        canvas,
        // panWithinPageOffset 는 스크롤 방향(아래로 굴리면 위로 이동)으로 받는다.
        deltaX: -offset.x,
        deltaY: -offset.y,
      });
      if (!moved) return;
      panToPositionRef.current({
        left: from.left + moved.x,
        top: from.top + moved.y,
      });
    },
    [canvasObjectMoveHandler, dropPanIntent],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const now = Date.now();
      // 휠 눈금인지(= 굴리는 대로 넘겨도 되는 입력인지)는 크기와 간격을 함께 본다.
      // 빠른 트랙패드 스크롤은 delta 가 커져 크기만으로는 눈금과 구분되지 않고,
      // 눈금으로 오인하면 잠금이 풀려 한 번에 두세 장이 넘어간다.
      const wheelNotch = isWheelNotch(e.deltaY, prevWheelAtRef.current, now);
      prevWheelAtRef.current = now;
      // 스크롤이 멎었다 다시 굴러가면 새 제스처다 — 그때 한 장을 다시 허용한다.
      // 넘긴 페이지를 그리는 동안은(ready 전) 화면이 한참 멈춰 이벤트 간격이
      // 벌어지므로, 그 구간의 공백을 "손을 뗐다"로 보지 않는다.
      if (readyImageKeyRef.current) {
        if (flipLockRef.current.observe(now)) {
          // 새 제스처 — 이번 밀기가 "한 번 더"인지 판단은 여기서 다시 시작한다.
          pannedThisGestureRef.current = false;
        }
      } else {
        flipLockRef.current.hold(now);
      }

      // 트랙패드 pinch-to-zoom (ctrlKey + 연속 deltaY) 또는 Ctrl+wheel → 확대/축소
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = 1 - e.deltaY * 0.01;
        const newScale = Math.max(
          MIN_ZOOM_RATIO,
          Math.min(WHEEL_MAX_ZOOM_RATIO, scaleRef.current * factor),
        );
        dropPendingPageEntry();
        dropPanIntent();
        zoomToRef.current(newScale);
        return;
      }

      // 총 페이지가 1개 이하면 무시
      if (imgUrls.length <= 1) return;

      // 넘긴 페이지의 이미지가 아직 안 그려졌다 — 화면에 없는 페이지를 훑을 수는
      // 없으니 굴린 만큼만 세어 두고 넘김을 "예약"한다. 이 구간(수백 ms)의 스크롤을
      // 버리면 이미지 뜨는 동안 굴린 것이 전부 헛돌아, 한 장 넘기려고 한참 굴려야
      // 한다. 예약은 한 장까지만 — 그래서 한 번에 여러 장이 지나가지 않는다.
      if (!readyImageKeyRef.current) {
        e.preventDefault();
        if (edgeScrollRef.current.push(e.deltaY, now)) {
          queuedFlipRef.current = { dir: Math.sign(e.deltaY), at: now };
        }
        return;
      }

      // 로딩 중에 예약된 넘김이 있으면 이미지가 뜨는 즉시 처리한다. 굴리던 손을
      // 멈춘 뒤의 예약(오래된 것)은 버린다.
      const queued = queuedFlipRef.current;
      queuedFlipRef.current = null;
      const queuedDirection =
        queued && now - queued.at <= EDGE_FLIP_RESET_MS ? queued.dir : 0;

      // 페이지 안을 먼저 훑는다 — 끝에 닿기 전에는 절대 넘기지 않는다.
      if (!queuedDirection && panWithinPage(e.deltaX, e.deltaY)) {
        e.preventDefault();
        dropPendingPageEntry();
        edgeScrollRef.current.reset();
        pannedThisGestureRef.current = true;
        return;
      }

      // 확대 상태로 페이지 끝에 닿았다 — 여기서 바로 넘기면 인용을 읽는 중
      // 관성 스크롤 꼬리에 페이지가 휙 넘어간다. 같은 방향으로 이어서 굴려
      // 문턱을 넘었을 때만 넘긴다.
      const zoomedIn = isPageOverflowing({
        shownWidth: imageSizeRef.current.width * scaleRef.current,
        shownHeight: imageSizeRef.current.height * scaleRef.current,
        canvas: canvasSizeRef.current,
      });
      if (zoomedIn) e.preventDefault();

      // 페이지 안을 훑어 내려오다 끝에 닿았다 — 여기서 한 번 걸린다. 밀던 힘(관성
      // 포함)으로 곧장 넘어가면 페이지 아래쪽을 볼 새가 없다. 손을 떼고 한 번 더
      // 밀면 그때 넘어간다.
      if (zoomedIn && !queuedDirection && pannedThisGestureRef.current) {
        pannedThisGestureRef.current = false;
        flipLockRef.current.lock();
        edgeScrollRef.current.reset();
        return;
      }

      if (!queuedDirection) {
        if (zoomedIn) {
          if (!edgeScrollRef.current.push(e.deltaY, now)) return;
        } else if (Math.abs(e.deltaY) < 10) {
          // 트랙패드 미세 스크롤 필터링 (확대 상태에서는 누적량으로 이미 걸렀다)
          return;
        }
      }

      // 트랙패드라면 이 제스처에서 이미 한 장 넘겼거나 끝에서 걸렸는지 본다 —
      // 관성 꼬리에 여러 장이 지나가면 읽던 자리를 놓친다. 휠 눈금은 굴리는 대로
      // 넘긴다(아래 쓰로틀로만 제한): 눈금 하나하나가 이미 "한 번 더"다.
      if (!wheelNotch && flipLockRef.current.isLocked()) return;
      // 쓰로틀링 중이면 무시
      if (wheelThrottleRef.current) return;

      wheelThrottleRef.current = true;
      flipLockRef.current.lock();
      edgeScrollRef.current.reset();
      dropPanIntent();
      pannedThisGestureRef.current = false;

      const direction = queuedDirection || Math.sign(e.deltaY);
      if (direction > 0) {
        const nextPage = Math.min(currentPageIndex + 1, imgUrls.length - 1);
        if (nextPage !== currentPageIndex) {
          onPageSelect(nextPage);
        }
      } else {
        const prevPage = Math.max(currentPageIndex - 1, 0);
        if (prevPage !== currentPageIndex) {
          onPageSelect(prevPage);
        }
      }

      // 연속 전환 간격 — 휠을 계속 굴릴 때 페이지가 이어서 넘어가되, 한 번에
      // 여러 장이 훅 지나가지는 않을 만큼만 둔다.
      setTimeout(() => {
        wheelThrottleRef.current = false;
      }, PAGE_FLIP_THROTTLE_MS);
    },
    [
      currentPageIndex,
      imgUrls.length,
      onPageSelect,
      panWithinPage,
      dropPendingPageEntry,
      dropPanIntent,
    ],
  );

  // non-passive로 등록하여 preventDefault 동작 보장 (브라우저 기본 zoom 방지)
  useNonPassiveWheel(viewerRef, handleWheel);

  // 이미지 프리로드 + 404일 때 재시도 로직. loading/ready/error 모두 URL을
  // 키로 가지므로 파일·페이지 변경 직후 이전 상태가 한 프레임 노출되지 않는다.
  useEffect(() => {
    // 배치는 이미지가 실제로 그려진 뒤(readyImageKey)에 한 번만 정한다.
    // 여기서 미리 정하면 그 배율이 로드 완료 시점의 배치에 덮인다.

    if (!currentImageUrl) return;

    let isCancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    const tryLoadImage = () => {
      if (isCancelled) return;

      const img = new Image();

      img.onload = () => {
        if (isCancelled) return;
        setImageLoadState({ url: currentImageUrl, status: "ready" });
      };

      img.onerror = () => {
        if (isCancelled) return;

        // ❗ 여기서 바로 에러로 보지 말고 일정 횟수까지 재시도
        if (retryCount < MAX_RETRY) {
          retryCount += 1;
          setImageLoadState({ url: currentImageUrl, status: "retrying" });
          retryTimeout = setTimeout(() => {
            if (!isCancelled) tryLoadImage();
          }, RETRY_DELAY_MS);
        } else {
          setImageLoadState({ url: currentImageUrl, status: "error" });
        }
      };

      img.src = currentImageUrl;
    };

    tryLoadImage();

    return () => {
      isCancelled = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
    // 배치는 위의 준비 완료 effect 가 맡으므로 이미지 URL만 로드 키로 쓴다.
  }, [currentImageUrl]);

  const renderErrorMessage = () => (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-1.5 text-center text-muted-foreground">
        <FrownIcon className="h-6 w-6" />
        <h3 className="text-sm font-normal leading-6">
          {translate("failedToLoadImage")}
        </h3>
        <p>{translate("pleaseTryAgain")}</p>
      </div>
    </div>
  );

  const renderLoadingMessage = () => (
    <div
      className="flex h-full items-center justify-center"
      role="status"
      aria-label={translate("preparingPageImage")}
    >
      <div className="h-5 w-5 animate-spin rounded-full border border-muted-foreground/35 border-t-transparent" />
    </div>
  );

  const currentImageStatus = !currentImageUrl
    ? "error"
    : imageLoadState?.url === currentImageUrl
      ? imageLoadState.status
      : "loading";
  const showError = currentImageStatus === "error";
  const showLoading =
    currentImageStatus === "loading" || currentImageStatus === "retrying";

  return (
    <div
      ref={viewerRef}
      // 캔버스 배경은 루트 한 곳에만 칠한다. 안쪽 캔버스는 투명하고 오버레이는
      // 루트 색을 물려받아, host 가 className 하나로 캔버스 전체를 바꾼다.
      className={cn(
        "relative flex h-full min-h-[400px] flex-col bg-muted",
        allowNarrowLayout ? "min-w-0" : "min-w-[410px]",
        className,
      )}
      data-testid={testId || "image-viewer-section"}
    >
      {/* 본문은 항상 툴바를 제외한 남은 높이만 차지한다. 로딩 화면에 h-full을
          직접 주면 툴바가 컨테이너 아래로 밀려 UI가 사라진 것처럼 보인다. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {showError ? (
          renderErrorMessage()
        ) : showLoading ? (
          renderLoadingMessage()
        ) : (
          <ImageCanvas
            imageUrl={currentImageUrl ?? ""}
            cssTransform={cssTransform}
            onResizeCanvas={canvasSizeChangeHandler}
            onMoveImage={offset => {
              // 드래그로 직접 옮기는 중이라면 인수인계된 배율·정렬은 버린다.
              dropPendingPageEntry();
              dragWithinPage(offset);
            }}
            panEnabled={panEnabled}
            onImageSizeChanged={imageSizeChangeHandler}
            onImageLoaded={() => {
              // 캔버스 내부 이미지가 실제로 로드되면 상태 리셋
              if (currentImageUrl) {
                setImageLoadState({ url: currentImageUrl, status: "ready" });
              }
            }}
            onImageError={() => {
              if (currentImageUrl) {
                setImageLoadState({ url: currentImageUrl, status: "error" });
              }
            }}
            selectedHighlight={selectedHighlight}
            hoveredHighlight={hoveredHighlight}
            highlightColor={highlightColor}
            wordHighlightColor={wordHighlightColor}
            currentPageIndex={currentPageIndex}
            allHighlights={allHighlights}
            onHighlightSelect={onHighlightSelect}
            onHighlightHover={onHighlightHover}
            compactPadding={compactCanvasPadding}
            comparisonMode={comparisonMode}
            highlightSequence={highlightSequence}
            comparisonContent={comparisonContent}
          />
        )}
      </div>

      <ImageViewToolbar
        fileVisible={true}
        imageScale={scale}
        onImageScaleChange={(s: number) => {
          dropPendingPageEntry();
          dropPanIntent();
          zoomTo(s);
        }}
        numberOfPages={imgUrls.length}
        pageIndex={currentPageIndex}
        onPageSelect={onPageSelect}
        onRotate={handleRotateRight}
        onReset={handleReset}
        testId={testId ? `${testId}-toolbar` : undefined}
      />

      {/* Auto-focus loading overlay (Table View용) */}
      {autoFocusOnHighlight && isAutoFocusing && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-inherit"
          data-testid="image-viewer-auto-focus-loading"
        >
          {renderLoadingMessage()}
        </div>
      )}
    </div>
  );
};

/**
 * 문서 뷰어 — 기본은 한 장씩 갈아 끼우는 방식이고, `continuousScroll` 이 켜지면
 * 페이지를 쌓아 이어서 스크롤한다. 두 경로는 훅 구성이 달라 컴포넌트로 분리한다.
 */
const ImageViewerSection: React.FC<ImageViewerSectionProps> = props => {
  const {
    continuousScroll = false,
    comparisonMode = false,
    autoFocusOnHighlight = false,
  } = props;

  if (continuousScroll && !comparisonMode && !autoFocusOnHighlight) {
    return (
      <ContinuousImageViewer
        className={props.className}
        imgUrls={props.imgUrls}
        currentPageIndex={props.currentPageIndex}
        onPageSelect={props.onPageSelect}
        selectedHighlight={props.selectedHighlight}
        hoveredHighlight={props.hoveredHighlight}
        highlightColor={props.highlightColor}
        wordHighlightColor={props.wordHighlightColor}
        allHighlights={props.allHighlights}
        onHighlightSelect={props.onHighlightSelect}
        onHighlightHover={props.onHighlightHover}
        highlightSequence={props.highlightSequence}
        citationFitAxis={props.citationFitAxis}
        t={props.t}
        testId={props.testId}
      />
    );
  }

  return <PagedImageViewerSection {...props} />;
};

export default ImageViewerSection;
