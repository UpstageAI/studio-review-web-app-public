"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { collectionHref } from "@/components/collections/links";
import {
  DocumentList,
  effectiveStatusFilter,
  filterDocumentItems,
  isFiltering,
  isSelectionHidden,
  statusFilterOptions,
  summarizeDocuments,
  type DocumentStatusFilter,
} from "@/components/studio-ui-kit/document-list";
import type { DocumentListItem } from "@/components/studio-ui-kit/document-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link } from "@/i18n/navigation";
import {
  documentPages,
  findResult,
  flattenSources,
  isMultiLayout,
  isValueEntry,
  linkedDocumentIds,
  type DocumentChange,
} from "@/lib/review-model";
import { ChangeTraySheet } from "./change-tray-sheet";
import { reviewErrorCode } from "./review-error-code";
import { HistorySheet } from "./history-sheet";
import { DraftBanner } from "./draft-banner";
import { useFilmstripOpen } from "./filmstrip-open-context";
import { FilmstripOpenProvider } from "./filmstrip-open-provider";
import { DocumentListFilter } from "./document-list-filter";
import { documentVerdicts, flagForVerdict } from "./document-verdicts";
import type { UseJobReviewHeaderExtension } from "./header-extension";
import { JobReviewHeader } from "./job-review-header";
import { useJobReview } from "./job-review-context";
import { JobReviewProvider } from "./job-review-provider";
import { documentKey } from "./job-review-state";
import { DOCUMENT_LIST_VIRTUALIZE_ABOVE } from "./large-job";
import { markDocumentListReady } from "./perf-marks";
import { InstructTab } from "./instruct-tab";
import { OrganizerBand } from "./organizer-band";
import { OrganizerHeader } from "./organizer-header";
import { useOrganizer } from "./organizer-context";
import { OrganizerProvider } from "./organizer-provider";
import { showsOrganizer } from "./organizer-view";
import { ParseTab } from "./parse-tab";
import { ReviewPolicyProvider } from "./review-policy";
import { useReviewPolicy } from "./review-policy-context";
import { StepTabs } from "./step-tabs";
import { useDocumentFilterQuery } from "./use-document-filter-query";
import { useStepTabLabel } from "./use-step-tab-label";
import { useUrlSelectionSync } from "./use-url-selection";
import { useVisibleDocuments } from "./use-visible-documents";
import { useVisitedDocuments } from "./use-visited-documents";
import { StructurePanel } from "./structure-panel";
import { DocumentPanelSummary } from "./document-panel-summary";
import { ValuePanel } from "./value-panel";
import { ViewerColumn } from "./viewer-column";

const REVIEW_ERROR_CODES = [
  "review_target_not_found",
  "collection_source_type_unsupported",
  "collection_review_disabled",
  "operation_capacity_exceeded",
  "artifact_unavailable",
  "idempotency_key_reused",
  "invalid_value",
  "forbidden",
  "package_limit_exceeded",
  "server_misconfigured",
  "api_unreachable",
  "upstream_timeout",
  "upstream_redirect",
  "network_error",
  "invalid_document",
  "unsupported_review_format",
  "invalid_json",
  "json_too_large",
  "nesting_too_deep",
  "duplicate_key",
] as const;

type ReviewErrorCode = (typeof REVIEW_ERROR_CODES)[number];

/** 다시 시도해도 바뀌지 않는 오류(목록으로 돌아가는 안내만 보인다). */
const TERMINAL_CODES: readonly string[] = [
  "review_target_not_found",
  "collection_source_type_unsupported",
  "collection_review_disabled",
];

function isReviewErrorCode(code: string): code is ReviewErrorCode {
  return (REVIEW_ERROR_CODES as readonly string[]).includes(code);
}

function documentStatus(
  change: DocumentChange | undefined,
  valuesChanged: boolean,
  excluded: boolean,
): DocumentListItem["status"] {
  if (excluded) return "excluded";
  if (change?.pageSetChanged) return "recheck";
  if ((change && change.status !== "same") || valuesChanged) return "changed";
  return undefined;
}

