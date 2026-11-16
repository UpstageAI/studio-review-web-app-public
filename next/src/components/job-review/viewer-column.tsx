"use client";

import { GalleryHorizontalEndIcon, LayoutGridIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useId, useMemo, type KeyboardEvent } from "react";
import { ListNotice } from "@/components/collections/list-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  VIEWER_KEYSHORTCUTS,
  isEditableTarget,
  neighborDocument,
  viewerKeyCommand,
} from "./document-navigation";
import { useFilmstripOpen } from "./filmstrip-open-context";
import { useJobReview } from "./job-review-context";
import { fileProgress } from "./job-review-state";
import { useOrganizer } from "./organizer-context";
import { showsFilmstripBand } from "./organizer-view";
import { PAGE_TABS_MAX } from "./large-job";
import { PageBand } from "./page-band";
import { markSelectPage } from "./perf-marks";
import { StructureToolbar } from "./structure-toolbar";
import { useFieldFilteredHighlights } from "./use-field-filter";
import { useImageRefresh } from "./use-image-refresh";
import { useViewerMode } from "./use-viewer-mode";
import { useVisibleDocuments } from "./use-visible-documents";
import { useReviewPolicy } from "./review-policy-context";

// 뷰어 item 과 그 의존성(react-aria 등)은 이 화면에서만 쓰므로 따로 받는다.
const DocumentViewer = dynamic(
  () => import("./document-viewer").then(mod => mod.DocumentViewer),
  { ssr: false, loading: () => <Skeleton className="size-full" /> },
);

/**
 * 보기 컨트롤(구성 탭 툴바 오른쪽 끝)의 공통 모양. 켜져 있으면(`aria-expanded`) ghost 버튼의 옅은 회색
 * 바탕과 진한 글자로 눌린 듯 보인다.
 */
const VIEW_CONTROL_CLASS =
  "cursor-pointer text-muted-foreground hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground";

/**
 * 가운데 뷰어 칼럼. 위에서부터 툴바(구성 탭: 문서 경계, 페이지 조작, 보기 컨트롤) 또는 페이지 탭(값 탭),
 * 펼친 필름스트립 띠, 이미지 상태 안내, 뷰어 순이다. 툴바는 맨 위에 고정이라 띠를 펼치거나 접어도 보기
 * 컨트롤이 움직이지 않고, 띠는 칼럼 폭 안에서 가로로 스크롤한다. 넓은 화면을 창 높이에 맞출 때 뷰어는
 * 남은 높이를 채우고, 뷰어 최소 높이를 못 채우면 페이지 대신 이 칼럼이 스크롤된다. 보기 방식(한 장씩,
 * 이어서 스크롤) 토글은 뷰어 아래 툴바의 쪽 번호 옆에 있다.
 */
