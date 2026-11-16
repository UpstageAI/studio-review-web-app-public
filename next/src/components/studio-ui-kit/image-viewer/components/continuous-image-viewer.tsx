import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { HighlightPolygon } from "./image-canvas/highlight-polygon";
import { highlightRenderKey } from "./image-canvas/highlight-render-key";
import { ImageViewToolbar } from "./tool-bar";
import type { HighlightValueWithId } from "../../shared/types/highlight";
import type { BboxFitAxis } from "../utils/bbox-utils";
import { getBoundingBox, resolveFocusTarget } from "../utils/bbox-utils";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_WORD_HIGHLIGHT_COLOR,
  MAX_ZOOM_RATIO,
  MIN_ZOOM_RATIO,
} from "../constants/image-viewer";
import {
  computeContinuousLayout,
  pageAtViewport,
  pageWidthForFit,
  resolveScale,
  scrollToCenterPoint,
  visiblePageRange,
  zoomKey,
  type ContinuousFitMode,
  type StoredZoom,
} from "../utils/continuous-layout";
import { FrownIcon } from "lucide-react";

export type ContinuousTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface ContinuousImageViewerProps {
  className?: string;
  imgUrls: string[];
  currentPageIndex: number;
  onPageSelect: (index: number) => void;
  selectedHighlight?: HighlightValueWithId | null;
  hoveredHighlight?: HighlightValueWithId | null;
  highlightColor?: string;
  wordHighlightColor?: string;
  allHighlights?: HighlightValueWithId[] | null;
  onHighlightSelect?: (highlight: HighlightValueWithId | null) => void;
  onHighlightHover?: (highlight: HighlightValueWithId | null) => void;
  /** 같은 인용 재선택도 별도의 위치 이동 요청으로 처리한다. */
  highlightSequence?: number;
  /** 선택된 인용을 이 축에 맞춰 확대한다 (null 이면 페이지 전체 보기) */
  citationFitAxis?: BboxFitAxis | null;
  t?: ContinuousTranslate;
  testId?: string;
}

/** 크기를 모르는 페이지의 자리를 잡을 때 쓰는 기본 비율 (A4 세로) */
const DEFAULT_PAGE_ASPECT = 1.414;
/** 보이는 화면의 앞뒤로 이만큼 더 그려 둔다 */
const OVERSCAN_RATIO = 1;
const MAX_RETRY = 3;
const RETRY_DELAY_MS = 1000;

type PageStatus = "loading" | "ready" | "error";
type PageSize = { width: number; height: number };

const pageSourceKey = (index: number, src: string) => `${index}\u0000${src}`;

/**
 * 페이지 이미지의 재시도 예약. 페이지 이미지는 업로드 직후 잠깐 404 가 날 수
 * 있어 몇 번 더 시도한다.
 *
 * 시도 횟수와 대기 타이머는 화면에 쓰이지 않아 이 훅의 ref 에만 둔다. 화면은
 * 다시 마운트할 img 를 가리키는 `retryVersions` 만 본다.
 */