/** Job 하나를 검수하는 화면. 상태는 `JobReviewProvider` 가 가진다. */
export function JobReviewScreen({
  collectionId,
  jobId,
  useHeaderExtension,
}: {
  collectionId: string;
  jobId: string;
  /**
   * 화면 머리에 화면 밖 기능(검수 큐, 최근 기록, 완료 안내 등)을 꽂는 hook. 없으면 아무것도 더하지 않는다.
   * 머리가 렌더마다 부르는 hook 이므로 마운트된 동안 같은 함수여야 한다(모듈 수준 함수를 넘긴다).
   */
  useHeaderExtension?: UseJobReviewHeaderExtension;
}) {
  return (
    <ReviewPolicyProvider>
      <JobReviewProvider collectionId={collectionId} jobId={jobId}>
        <FilmstripOpenProvider>
          <OrganizerProvider>
            <ScreenFrame>
              <StepTabs
                header={track => (
                  <JobReviewHeader
                    track={track}
                    useHeaderExtension={useHeaderExtension}
                  />
                )}
              >
                <JobReviewBody />
              </StepTabs>
            </ScreenFrame>
          </OrganizerProvider>
        </FilmstripOpenProvider>
        <ChangeTraySheet />
        <HistorySheet />
      </JobReviewProvider>
    </ReviewPolicyProvider>
  );
}

/**
 * 화면 틀. 넓은 화면에서는 창 높이(공통 상단 바 3.5rem 과 바깥 `main` 의 위아래 여백 2rem 을 뺀 값)에 맞추고 문서 목록, 뷰어,
 * 작업 패널이 각자 스크롤해 페이지 전체 세로 스크롤이 생기지 않는다(`fit:` 변형). 구성 탭의 필름스트립
 * 띠도 뷰어 칼럼 안에 들어가 뷰어 높이를 나눠 쓰므로 맞춤을 풀지 않는다. 창이 아주 낮으면 최소 높이를
 * 넘겨 페이지가 스크롤된다.
 */
function ScreenFrame({ children }: { children: ReactNode }) {
  return (
    <div
      data-viewport-fit="true"
      className="flex flex-col gap-3 xl:fit:h-[calc(100dvh-5.5rem)] xl:fit:min-h-[37rem]"
    >
      {children}
    </div>
  );
}

/**
 * 본문 세 칸 틀. 불러오는 동안의 자리 표시도 같은 틀을 써서, 다 불러왔을 때 화면이 움직이지 않는다.
 * 넓은 화면일수록 문서 목록 칸을 조금 넓히고(16rem, 18rem, 20rem), 1920px 이상에서는 뷰어 칸에 폭을 더 준다.
 */
const BODY_FRAME_CLASS =
  "grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-background xl:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1fr)_minmax(0,1fr)] min-[1920px]:grid-cols-[20rem_minmax(0,1.25fr)_minmax(0,1fr)] xl:divide-x xl:divide-y-0 xl:fit:min-h-0 xl:fit:flex-1 xl:fit:grid-rows-[minmax(0,1fr)]";

/**
 * Job 을 불러오는 동안의 본문. 다 불러온 화면과 같은 세 칸 틀에 문서 목록, 페이지, 작업 패널 자리를
 * 회색 막대로 미리 그려 둔다(Job 을 옮길 때도 같다).
 */
function BodySkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex flex-col gap-4 xl:fit:min-h-0 xl:fit:flex-1"
      data-testid="job-review-loading"
    >
      <div className={BODY_FRAME_CLASS}>
        <div className="flex flex-col gap-3 bg-subtle p-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex h-[70vh] min-h-96 items-center justify-center bg-muted/40 p-3 xl:fit:h-auto">
          <Skeleton className="aspect-[3/4] h-4/5 max-h-full bg-background" />
        </div>
        <div className="flex flex-col gap-4 bg-background p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      </div>
    </div>
  );
}

