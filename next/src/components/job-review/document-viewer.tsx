"use client";

import { GalleryVerticalEndIcon, RectangleVerticalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  ImageViewerSection,
  type HighlightValueWithId,
  type TranslateFunction,
} from "@/components/studio-ui-kit/image-viewer";
import type { HighlightLike } from "@/lib/review-model";
import { cn } from "@/lib/utils";
import { markPageImagePainted } from "./perf-marks";
import { SegmentedIcons } from "./segmented-icons";
import { syncHorizontalOverflow } from "./viewer-horizontal-overflow";
import {
  resyncViewerScroll,
  VIEWER_TESTID,
  viewerScrollSelector,
} from "./viewer-scroll-sync";

const VIEWER_KEYS = [
  "failedToLoadImage",
  "pleaseTryAgain",
  "preparingPageImage",
] as const;

type ViewerKey = (typeof VIEWER_KEYS)[number];

function isViewerKey(key: string): key is ViewerKey {
  return (VIEWER_KEYS as readonly string[]).includes(key);
}

/**
 * 아무것도 고르지 않았을 때 뷰어에 넘기는 "그려지지 않는 선택". image-viewer 는 `selectedHighlight`
 * 가 없으면 `allHighlights` 전부를 선택 모양으로 그린다(Parse 미리보기용 동작). 이 화면은 값·요소·
 * 인용을 가리키거나 고를 때만 영역을 그리므로, 선택이 없을 때 이 자리표시를 넘겨 나머지 영역을
 * 보이지 않게 한다(뷰어 안에서 영역을 가리키면 그 영역은 보인다). 페이지 0·좌표 없음이라 그려지지
 * 않고, 자동 포커스·인용 맞춤은 꺼져 있어 다른 동작에 영향이 없다.
 */
const NO_SELECTION: HighlightValueWithId = {
  id: "\u0000none",
  _value: "",
  page: 0,
  coordinates: [],
};

/** `lg`(64rem) 이상인지. 뷰어는 클라이언트에서만 그려지므로 서버 값은 쓰지 않는다. */
const WIDE_QUERY = "(min-width: 64rem)";

function subscribeWide(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const CONTINUOUS_PAGE_TESTID = /^continuous-page-(\d+)$/;

/**
 * 뷰어 안 페이지 이미지가 로드되면 다음 프레임(그려진 뒤)에 `review:page-image-painted` 마크를
 * 남긴다. 뷰어 item 은 이미지 로드 콜백을 내주지 않으므로 래퍼에서 capture 단계 `load` 를 듣는다
 * (`load` 는 bubble 하지 않지만 capture 는 된다). 연속 스크롤은 페이지 칸의 testid 로, 한 장씩은
 * 지금 페이지로 번호를 정한다.
 */
function usePageImagePaintedMarks(currentPageIndex: number) {
  const rootRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(currentPageIndex);
  useEffect(() => {
    currentRef.current = currentPageIndex;
  }, [currentPageIndex]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const frames = new Set<number>();
    const onLoad = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLImageElement) &&
        !(target instanceof SVGImageElement)
      ) {
        return;
      }
      let page: number | null = null;
      const cell = target.closest('[data-testid^="continuous-page-"]');
      const match = CONTINUOUS_PAGE_TESTID.exec(
        cell?.getAttribute("data-testid") ?? "",
      );
      if (match) page = Number(match[1]) + 1;
      else if (target.closest('[data-testid="image-canvas"]'))
        page = currentRef.current + 1;
      if (page === null) return;
      const painted = page;
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        markPageImagePainted(painted);
      });
      frames.add(frame);
    };
    root.addEventListener("load", onLoad, true);
    return () => {
      root.removeEventListener("load", onLoad, true);
      for (const frame of frames) cancelAnimationFrame(frame);
      frames.clear();
    };
  }, []);

  return rootRef;
}

function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

export interface DocumentViewerProps {
  /** 현재 문서의 페이지 이미지 URL(뷰어 순서). 아직 없는 페이지는 빈 문자열. */
  imgUrls: string[];
  currentPageIndex: number;
  onPageSelect: (index: number) => void;
  /** 그릴 하이라이트 전체. `page` 는 뷰어 페이지(1-based). */
  highlights: HighlightLike[];
  selectedHighlightId: string | null;
  hoveredHighlightId: string | null;
  onHighlightSelect: (id: string | null) => void;
  onHighlightHover: (id: string | null) => void;
  /** 하이라이트에 `color` 가 없을 때 쓰는 CSS 색. */
  highlightColor?: string;
  /** 페이지를 세로로 이어 스크롤하는 모드(보이는 페이지만 그린다). 끄면 한 장씩. */
  continuous?: boolean;
  /** 있으면 아래 툴바 쪽 번호 옆에 보기 방식(한 장씩, 이어서 스크롤) 토글을 그린다. */
  onContinuousChange?: (continuous: boolean) => void;
  /**
   * 한 장씩 보기에서 지금 페이지 이미지를 읽지 못했을 때(만료된 서명 URL 등). 이 모드의 뷰어는 이미지를
   * 화면 밖에서 미리 읽어 DOM `error` 가 오지 않으므로 래퍼가 같은 URL 을 한 번 더 읽어 보고 알린다.
   */
  onImageError?: (url: string) => void;
}

/**
 * Studio UI Kit image-viewer 를 이 화면의 상태에 묶는 래퍼. 페이지·선택·호버는 화면이
 * 가진 상태이고, 뷰어는 사용자 조작을 id 로 알린다. 영역은 고르거나 가리킨 것만 그린다
 * (`NO_SELECTION`). 상태 문구는 next-intl 로 번역한다.
 */