export function ViewerColumn() {
  const t = useTranslations("review.viewer");
  const {
    state,
    dispatch,
    docPages,
    imageUrls,
    viewerHighlights,
    refreshFiles,
  } = useJobReview();
  // 값 패널 "필드" 메뉴로 숨긴 필드의 추출값은 뷰어에도 그리지 않는다.
  const highlights = useFieldFilteredHighlights(viewerHighlights);
  const [viewerMode, setViewerMode] = useViewerMode();
  const [filmstripOpen] = useFilmstripOpen();
  const { open: organizerOpen } = useOrganizer();
  const structure = state.mode === "structure";
  // 구성 탭의 필름스트립은 접을 수 있고 페이지 정리 화면이 열린 동안은 숨긴다. 값 탭은 긴 문서일 때만
  // 위치 바를 둔다(짧은 문서는 뷰어 아래 쪽 번호 이동으로 충분하다).
  const showBand =
    showsFilmstripBand(state.mode, filmstripOpen, organizerOpen) &&
    (structure || docPages.length > PAGE_TABS_MAX);
  const bandId = useId();
  const visibleDocuments = useVisibleDocuments();
  const shortcutsId = useId();
  // 페이지 이미지가 로드에 실패하면(만료된 서명 URL 등) 그 파일의 이미지 URL 을 저절로 다시 받는다.
  const reportImageError = useImageRefresh(state.files, refreshFiles);
  const onContinuousChange = useCallback(
    (continuous: boolean) => setViewerMode(continuous ? "continuous" : "paged"),
    [setViewerMode],
  );

  // 뷰어 열 안의 키보드 이동. 글자 입력 중이거나 안쪽 요소가 이미 처리한 키(드롭다운 화살표,
  // 위치 바의 Home, End 등)는 건드리지 않는다.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    const command = viewerKeyCommand(
      event,
      state.selectedPageIndex,
      docPages.length,
    );
    if (!command) return;
    if (command.kind === "page") {
      markSelectPage(command.index, "keyboard");
      dispatch({ type: "SELECT_PAGE", index: command.index });
    } else {
      const next = neighborDocument(
        visibleDocuments,
        state.selectedDocument,
        command.delta,
      );
      if (!next) return;
      dispatch({
        type: "SELECT_DOCUMENT",
        document: {
          stepId: next.stepId,
          documentId: next.document.document_id,
        },
      });
    }
    event.preventDefault();
  };

  return (
    <section
      // 캔버스를 누르면 이 영역이 포커스를 받아 단축키가 듣는다(Tab 순서에는 넣지 않는다). 스크롤 상자라
      // 안쪽 sr-only(absolute) 요소가 상자 밖으로 빠져 페이지를 늘리지 않도록 relative 를 둔다.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="relative flex min-w-0 flex-col gap-3 bg-muted/40 p-3 focus-visible:outline-hidden xl:fit:min-h-0 xl:fit:overflow-y-auto"
      aria-label={t("label")}
      aria-keyshortcuts={VIEWER_KEYSHORTCUTS}
      aria-describedby={shortcutsId}
      data-testid="job-review-viewer-column"
    >
      {/* 단축키 안내는 화면 낭독기용 설명으로만 둔다(뷰어 열의 aria-describedby). */}
      <span id={shortcutsId} className="sr-only">
        {t("shortcuts")}
      </span>
      {structure ? (
        <StructureToolbar
          trailing={
            // 보기 컨트롤은 하나씩 따로 빼거나 넣을 수 있다. 둘 다 없으면 툴바에 구분선도 그리지 않는다.
            <>
              <FilmstripToggle bandId={bandId} />
              <OrganizerToggle />
            </>
          }
        />
      ) : null}
      {showBand ? (
        <div id={bandId} className="w-full min-w-0 shrink-0">
          <PageBand />
        </div>
      ) : null}
      <ViewerNotices />
      {/* 뷰어 안(폴리곤, 빈 곳, 확대 조작)을 누르는 것은 고정 하이라이트를 풀지 않는다. */}
      <div
        className="h-[70vh] min-h-96 min-w-0 xl:fit:h-auto xl:fit:min-h-64 xl:fit:flex-1"
        data-highlight-keep=""
      >
        {docPages.length === 0 ? (
          <ListNotice title={t("noPages")} />
        ) : (
          <DocumentViewer
            imgUrls={imageUrls}
            currentPageIndex={Math.min(
              state.selectedPageIndex,
              Math.max(imageUrls.length - 1, 0),
            )}
            onPageSelect={index => {
              markSelectPage(index, "viewer");
              dispatch({ type: "SELECT_PAGE", index });
            }}
            highlights={highlights}
            selectedHighlightId={state.selectedHighlightId}
            hoveredHighlightId={state.hoveredHighlightId}
            onHighlightSelect={id =>
              dispatch({ type: "SELECT_HIGHLIGHT", id, source: "viewer" })
            }
            onHighlightHover={id => dispatch({ type: "HOVER_HIGHLIGHT", id })}
            continuous={viewerMode === "continuous"}
            onContinuousChange={onContinuousChange}
            onImageError={reportImageError}
          />
        )}
      </div>
    </section>
  );
}

/**
 * 구성 탭 필름스트립(페이지 썸네일 띠)을 펼치고 접는 버튼(아이콘과 이름, 툴바 폭이 좁으면 아이콘만). 설정 메뉴에서 "페이지 썸네일" 을 켰을
 * 때만 보인다. 띠는 툴바 아래에 열린다. 페이지 정리
 * 화면이 열린 동안은 띠를 그리지 않으므로 이 버튼도 숨긴다(펼침 기억값은 그대로).
 */