function JobReviewBody() {
  const t = useTranslations("review");
  const { state, stepsFallback } = useJobReview();

  if (state.status === "loading") return <BodySkeleton label={t("loading")} />;
  if (state.status === "error") return <LoadError />;

  return (
    <div className="flex flex-col gap-4 xl:fit:min-h-0 xl:fit:flex-1">
      {/* 저장하지 않은 변경이 브라우저에 남아 있으면 본문 위에 복원 배너. */}
      <DraftBanner />
      {stepsFallback ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="job-review-steps-fallback"
        >
          {t("stepsFallback")}
        </p>
      ) : null}
      {/* Studio 워크플로우 화면처럼 한 틀 안을 세로선으로 나눈다: 넓은 화면은 문서 목록(옅은 회색),
          뷰어(회색 캔버스), 작업 패널(흰 바탕). 뷰어와 패널은 같은 너비. 창 높이에 맞출 때는 남은
          높이를 한 줄로 채우고 칼럼마다 안에서 스크롤한다. 좁은 화면은 가로선으로 쌓는다. */}
      <div className={BODY_FRAME_CLASS}>
        <UrlSelectionSync />
        <DocumentColumn />
        <ViewerColumn />
        <DocumentPanel />
      </div>
    </div>
  );
}

/**
 * 선택 문서·페이지를 주소창 `?doc=…&page=…` 에 적는다. 불러온 뒤에만 그려지므로(로딩 중에는
 * 쿼리를 지우지 않는다) 불러올 때 읽은 자리가 덮이지 않는다.
 */
function UrlSelectionSync() {
  const { state, selected } = useJobReview();
  useUrlSelectionSync(
    selected
      ? {
          documentId: selected.document.document_id,
          pageIndex: state.selectedPageIndex,
        }
      : null,
  );
  return null;
}