export function DocumentViewer({
  imgUrls,
  currentPageIndex,
  onPageSelect,
  highlights,
  selectedHighlightId,
  hoveredHighlightId,
  onHighlightSelect,
  onHighlightHover,
  highlightColor = "var(--primary)",
  continuous = false,
  onContinuousChange,
  onImageError,
}: DocumentViewerProps) {
  const t = useTranslations("review.viewer");
  const translate = useCallback<TranslateFunction>(
    key => (isViewerKey(key) ? t(key) : key),
    [t],
  );
  const wide = useIsWide();
  const rootRef = usePageImagePaintedMarks(currentPageIndex);

  // 연속 스크롤 뷰어는 scroll 이벤트가 올 때만 위치 상태를 갱신해, 프로그램 이동 직후 다음 이동이
  // 오면 옛 위치 기준으로 요청을 버린다(▶ 직후 ◀ 가 앞 쪽에 머무는 원인). 페이지·문서가 바뀐 commit
  // 마다 스크롤 요소에 scroll 이벤트를 한 번 보내 지금 위치로 맞춘다. 같은 commit 에서 자식(뷰어)의
  // effect 가 먼저 돌아 scrollTo 를 마친 뒤 실행돼야 하므로 useLayoutEffect 가 아닌 useEffect 여야 한다.
  useEffect(() => {
    if (!continuous) return;
    resyncViewerScroll(rootRef.current, VIEWER_TESTID);
  }, [continuous, currentPageIndex, imgUrls, rootRef]);

  // 페이지 폭 맞춤이 세로 스크롤바 폭만큼 넘쳐 생기는 가로 스크롤을 숨긴다(viewer-horizontal-overflow).
  // 스크롤 요소와 페이지 스택의 크기가 바뀔 때(창 크기·확대·문서 변경)마다 다시 판단한다.
  useEffect(() => {
    if (!continuous) return;
    const scroller = rootRef.current?.querySelector<HTMLElement>(
      viewerScrollSelector(VIEWER_TESTID),
    );
    if (!scroller) return;
    const update = () => syncHorizontalOverflow(scroller);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild)
      observer.observe(scroller.firstElementChild);
    return () => {
      observer.disconnect();
      scroller.style.overflowX = "";
    };
  }, [continuous, imgUrls, rootRef]);

  // 한 장씩 보기의 지금 페이지 이미지를 같은 URL 로 한 번 더 읽어 실패를 알아챈다. 뷰어가 이미 읽는
  // URL 이라 브라우저가 같은 요청을 함께 쓴다(내려받기가 늘지 않는다). 연속 스크롤은 `<img>` 라 DOM
  // `error` 로 알 수 있어 여기서 보지 않는다.
  const currentUrl = continuous ? "" : (imgUrls[currentPageIndex] ?? "");
  useEffect(() => {
    if (!currentUrl || !onImageError) return;
    const probe = new Image();
    probe.onerror = () => onImageError(currentUrl);
    probe.src = currentUrl;
    return () => {
      probe.onerror = null;
    };
  }, [currentUrl, onImageError]);

  const all: HighlightValueWithId[] = highlights;
  const selected = useMemo(
    () => all.find(item => item.id === selectedHighlightId) ?? null,
    [all, selectedHighlightId],
  );
  const hovered = useMemo(
    () => all.find(item => item.id === hoveredHighlightId) ?? null,
    [all, hoveredHighlightId],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative h-full min-w-0",
        // 보기 방식 토글 자리: 아래 툴바(`job-review-viewer-toolbar`, `VIEWER_TESTID` 기준)의 오른쪽 안쪽
        // 여백을 토글 폭(62px)과 사이 간격만큼 늘려 쪽 번호 묶음이 토글과 겹치지 않게 한다.
        onContinuousChange &&
          "[&_[data-testid=job-review-viewer-toolbar]]:pr-19",
      )}
    >
      <ImageViewerSection
        imgUrls={imgUrls}
        currentPageIndex={currentPageIndex}
        onPageSelect={onPageSelect}
        allHighlights={all}
        selectedHighlight={selected ?? NO_SELECTION}
        hoveredHighlight={hovered}
        onHighlightSelect={highlight =>
          onHighlightSelect(highlight?.id ?? null)
        }
        onHighlightHover={highlight => onHighlightHover(highlight?.id ?? null)}
        highlightColor={highlightColor}
        allowNarrowLayout={!wide}
        continuousScroll={continuous}
        t={translate}
        testId={VIEWER_TESTID}
      />
      {onContinuousChange ? (
        // 뷰어 item 의 툴바는 끼울 자리를 내주지 않으므로 같은 높이(52px, 위 테두리 1px)의 줄을 툴바
        // 오른쪽 끝에 겹쳐 쪽 번호 바로 옆에 둔다. 래퍼 상태라 모드를 바꿔도(뷰어가 다시 그려져도)
        // 포커스가 남는다.
        <div className="absolute right-2 bottom-0 flex h-[52px] items-center pt-px">
          <SegmentedIcons
            variant="bar"
            tooltipSide="top"
            label={t("viewMode")}
            value={continuous ? "continuous" : "paged"}
            onChange={mode => onContinuousChange(mode === "continuous")}
            options={[
              {
                value: "paged",
                label: t("paged"),
                icon: RectangleVerticalIcon,
                testId: "job-review-viewer-button-mode-paged",
              },
              {
                value: "continuous",
                label: t("continuous"),
                icon: GalleryVerticalEndIcon,
                testId: "job-review-viewer-button-mode-continuous",
              },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