function usePageImageRetry(documentKey: string) {
  const [retryVersions, setRetryVersions] = useState<Record<string, number>>(
    {},
  );
  const retryCountRef = useRef<Record<string, number>>({});
  const retryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  useEffect(() => {
    // 문서를 바꾸거나 뷰어를 닫으면 이전 URL의 재시도가 새 문서 렌더에 끼어들지
    // 않게 모두 취소한다. 상태 자체도 URL 키라 이미 예약된 state 갱신은 무해하다.
    return () => {
      Object.values(retryTimersRef.current).forEach(clearTimeout);
      retryTimersRef.current = {};
      retryCountRef.current = {};
    };
  }, [documentKey]);

  /** 로드에 성공한 이미지의 대기 중인 재시도와 시도 횟수를 지운다. */
  const settleRetry = useCallback((sourceKey: string) => {
    const pending = retryTimersRef.current[sourceKey];
    if (pending) {
      clearTimeout(pending);
      delete retryTimersRef.current[sourceKey];
    }
    delete retryCountRef.current[sourceKey];
  }, []);

  /** 재시도를 예약한다. 횟수를 다 썼으면 예약하지 않고 false 를 돌려준다. */
  const scheduleRetry = useCallback((sourceKey: string) => {
    const tried = retryCountRef.current[sourceKey] ?? 0;
    if (tried >= MAX_RETRY) return false;
    retryCountRef.current[sourceKey] = tried + 1;
    const pending = retryTimersRef.current[sourceKey];
    if (pending) clearTimeout(pending);
    retryTimersRef.current[sourceKey] = setTimeout(() => {
      delete retryTimersRef.current[sourceKey];
      // DOM 전역 검색으로 src를 직접 덮어쓰면 같은 페이지 번호를 가진 다른 문서나
      // 다른 뷰어를 오염시킨다. 이 URL의 img만 key로 다시 마운트한다.
      setRetryVersions(prev => ({
        ...prev,
        [sourceKey]: (prev[sourceKey] ?? 0) + 1,
      }));
    }, RETRY_DELAY_MS);
    return true;
  }, []);

  return { retryVersions, settleRetry, scheduleRetry };
}

/**
 * 페이지를 세로로 쌓아 이어서 스크롤하는 문서 뷰어.
 *
 * 한 장씩 갈아 끼우던 방식에서는 "페이지 끝에서 얼마나 더 굴려야 다음 장인가"를
 * 우리가 정해야 했는데, 트랙패드 관성·이미지 로딩과 얽혀 규칙이 계속 어긋났다
 * (한 번에 여러 장이 넘어가거나, 끝에 닿아도 안 넘어가거나). 쌓아 두면 그 판단이
 * 사라진다 — 스크롤은 브라우저가 맡고, 현재 페이지 번호는 화면에 무엇이 보이는지에서
 * 역산한다.
 */