function LoadError() {
  const t = useTranslations("review.errors");
  const { state, retry } = useJobReview();
  const code = reviewErrorCode(state.error);
  const message = isReviewErrorCode(code) ? t(code) : t("generic");
  const terminal = TERMINAL_CODES.includes(code);

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-border px-6 py-12 text-center"
    >
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">{t("title")}</p>
        <p className="text-sm text-destructive">{message}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {t("code", { code })}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {!terminal && (
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={retry}
            data-testid="job-review-button-retry"
          >
            {t("retry")}
          </Button>
        )}
        <Button asChild variant={terminal ? "default" : "ghost"} size="default">
          <Link
            href={collectionHref(state.collectionId)}
            data-testid="job-review-link-jobs"
          >
            {t("backToJobs")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function DocumentColumn() {
  const t = useTranslations("review.documents");
  const { state, dispatch, job, docChanges, selected } = useJobReview();
  // 구성 탭은 그 문서 배치 보기의 문서만 보인다(보기가 여럿인 Job).
  const documents = useVisibleDocuments();

  // 값을 고친 결과가 읽는 문서(바뀜 점).
  const entries = state.session?.entries;
  const valueChangedDocs = useMemo(() => {
    const out = new Set<string>();
    if (!job || !entries) return out;
    for (const entry of entries) {
      if (!isValueEntry(entry)) continue;
      const result = findResult(job, entry.resultId);
      if (result) for (const id of linkedDocumentIds(result)) out.add(id);
    }
    return out;
  }, [job, entries]);

  const excludedDocuments = job?.file_groups?.excluded_documents;
  // 파일 그룹이 둘 이상이면 그룹이 바뀌는 자리에 머리를 둔다(그룹 순서 = file_groups.groups 순서).
  const groups = job?.file_groups?.groups;
  // Validate 판정(지금 편집본 기준)이 red 또는 yellow 인 문서는 라벨 뒤 아이콘으로 알린다.
  const steps = state.session?.current.steps;
  const verdicts = useMemo(() => documentVerdicts(job, steps), [job, steps]);
  const selectedKey = selected
    ? documentKey({
        stepId: selected.stepId,
        documentId: selected.document.document_id,
      })
    : null;
  // 열어 본 문서(브라우저 기억). 문서가 하나뿐이면 구분하지 않는다.
  const visitedKeys = useVisitedDocuments(
    state.collectionId,
    state.jobId,
    selectedKey,
  );
  const trackVisited = documents.length > 1;
  const items = useMemo<DocumentListItem[]>(() => {
    const groupIndex = new Map<string, number>();
    if (groups && groups.length > 1) {
      groups.forEach((group, index) => groupIndex.set(group.group_id, index));
    }
    return documents.map((item, index) => {
      const key = documentKey({
        stepId: item.stepId,
        documentId: item.document.document_id,
      });
      const group = groupIndex.get(item.document.group_id);
      return {
        id: key,
        label: item.document.label,
        pageCount: documentPages(item.document).length,
        status: documentStatus(
          docChanges.get(key),
          valueChangedDocs.has(item.document.document_id),
          excludedDocuments?.includes(item.document.document_id) ?? false,
        ),
        flag: flagForVerdict(verdicts.get(item.document.document_id)),
        visited: trackVisited ? visitedKeys.has(key) : undefined,
        ordinal: index + 1,
        groupLabel:
          group === undefined ? undefined : t("group", { index: group + 1 }),
      };
    });
  }, [
    documents,
    docChanges,
    valueChangedDocs,
    excludedDocuments,
    groups,
    verdicts,
    trackVisited,
    visitedKeys,
    t,
  ]);
  const excludedCount = useMemo(
    () => flattenSources(job?.file_groups?.excluded_pages ?? []).length,
    [job],
  );

  // 문서 목록에 처음 항목이 생긴 시점을 측정용으로 한 번 남긴다.
  const listMarked = useRef(false);
  useEffect(() => {
    if (listMarked.current || items.length === 0) return;
    listMarked.current = true;
    markDocumentListReady();
  }, [items.length]);

  // 라벨 검색은 입력이 멎은 뒤 적용하고, 상태 필터는 바로 적용한다. "열어 보지 않은 문서" 는 열어
  // 본 문서를 구분할 때만 고를 수 있고, 구분하지 않게 되면(문서가 하나만 남음) 전체로 본다.
  const { query, debouncedQuery, setQuery, clearQuery } =
    useDocumentFilterQuery();
  const [statusChoice, setStatus] = useState<DocumentStatusFilter>("all");
  const status = effectiveStatusFilter(statusChoice, trackVisited);
  const statusOptions = statusFilterOptions(trackVisited);

  const untitled = t("untitled");
  // "열어 보지 않은 문서" 로 걸러도 지금 고른 문서는 남긴다(고르자마자 사라지지 않게).
  const visibleItems = useMemo(
    () =>
      filterDocumentItems(items, debouncedQuery, status, untitled, selectedKey),
    [items, debouncedQuery, status, untitled, selectedKey],
  );
  const filtering = isFiltering(debouncedQuery, status);
  const summary = summarizeDocuments(items);
  // 제외 페이지 묶음은 상태를 전체·제외로 봤을 때만 보인다. "제외" 로 걸러 문서는 없고 제외
  // 페이지만 있으면 그 묶음 한 줄이 결과다.
  const showExcluded =
    excludedCount > 0 && (status === "all" || status === "excluded");
  const onlyExcludedBundle =
    visibleItems.length === 0 && status === "excluded" && showExcluded;
  const { features, setFeature } = useReviewPolicy();
  const [, setFilmstripOpen] = useFilmstripOpen();
  const restoreReachable = features.filmstrip || features.organizer;
  const selectionHidden = isSelectionHidden(items, visibleItems, selectedKey);
  // 검색어는 디바운스를 거치지 않고 바로 비워 목록이 곧장 돌아오게 한다.
  const clearFilter = () => {
    clearQuery();
    setStatus("all");
  };

  // Classify Step 보기의 문서만 있으면 "분할된 문서"(Classify 가 원본 파일에서 나눈 문서, 라벨은
  // 분류된 문서 종류), 분류 없는 보기(`stepId === null`)가 섞이거나 그것뿐이면 그냥 "문서".
  const splitByClassify =
    documents.length > 0 && documents.every(item => item.stepId !== null);
  const title = splitByClassify ? t("titleSplit") : t("title");

  return (
    <section
      className="flex min-w-0 flex-col gap-2 bg-subtle p-3 xl:fit:min-h-0"
      aria-labelledby="job-review-documents-title"
    >
      <div className="flex min-w-0 items-center gap-1">
        <h2
          id="job-review-documents-title"
          className="min-w-0 truncate text-sm font-semibold text-foreground"
        >
          {title}
        </h2>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("about")}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                data-testid="job-review-document-heading-button-about"
              >
                <InfoIcon aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" align="start">
              {splitByClassify ? t("aboutSplit") : t("aboutPlain")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <DocumentListFilter
            query={query}
            onQueryChange={setQuery}
            status={status}
            onStatusChange={setStatus}
            statusOptions={statusOptions}
            summary={summary}
            showVisited={trackVisited}
            filteredCount={filtering ? visibleItems.length : null}
            selectionHidden={selectionHidden}
            onClearFilter={clearFilter}
          />
          {showExcluded && !restoreReachable ? (
            // 제외한 페이지는 페이지 썸네일(또는 페이지 정리)에서만 되돌릴 수 있어서, 페이지 썸네일을 끄고
            // 페이지 정리도 꺼 두면 되돌릴 길이 없다. 막히지 않게 여기서 바로 켜고 펼친다.
            <div
              className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
              data-testid="job-review-excluded-pages-hint"
            >
              <p>{t("excludedHint")}</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto cursor-pointer p-0 text-xs"
                onClick={() => {
                  setFeature("filmstrip", true);
                  setFilmstripOpen(true);
                }}
                data-testid="job-review-excluded-pages-hint-button-enable"
              >
                {t("excludedHintAction")}
              </Button>
            </div>
          ) : null}
          {visibleItems.length === 0 && !onlyExcludedBundle ? (
            <p className="text-sm text-muted-foreground">
              {t("filter.noMatch")}
            </p>
          ) : (
            <DocumentList
              items={visibleItems}
              excluded={showExcluded ? { pageCount: excludedCount } : null}
              virtualizeAbove={DOCUMENT_LIST_VIRTUALIZE_ABOVE}
              // 보통은 화면 높이 기준, 넓은 화면을 창 높이에 맞출 때는 칼럼에 남은 높이까지.
              maxHeight="var(--job-review-document-list-max-h)"
              className="[--job-review-document-list-max-h:calc(70vh+3rem)] xl:fit:flex xl:fit:min-h-0 xl:fit:flex-1 xl:fit:flex-col xl:fit:overflow-y-auto xl:fit:[--job-review-document-list-max-h:100%]"
              selectedId={selectedKey}
              onSelect={key => {
                const next = documents.find(
                  item =>
                    documentKey({
                      stepId: item.stepId,
                      documentId: item.document.document_id,
                    }) === key,
                );
                if (next) {
                  dispatch({
                    type: "SELECT_DOCUMENT",
                    document: {
                      stepId: next.stepId,
                      documentId: next.document.document_id,
                    },
                  });
                }
              }}
              labels={{
                list: title,
                untitled,
                excluded: t("excluded"),
                pageCount: count => t("pages", { count }),
                status: {
                  changed: t("status.changed"),
                  recheck: t("status.recheck"),
                  locked: t("status.locked"),
                  excluded: t("status.excluded"),
                },
                flags: {
                  danger: t("flag.danger"),
                  warning: t("flag.warning"),
                },
                unvisited: t("unvisited"),
                hints: {
                  danger: t("hint.danger"),
                  warning: t("hint.warning"),
                  changed: t("hint.changed"),
                  recheck: t("hint.recheck"),
                  locked: t("hint.locked"),
                  excluded: t("hint.excluded"),
                  unvisited: t("hint.unvisited"),
                },
              }}
              // 경고 아이콘은 Studio 경고 색(시맨틱 토큰에 없어 host 가 넘긴다).
              markerClassNames={{ warning: "text-state-warning" }}
              testId="job-review-document-list"
            />
          )}
        </>
      )}
    </section>
  );
}