function FilmstripToggle({ bandId }: { bandId: string }) {
  const t = useTranslations("review.viewer");
  const [filmstripOpen, setFilmstripOpen] = useFilmstripOpen();
  const { open: organizerOpen } = useOrganizer();
  const enabled = useReviewPolicy().features.filmstrip;
  if (!enabled || organizerOpen) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("filmstrip")}
            aria-expanded={filmstripOpen}
            aria-controls={filmstripOpen ? bandId : undefined}
            onClick={() => setFilmstripOpen(!filmstripOpen)}
            data-testid="job-review-viewer-button-filmstrip"
            className={cn(VIEW_CONTROL_CLASS, "@max-[30rem]:px-1.5")}
          >
            <GalleryHorizontalEndIcon aria-hidden="true" className="size-3.5" />
            <span className="@max-[30rem]:hidden">{t("filmstrip")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {filmstripOpen ? t("filmstripHide") : t("filmstripShow")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * 페이지 정리 화면(작업 패널 자리의 썸네일 격자)을 열고 닫는 버튼. 설정 메뉴에서 "페이지 정리" 를 켰을
 * 때만 보인다. 툴바 폭이 좁으면 글자를 접고 아이콘만
 * 남긴다(이름은 접근성 이름과 툴팁으로).
 */
function OrganizerToggle() {
  const t = useTranslations("review.viewer");
  const to = useTranslations("review.organizer");
  const { open, setOpen, panelId, toggleId } = useOrganizer();
  const enabled = useReviewPolicy().features.organizer;
  if (!enabled) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            id={toggleId}
            aria-label={to("title")}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen(!open)}
            data-testid="job-review-viewer-button-organizer"
            className={cn(VIEW_CONTROL_CLASS, "@max-[30rem]:px-1.5")}
          >
            <LayoutGridIcon aria-hidden="true" className="size-3.5" />
            <span className="@max-[30rem]:hidden">{to("title")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {open ? t("organizerHide") : t("organizerShow")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * 뷰어 위 상태 안내: 파일 이미지 진행, 아직 준비 중이거나 읽지 못한 파일(다시 시도), Parse 하이라이트
 * 묶음 상태(다시 시도). 다시 시도는 서버 캐시를 건너뛰고 그 파일의 이미지 URL 을 다시 받는다.
 */
function ViewerNotices() {
  const t = useTranslations("review.viewer");
  const { state, dispatch, docPages, highlightsStatus, refreshFiles } =
    useJobReview();
  const { files } = state;
  const progress = fileProgress(files);

  const docFileRefs = useMemo(
    () => [...new Set(docPages.map(ref => ref.file_ref))],
    [docPages],
  );
  const docFiles = docFileRefs.flatMap(ref =>
    Object.hasOwn(files, ref) ? [{ ref, entry: files[ref]! }] : [],
  );
  const notReady = docFiles
    .filter(({ entry }) => entry.status === "not_ready")
    .map(({ ref }) => ref);
  const failed = docFiles.filter(({ entry }) => entry.status === "error");

  const retryButton = (onClick: () => void, testId: string) => (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto cursor-pointer p-0 text-xs"
      onClick={onClick}
      data-testid={testId}
    >
      {t("retry")}
    </Button>
  );

  return (
    <div
      aria-live="polite"
      className="flex shrink-0 flex-col gap-1 empty:hidden"
    >
      {progress.pending && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="job-review-viewer-progress"
        >
          {t("progress", {
            pages: progress.pages,
            totalPages: progress.totalPages,
            files: progress.files,
            totalFiles: progress.totalFiles,
          })}
        </p>
      )}
      {notReady.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
          <p className="text-muted-foreground">{t("notReady")}</p>
          {retryButton(
            () => refreshFiles(notReady),
            "job-review-viewer-button-images-retry",
          )}
        </div>
      )}
      {failed.map(({ ref, entry }) => (
        <div
          key={ref}
          className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs"
        >
          <p className="text-destructive">
            {t("fileFailed", { file: entry.name || ref })}
          </p>
          {retryButton(
            () => refreshFiles([ref]),
            "job-review-viewer-button-file-retry",
          )}
        </div>
      ))}
      {highlightsStatus !== "idle" && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
          <p
            className={
              highlightsStatus === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            }
            data-testid="job-review-viewer-highlights-status"
          >
            {t(
              highlightsStatus === "error"
                ? "highlightsFailed"
                : "highlightsLoading",
            )}
          </p>
          {highlightsStatus === "error" &&
            retryButton(() => {
              for (const fileRef of docFileRefs) {
                dispatch({ type: "FILE_HIGHLIGHTS_RETRY", fileRef });
              }
            }, "job-review-viewer-button-highlights-retry")}
        </div>
      )}
    </div>
  );
}