export const ContinuousImageViewer: React.FC<ContinuousImageViewerProps> = ({
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
  highlightSequence = 0,
  citationFitAxis = null,
  t,
  testId,
}) => {
  const documentKey = useMemo(() => imgUrls.join("\u0000"), [imgUrls]);
  const translate = useCallback(
    (key: string) => {
      if (t) return t(key);
      const defaults: Record<string, string> = {
        failedToLoadImage: "Failed to load image",
        pleaseTryAgain: "Please try again or refresh.",
        preparingPageImage: "Preparing page image...",
      };
      return defaults[key] || key;
    },
    [t],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * 스크롤 영역의 크기. 관측을 놓치면 폭이 0 으로 굳어 아무것도 그려지지 않으므로,
   * 붙는 즉시 한 번 재고 그 뒤 변화는 ResizeObserver 로 따라간다.
   */
  const [container, setContainer] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // 정수로 끊는다. 레이아웃 중 서브픽셀이 오르내리면 그때마다 배율이 미세하게
      // 다시 계산돼(크기 비율로 배율을 지키므로) 화면이 떨린다.
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setContainer(prev =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 페이지별 원본 크기와 로딩 상태 — 이미지가 그려질 때 채워진다.
  // 인덱스만 키로 쓰면 문서를 바꾼 직후 이전 문서의 ready/크기가 새 문서에 샌다.
  // URL까지 묶어 같은 페이지 번호라도 서로 다른 이미지 상태로 취급한다.
  const [naturalSizes, setNaturalSizes] = useState<Record<string, PageSize>>(
    {},
  );
  const [statuses, setStatuses] = useState<Record<string, PageStatus>>({});
  const { retryVersions, settleRetry, scheduleRetry } =
    usePageImageRetry(documentKey);

  const [scrollTop, setScrollTop] = useState(0);

  /**
   * 배율 계산의 기준 크기 — 처음 그려진 페이지의 원본 크기로 고정한다.
   *
   * "현재 페이지"를 기준으로 삼으면, 확대하는 동안 페이지 높이가 바뀌며 현재
   * 페이지가 바뀌고, 그때 기준이 흔들려 사용자 배율이 버려진다(fit 으로 튕겼다
   * 다시 확대되는 왕복 — 화면이 떨린다).
   */
  const [baseSizeEntry, setBaseSizeEntry] = useState<{
    documentKey: string;
    size: PageSize;
  } | null>(null);
  const baseSize =
    baseSizeEntry?.documentKey === documentKey ? baseSizeEntry.size : null;

  /** 선택된 인용의 bbox (이미지 좌표) */
  const citationBbox = useMemo(() => {
    if (!selectedHighlight) return null;
    const pageIndex = selectedHighlight.page - 1;
    const src = imgUrls[pageIndex];
    const size =
      (src ? naturalSizes[pageSourceKey(pageIndex, src)] : null) ?? baseSize;
    if (!size) return null;
    const focusTarget = resolveFocusTarget(selectedHighlight);
    if (!focusTarget) return null;
    return getBoundingBox(
      focusTarget.coordinates,
      size,
      focusTarget.isRatioCoordinates,
    );
  }, [selectedHighlight, imgUrls, naturalSizes, baseSize]);

  const fitMode: ContinuousFitMode = citationFitAxis ?? "pageWidth";

  /**
   * 사용자가 직접 정한 배율. 인용·보기 방식·창 크기가 바뀌면 그 조합에 맞는 기본
   * 배율로 돌아가야 하므로, 어떤 조합에서 정한 값인지 함께 들고 있는다.
   */
  /**
   * 배율을 어디까지 이어 쓸지 가리는 조합 키. 인용 맞춤일 때만 인용을 구분한다 —
   * 줌 고정에서는 인용을 옮겨 다녀도 배율을 건드리지 않는다.
   */
  const fitKey = zoomKey(fitMode, selectedHighlight?.id);
  const [zoom, setZoom] = useState<StoredZoom | null>(null);

  const fitScale = useMemo(() => {
    if (!baseSize) return 0;
    const width = pageWidthForFit({
      mode: fitMode,
      container,
      imageSize: baseSize,
      bbox: citationBbox,
      minScale: MIN_ZOOM_RATIO,
      maxScale: MAX_ZOOM_RATIO,
    });
    return width / baseSize.width;
  }, [fitMode, container, baseSize, citationBbox]);

  const scale = resolveScale({
    citationFitActive: Boolean(citationFitAxis),
    stored: zoom,
    key: fitKey,
    fitScale,
    containerWidth: container.width,
  });

  // 원본 크기를 아직 모르면 폭을 컨테이너에 맞춰 둔다. 0 으로 두면 페이지 높이가
  // 전부 1px 이 되어 44쪽이 한꺼번에 그려진다.
  const pageWidth = baseSize ? scale * baseSize.width : container.width;

  /**
   * 인용 맞춤으로 정해진 배율을 상태에도 남긴다. 줌 고정으로 바꿀 때 "고정할 배율"은
   * 화면에 적용돼 있는 배율인데, 인용 맞춤 배율은 계산으로만 나오므로 남겨 두지
   * 않으면 물려받을 값이 없어 기본 너비로 튕긴다.
   *
   * 조합(메뉴 선택·인용 클릭)이 바뀐 렌더에서 바로 남긴다. 남긴 뒤에는 키가 같아
   * 다시 들어오지 않는다. 화면 배율은 남기기 전후로 같다(위 resolveScale 참고).
   */
  if (
    citationFitAxis &&
    fitScale > 0 &&
    container.width > 0 &&
    zoom?.key !== fitKey
  ) {
    setZoom({ key: fitKey, scale: fitScale, containerWidth: container.width });
  }

  const aspects = useMemo(
    () =>
      imgUrls.map((_, index) => {
        const size = naturalSizes[pageSourceKey(index, imgUrls[index])];
        return size && size.width > 0 ? size.height / size.width : null;
      }),
    [imgUrls, naturalSizes],
  );

  const defaultAspect = useMemo(() => {
    const known = aspects.find(a => a !== null);
    return known ?? DEFAULT_PAGE_ASPECT;
  }, [aspects]);

  const layout = useMemo(
    () =>
      computeContinuousLayout({
        count: imgUrls.length,
        pageWidth,
        aspects,
        defaultAspect,
      }),
    [imgUrls.length, pageWidth, aspects, defaultAspect],
  );

  const visible = useMemo(
    () =>
      visiblePageRange(
        layout,
        scrollTop,
        container.height,
        container.height * OVERSCAN_RATIO,
      ),
    [layout, scrollTop, container.height],
  );

  const derivedPage = useMemo(
    () => pageAtViewport(layout, scrollTop, container.height),
    [layout, scrollTop, container.height],
  );
  const derivedPageRef = useRef(derivedPage);

  const stackWidth = Math.max(pageWidth, container.width);
  const stackOffsetX = Math.max(0, (stackWidth - pageWidth) / 2);

  // 최신 값을 핸들러·effect 에서 읽기 위해 ref 로 모은다 (렌더 중 대입 금지).
  const layoutRef = useRef(layout);
  const containerRef = useRef(container);
  const scaleRef = useRef(scale);
  const pageWidthRef = useRef(pageWidth);
  const stackOffsetXRef = useRef(stackOffsetX);
  const onPageSelectRef = useRef(onPageSelect);
  const fitKeyRef = useRef(fitKey);
  useEffect(() => {
    layoutRef.current = layout;
    containerRef.current = container;
    scaleRef.current = scale;
    pageWidthRef.current = pageWidth;
    stackOffsetXRef.current = stackOffsetX;
    derivedPageRef.current = derivedPage;
    onPageSelectRef.current = onPageSelect;
    fitKeyRef.current = fitKey;
  });

  /**
   * 스크롤 위치를 상태로 들고 있는 이유는 두 가지뿐이다 — 어느 페이지를 그릴지,
   * 그리고 툴바에 몇 쪽이라고 쓸지. 계산은 메모된 자리표에서 44번 비교하는 정도라
   * 이벤트마다 바로 갱신해도 충분하다(프레임으로 미루면 표시가 한 박자 늦는다).
   */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);

    const page = pageAtViewport(
      layoutRef.current,
      el.scrollTop,
      containerRef.current.height,
    );
    if (page !== derivedPageRef.current) {
      derivedPageRef.current = page;
      onPageSelectRef.current(page);
    }
  }, []);

  /**
   * 밖에서 페이지를 바꿨을 때(툴바·인용 클릭) 그 페이지로 옮긴다. 스크롤로 바뀐
   * 경우(derivedPage 와 같음)에는 건드리지 않는다 — 건드리면 읽던 위치가 페이지
   * 맨 위로 튄다.
   */
  const pendingScrollRef = useRef<number | null>(null);
  const navigationRequestRef = useRef({ documentKey, highlightSequence });
  useEffect(() => {
    const previous = navigationRequestRef.current;
    const requestedAgain =
      previous.documentKey !== documentKey ||
      previous.highlightSequence !== highlightSequence;
    navigationRequestRef.current = { documentKey, highlightSequence };
    if (currentPageIndex === derivedPageRef.current && !requestedAgain) return;
    pendingScrollRef.current = currentPageIndex;
  }, [currentPageIndex, documentKey, highlightSequence]);

  /**
   * 요청된 이동은 자리를 알게 된 뒤에 적용한다. 첫 렌더에는 컨테이너 크기도
   * 페이지 크기도 몰라 모든 페이지의 위치가 0 이다 — 그때 옮기면 아무 데도 못 가고
   * 다시 시도하지도 않는다(인용을 눌러 뷰어를 열었는데 1쪽이 보이는 증상).
   */
  useEffect(() => {
    const el = scrollRef.current;
    const target = pendingScrollRef.current;
    if (!el || target === null) return;
    if (container.height <= 0 || pageWidth <= 0) return;
    const top = layout.offsets[target];
    if (top === undefined) return;
    pendingScrollRef.current = null;
    derivedPageRef.current = target;
    el.scrollTo({ top, behavior: "auto" });
  }, [
    currentPageIndex,
    documentKey,
    highlightSequence,
    layout,
    container.height,
    pageWidth,
  ]);

  /**
   * 인용을 고르거나 보기 방식을 바꾸면 그 인용이 화면 가운데 오도록 옮긴다.
   * 같은 조합에 두 번 개입하지 않는다 — 그 뒤의 스크롤·확대는 사용자 몫이다.
   */
  const appliedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!selectedHighlight) {
      appliedFocusRef.current = null;
      return;
    }
    if (!citationBbox) return;
    if (pageWidth <= 0 || container.height <= 0) return;

    const pageIndex = selectedHighlight.page - 1;
    const pageTop = layout.offsets[pageIndex];
    if (pageTop === undefined) return;

    // 그 페이지가 아직 안 그려졌어도 옮긴다. 그려지길 기다리면 영영 못 간다 —
    // 화면 밖 페이지는 그리지 않으므로(가상화), 옮겨야 그려진다. 자리는 기본
    // 비율로 어림잡고, 실제 크기를 알게 되면 그때 한 번 더 맞춘다.
    const pageSrc = imgUrls[pageIndex];
    const natural = pageSrc
      ? naturalSizes[pageSourceKey(pageIndex, pageSrc)]
      : null;
    // 줌 유지 키는 인용을 구분하지 않는다. 이동은 별도로 인용 위치와 요청
    // 시퀀스를 구분해야 다른 인용/재클릭을 무시하지 않고, 일반 재렌더는
    // 사용자가 직접 스크롤한 위치를 빼앗지 않는다.
    const key = JSON.stringify([
      documentKey,
      selectedHighlight.id,
      selectedHighlight.page,
      highlightSequence,
      citationBbox.centerX,
      citationBbox.centerY,
      pageTop,
      fitKey,
      Math.round(scale * 1000),
      natural ? "sized" : "estimated",
    ]);
    if (appliedFocusRef.current === key) return;
    appliedFocusRef.current = key;

    const target = scrollToCenterPoint({
      pageTop,
      scale,
      point: { x: citationBbox.centerX, y: citationBbox.centerY },
      container,
      stackOffsetX,
    });
    derivedPageRef.current = pageIndex;
    el.scrollTo({ top: target.top, left: target.left, behavior: "auto" });
  }, [
    selectedHighlight,
    documentKey,
    highlightSequence,
    citationBbox,
    fitKey,
    layout,
    imgUrls,
    naturalSizes,
    pageWidth,
    scale,
    container,
    stackOffsetX,
  ]);

  /**
   * 확대/축소 뒤 화면을 붙잡아 둘 지점. 배율이 바뀌면 스택 전체가 늘어나므로 그
   * 비율만큼 스크롤도 옮겨야 잡고 있던 곳이 제자리에 남는다.
   *
   * 이 보정을 requestAnimationFrame 으로 미루면 보정 전 한 프레임이 먼저 그려져
   * 화면이 튄다(연속 확대에서는 떨림으로 보인다) — 그래서 paint 전에 처리한다.
   */
  const zoomAnchorRef = useRef<{
    ratio: number;
    anchorX: number;
    anchorY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    zoomAnchorRef.current = null;
    el.scrollTop = anchor.anchorY * anchor.ratio - anchor.offsetY;
    el.scrollLeft = anchor.anchorX * anchor.ratio - anchor.offsetX;
  }, [pageWidth]);

  /**
   * 아직 화면에 반영되지 않은 목표 배율. 핀치·휠 확대는 한 번에 여러 이벤트가
   * 몰리는데, 그때마다 화면에 반영된 배율에서 다시 계산하면 같은 값에서 맴돌다
   * 늦게 따라붙어 떨린다.
   */
  const pendingScaleRef = useRef<number | null>(null);

  /** 화면의 한 지점을 붙잡은 채 배율을 바꾼다 (Ctrl/⌘+휠, 트랙패드 핀치, 툴바) */
  const zoomTo = useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const current = pendingScaleRef.current ?? scaleRef.current;
      if (current <= 0) return;

      const clamped = Math.min(
        Math.max(nextScale, MIN_ZOOM_RATIO),
        MAX_ZOOM_RATIO,
      );
      if (clamped === current) return;

      const rect = el.getBoundingClientRect();
      // 지점을 주지 않으면 화면 가운데를 붙잡는다 (툴바 +/- 와 슬라이더).
      const offsetX =
        clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const offsetY =
        clientY === undefined ? rect.height / 2 : clientY - rect.top;

      pendingScaleRef.current = clamped;
      zoomAnchorRef.current = {
        ratio: clamped / current,
        anchorX: offsetX + el.scrollLeft,
        anchorY: offsetY + el.scrollTop,
        offsetX,
        offsetY,
      };
      setZoom({
        key: fitKeyRef.current,
        scale: clamped,
        containerWidth: rect.width,
      });
    },
    // setZoom 은 안정적이지만, React Compiler 가 추론한 의존성과 맞춰 둔다.
    [setZoom],
  );

  // 목표 배율이 화면에 반영되면 비운다 — 그 뒤의 확대는 반영된 값에서 출발한다.
  useEffect(() => {
    if (pendingScaleRef.current === scale) pendingScaleRef.current = null;
  });

  // 브라우저 기본 확대를 막으려면 non-passive 로 붙여야 한다. 일반 스크롤은
  // 건드리지 않는다 — 그게 이 뷰어의 요점이다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const base = pendingScaleRef.current ?? scaleRef.current;
      zoomTo(base * (1 - e.deltaY * 0.01), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const handleImageLoad = useCallback(
    (index: number, src: string, img: HTMLImageElement) => {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      const sourceKey = pageSourceKey(index, src);
      if (size.width > 0 && size.height > 0) {
        setBaseSizeEntry(prev =>
          prev?.documentKey === documentKey ? prev : { documentKey, size },
        );
        setNaturalSizes(prev =>
          prev[sourceKey]?.width === size.width &&
          prev[sourceKey]?.height === size.height
            ? prev
            : { ...prev, [sourceKey]: size },
        );
      }
      setStatuses(prev =>
        prev[sourceKey] === "ready" ? prev : { ...prev, [sourceKey]: "ready" },
      );
      settleRetry(sourceKey);
    },
    [documentKey, settleRetry],
  );

  const handleImageError = useCallback(
    (index: number, src: string) => {
      const sourceKey = pageSourceKey(index, src);
      const status: PageStatus = scheduleRetry(sourceKey) ? "loading" : "error";
      setStatuses(prev => ({ ...prev, [sourceKey]: status }));
    },
    [scheduleRetry],
  );

  const highlightsForPage = useCallback(
    (index: number) => {
      if (allHighlights && allHighlights.length > 0) {
        return allHighlights.filter(h => h.page === index + 1);
      }
      return [];
    },
    [allHighlights],
  );

  // 그릴 페이지 번호 — JSX 안에서 반복문 변수를 다루지 않도록 먼저 만들어 둔다.
  const pageIndexes = useMemo(() => {
    const list: number[] = [];
    for (let i = visible.start; i <= visible.end; i += 1) list.push(i);
    return list;
  }, [visible.start, visible.end]);

  const pages = pageIndexes.map(index => {
    const url = imgUrls[index];
    if (!url) return null;
    const top = layout.offsets[index];
    const pageHeight = layout.heights[index];
    const sourceKey = pageSourceKey(index, url);
    const natural = naturalSizes[sourceKey];
    const status = statuses[sourceKey] ?? "loading";
    const retryVersion = retryVersions[sourceKey] ?? 0;
    const pageHighlights = highlightsForPage(index);

    return (
      <div
        key={sourceKey}
        className="absolute bg-background shadow-xs"
        style={{
          top,
          left: stackOffsetX,
          width: pageWidth,
          height: pageHeight,
        }}
        data-testid={`continuous-page-${index}`}
      >
        {status === "error" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-center text-muted-foreground">
            <FrownIcon className="h-6 w-6" />
            <p>{translate("failedToLoadImage")}</p>
          </div>
        ) : null}

        {/* 서명된 CDN URL 이고 크기도 페이지마다 달라 이미지 최적화 컴포넌트를
            쓰지 않는다. Core 는 프레임워크 전용 lint 규칙을 끄는 주석을 두지
            않는다(Next 소비자에서는 경고로만 보인다). */}
        <img
          key={`${sourceKey}:${retryVersion}`}
          src={url}
          alt=""
          data-continuous-page={index}
          draggable={false}
          // 화면에 다가온 페이지만 받아 오고(가상화가 이미 걸러 주지만 스크롤이
          // 빠를 때의 낭비를 한 번 더 줄인다), 디코딩은 스크롤을 막지 않게 비동기로.
          loading="lazy"
          decoding="async"
          fetchPriority={index === currentPageIndex ? "high" : "low"}
          onLoad={e => handleImageLoad(index, url, e.currentTarget)}
          onError={() => handleImageError(index, url)}
          className="h-full w-full select-none"
          style={{ opacity: status === "ready" ? 1 : 0 }}
        />

        {natural && (
          <svg
            viewBox={`0 0 ${natural.width} ${natural.height}`}
            width={pageWidth}
            height={pageHeight}
            className="absolute inset-0"
          >
            {pageHighlights.map((highlight, highlightIndex) => (
              <HighlightPolygon
                // 같은 element id 를 여러 bbox 에 재사용해도 키가 겹치지 않는다.
                // 연속 뷰어의 시퀀스는 위치 이동용이므로 도형을 재마운트하지 않는다.
                key={highlightRenderKey(
                  highlight,
                  highlightIndex,
                  selectedHighlight?.id === highlight.id,
                  0,
                )}
                highlight={highlight}
                isSelected={
                  selectedHighlight
                    ? selectedHighlight.id === highlight.id
                    : true
                }
                isHovered={hoveredHighlight?.id === highlight.id}
                highlightColor={highlightColor}
                wordHighlightColor={wordHighlightColor}
                currentPageIndex={index}
                actualImageSize={natural}
                onHover={onHighlightHover}
                onClick={onHighlightSelect}
              />
            ))}
            {pageHighlights.length === 0 &&
              selectedHighlight?.page === index + 1 && (
                <HighlightPolygon
                  highlight={selectedHighlight}
                  isSelected={true}
                  isHovered={false}
                  highlightColor={highlightColor}
                  wordHighlightColor={wordHighlightColor}
                  currentPageIndex={index}
                  actualImageSize={natural}
                  onHover={onHighlightHover}
                  onClick={onHighlightSelect}
                />
              )}
          </svg>
        )}
      </div>
    );
  });

  return (
    <div
      className={cn(
        "relative flex h-full min-h-[200px] flex-col bg-muted",
        className,
      )}
      data-testid={testId || "continuous-image-viewer"}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        // padding 은 두지 않는다 — 스크롤 좌표와 스택 좌표가 그만큼 어긋나
        // 인용으로 옮길 위치가 밀린다. 페이지 사이 여백은 PAGE_GAP 이 맡는다.
        // overflow-anchor:none — 확대하면 위쪽 내용의 크기가 바뀌는데, 브라우저의
        // 스크롤 앵커링이 그때 스크롤을 자기 나름대로 보정한다. 우리가 붙잡아 둔
        // 지점 보정과 겹치면 두 번 움직여 떨린다.
        className="min-h-0 flex-1 overflow-auto overscroll-contain [overflow-anchor:none]"
        data-testid={
          testId ? `${testId}-scroll` : "continuous-image-viewer-scroll"
        }
      >
        <div
          className="relative"
          style={{
            width: stackWidth,
            height: layout.totalHeight || container.height,
          }}
        >
          {pages}
        </div>
      </div>

      <ImageViewToolbar
        fileVisible={true}
        imageScale={scale}
        onImageScaleChange={next => zoomTo(next)}
        numberOfPages={imgUrls.length}
        pageIndex={derivedPage}
        onPageSelect={onPageSelect}
        onReset={() => setZoom(null)}
        testId={testId ? `${testId}-toolbar` : undefined}
      />
    </div>
  );
};

export default ContinuousImageViewer;