const PANEL_CLASS =
  "relative flex min-w-0 flex-col gap-4 bg-background p-5 xl:max-h-[calc(70vh+3rem)] xl:overflow-y-auto xl:fit:max-h-none xl:fit:min-h-0";

/**
 * 선택 문서의 작업 패널. 고른 Step 탭에 따라 구성 탭은 라벨·페이지·검증, 값 탭은 그 Step 결과의
 * 값 편집 폼, Parse·Instruct 탭은 그 Step 출력(보기 전용)을 보인다. 구성 탭에서 페이지 정리
 * 화면을 열면 같은 자리에 문서별 썸네일 격자가 대신 들어간다.
 */
function DocumentPanel() {
  const t = useTranslations("review.panel");
  const { state, selected, activeStepTab } = useJobReview();
  const { open: organizerOpen, panelId: organizerId } = useOrganizer();
  const labelOf = useStepTabLabel();
  const kind =
    activeStepTab?.kind ??
    (state.mode === "structure" ? "structure" : "values");

  if (showsOrganizer(kind, organizerOpen)) {
    return (
      <aside
        id={organizerId}
        className={PANEL_CLASS}
        aria-labelledby="job-review-organizer-title"
        data-testid="job-review-organizer-panel"
      >
        <OrganizerHeader headingId="job-review-organizer-title" />
        <StructureBlocked />
        <OrganizerBand />
      </aside>
    );
  }

  // 값, Parse, Instruct 탭은 머리를 "라벨 + 쪽 범위" 한 줄로 줄여 값에 세로 공간을 남긴다(제목은
  // 화면 낭독기용). 구성 탭과 문서가 없을 때는 제목을 그대로 보인다.
  const compactHead = selected !== null && kind !== "structure";
  return (
    <aside className={PANEL_CLASS} aria-labelledby="job-review-panel-title">
      {compactHead ? null : (
        <h2
          id="job-review-panel-title"
          className="text-sm font-medium text-muted-foreground"
        >
          {t("title")}
        </h2>
      )}
      {kind === "structure" ? <StructureBlocked /> : null}
      {!selected ? (
        <p className="text-sm text-muted-foreground">{t("noSelection")}</p>
      ) : kind === "structure" ? (
        <StructurePanel />
      ) : (
        <>
          <DocumentPanelSummary
            document={selected}
            headingId="job-review-panel-title"
          />
          {kind === "values" ? (
            <ValuePanel />
          ) : kind === "parse" && activeStepTab ? (
            <ParseTab name={labelOf(activeStepTab).full} />
          ) : kind === "instruct" ? (
            <InstructTab />
          ) : null}
        </>
      )}
    </aside>
  );
}

/** 구성을 고칠 수 없는 Job(구성 정보 없음·문서 배치 보기 여럿)의 안내. */
function StructureBlocked() {
  const t = useTranslations("review.stepTabs");
  const { job } = useJobReview();
  const reason = !job
    ? null
    : !job.file_groups
      ? "structureNoLayout"
      : isMultiLayout(job)
        ? "structureMultiLayout"
        : null;
  if (!reason) return null;
  return (
    <p
      className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
      data-testid="job-review-structure-blocked"
    >
      {t(reason)}
    </p>
  );
}
