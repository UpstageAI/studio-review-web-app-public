"use client";

import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { localStore } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { listCollections } from "@/lib/review-api/client";
import type {
  ListOrder,
  SearchCollectionSummary,
} from "@/lib/review-api/types";
import {
  FIT_TABLE_WRAP_CLASS,
  STUDIO_TABLE_CLASS,
} from "@/components/studio-table";
import { CollectionLineageView } from "@/components/showcase/lineage/collection-lineage-view";
import { ColumnMenu } from "./column-menu";
import {
  HIDEABLE_COLUMNS,
  readHiddenColumns,
  toggleHiddenColumn,
  writeHiddenColumns,
  type HideableColumn,
  type ListColumn,
} from "./column-visibility";
import {
  COLUMN_WIDTH_REM,
  MENU_COLUMN_REM,
  tableMinWidthRem,
} from "./column-widths";
import { CopyIdButton } from "./copy-id-button";
import { CursorPagination } from "./cursor-pagination";
import { FilterHead } from "./filter-head";
import {
  ALL_SOURCES,
  filterBySource,
  hasActiveFilter,
  type SourceFilter,
} from "./list-filters";
import { ListEmpty, ListError, ListLoading } from "./list-state";
import { ListViewToggle } from "./list-view-toggle";
import { collectionHref, isRowNavigationClick } from "./links";
import { writeListSearch } from "./list-storage";
import {
  parseListUrlState,
  serializeListUrlState,
  type ListUrlState,
  type ListView,
} from "./list-url-state";
import { OrderSelect } from "./order-select";
import {
  ReviewOverviewCards,
  ReviewProgressCell,
} from "@/components/showcase/review-overview/review-overview";
import { reviewSortValue } from "@/components/showcase/review-overview/review-overview-model";
import {
  nextSortState,
  sortRows,
  type SortColumn,
  type SortState,
} from "./sort-rows";
import { SortableHead } from "./sortable-head";
import { SourceBadge } from "./source-badge";
import { workflowName } from "./source-label";
import { useCursorBlockList } from "./use-cursor-block-list";
import { useReviewOverview } from "@/components/showcase/review-overview/use-review-overview";

/**
 * Collection 목록 화면. 검수 대상(문서 Collection)을 Studio Collection 목록과 같은 기준
 * (`listed=true`)으로 보여 준다. Agent 와 함께 자동으로 만든 기본 Collection 은 빠지고, 직접 만든
 * Collection 은 기본 Collection 이 되었어도 보인다.
 * 머리 줄은 왼쪽에 페이지 제목(`heading`), 오른쪽에 목록 전체 순서(서버 `order`, 결과 최신순 또는
 * 오래된순)다. 그 아래 검수 현황 카드와 표가 오고, 넓은 화면에서는 표만 안에서 스크롤한다.
 *
 * 출처 필터와 열 머리 정렬은 받아 둔 현재 페이지 행에만 적용하므로 페이지가 여럿일 때만 그 안내를
 * 표 아래 페이지 이동 줄 왼쪽에 둔다.
 * 헤더 마지막 `…` 메뉴로 이름 외 열을 숨기고 보이며, 선택은 localStorage 에 남는다.
 * 표는 고정 레이아웃이라 보이는 열 구성이 같으면 필터·페이지·내용과 무관하게 열 폭이 같다(`column-widths.ts`).
 * 칸을 넘는 글자는 말줄임하고 `title` 로 전체를 보인다.
 * 정렬 순서, 열 정렬, 필터, 페이지는 주소 query 에 두어(`list-url-state.ts`) 상세에서 뒤로 가거나
 * "Collection 목록" 으로 돌아와도 같은 화면을 다시 만든다. 이 컴포넌트는 `useSearchParams` 때문에
 * Suspense 안에서 클라이언트에서만 그려진다.
 *
 * 머리 줄의 토글로 표와 Collection 관계 그림(`collection-lineage-view.tsx`)을 오간다. 관계 그림은 페이지와
 * 필터에 묶이지 않고 세로 공간이 필요해 그동안 정렬 선택과 현황 카드를 숨긴다. 보기도 주소 query 에 남는다.
 */
export function CollectionsListView({ heading }: { heading: ReactNode }) {
  const t = useTranslations("collections");
  const locale = useLocale();
  const router = useRouter();
  const scopeHintId = useId();
  const searchParams = useSearchParams();
  // 주소와 저장된 열 숨김은 첫 마운트에서 한 번만 읽는다. 이후 주소는 이 상태를 따라 바뀐다.
  const [initial] = useState(() =>
    initialListState(
      parseListUrlState(new URLSearchParams(searchParams.toString())),
      readHiddenColumns(localStore()),
    ),
  );
  const [view, setView] = useState<ListView>(initial.url.view);
  const [order, setOrder] = useState<ListOrder>(initial.url.order);
  const [sort, setSort] = useState<SortState | null>(initial.url.sort);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(
    initial.url.source,
  );
  const [hidden, setHidden] = useState(initial.hidden);

  const list = useCursorBlockList<SearchCollectionSummary>(
    JSON.stringify(["documents", order]),
    (after, limit, signal) =>
      listCollections(
        {
          kind: "documents",
          listed: true,
          order,
          limit,
          after,
        },
        { signal },
      ),
    initial.url,
  );

  const page = list.page;
  const cursors = list.cursors;
  useEffect(() => {
    const search = serializeListUrlState({
      view,
      order,
      sort,
      source: sourceFilter,
      pageIndex: page - 1,
      cursors: cursors.slice(1).map(cursor => cursor ?? ""),
    });
    // `replaceState` 는 Next 라우터와 동기화되며 서버 왕복, 다시 렌더를 만들지 않는다.
    if (window.location.search !== (search ? `?${search}` : "")) {
      window.history.replaceState(
        null,
        "",
        search ? `?${search}` : window.location.pathname,
      );
    }
    writeListSearch(search);
  }, [view, order, sort, sourceFilter, page, cursors]);

  const labels = useMemo(() => ({ untitled: t("untitled") }), [t]);
  const { pageItems } = list;
  // 이 페이지 Collection 들의 검수 현황(앱 DB)과 앱 전체 요약.
  const pageIds = useMemo(() => pageItems.map(item => item.id), [pageItems]);
  const review = useReviewOverview(pageIds);
  const reviewCounts = review.collections;
  const sortLabels = useMemo(
    () => ({
      ...labels,
      reviewValue: (row: SearchCollectionSummary) =>
        reviewSortValue(row, reviewCounts),
    }),
    [labels, reviewCounts],
  );
  const rows = useMemo(
    () =>
      sortRows(
        filterBySource(pageItems, sourceFilter),
        sort,
        locale,
        sortLabels,
      ),
    [pageItems, sourceFilter, sort, locale, sortLabels],
  );
  const filtered = hasActiveFilter(sourceFilter);

  const onSort = (column: SortColumn) =>
    setSort(current => nextSortState(current, column));
  const paged = list.canGoBack || list.hasMore;
  const sortProps = {
    sort,
    onSort,
    describedBy: paged ? scopeHintId : undefined,
  };
  const clearFilters = () => setSourceFilter(ALL_SOURCES);
  const visible = (column: ListColumn) =>
    column === "name" || !hidden.has(column);
  // 숨긴 열의 정렬, 필터는 화면에서 보이지 않으므로 함께 푼다.
  const toggleColumn = (column: HideableColumn) => {
    const next = toggleHiddenColumn(hidden, column);
    setHidden(next);
    writeHiddenColumns(localStore(), next);
    if (!next.has(column)) return;
    if (sort?.column === column) setSort(null);
    if (column === "source") setSourceFilter(ALL_SOURCES);
  };
  const shownColumns = HIDEABLE_COLUMNS.filter(column => !hidden.has(column));
  // 이름 열 + 보이는 열 + 메뉴 열
  const columnCount = 1 + shownColumns.length + 1;
  const loading = list.phase === "loading";
  // 첫 블록을 받는 동안에도 자리를 지켜 머리 줄이 뛰지 않게 하고, 오류나 (필터 없이) 빈 목록이면 숨긴다.
  // 둘째 페이지 이후의 빈 블록은 목록이 빈 것이 아니므로 그대로 둔다.
  const showOrder =
    loading || list.pageItems.length > 0 || filtered || list.canGoBack;

  function renderBody() {
    if (view === "lineage") return <CollectionLineageView />;
    if (list.phase === "loading") {
      return <ListLoading label={t("loadingMore")} />;
    }
    if (list.phase === "error") {
      return (
        <ListError
          error={list.error}
          onRetry={list.retry}
          testId="collections-list-button-retry"
        />
      );
    }
    // 뒤로 갈 페이지가 있으면 빈 블록이어도 표와 페이지 이동 줄을 그린다.
    if (list.pageItems.length === 0 && !filtered && !list.canGoBack) {
      return (
        <ListEmpty
          title={t("empty.title")}
          description={t("empty.description")}
        />
      );
    }
    return (
      <div className="flex flex-col gap-4 lg:min-h-0">
        {review.failed && !review.overview ? null : (
          <div className="shrink-0">
            <ReviewOverviewCards overview={review.overview} />
          </div>
        )}
        {/* 넓은 화면에서는 표만 안에서 스크롤하고 머리 행은 위에 고정된다. */}
        <div
          className={`rounded-lg border border-border ${FIT_TABLE_WRAP_CLASS}`}
        >
          <Table
            className={cn(STUDIO_TABLE_CLASS, "table-fixed")}
            style={{ minWidth: `${tableMinWidthRem(shownColumns)}rem` }}
            data-testid="collections-list-table"
            aria-busy={list.blockLoading || undefined}
          >
            {/* 이름 열은 폭을 정하지 않아 남는 폭을 모두 가진다. */}
            <colgroup>
              <col />
              {shownColumns.map(column => (
                <col
                  key={column}
                  style={{ width: `${COLUMN_WIDTH_REM[column]}rem` }}
                />
              ))}
              <col style={{ width: `${MENU_COLUMN_REM}rem` }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <SortableHead
                  column="name"
                  label={t("columns.name")}
                  {...sortProps}
                />
                {visible("source") && (
                  <FilterHead
                    column="source"
                    value={sourceFilter}
                    onChange={setSourceFilter}
                    disabled={list.blockLoading}
                  />
                )}
                {visible("workflow") && (
                  <SortableHead
                    column="workflow"
                    label={t("columns.workflow")}
                    {...sortProps}
                  />
                )}
                {visible("jobs") && (
                  <SortableHead
                    column="jobs"
                    label={t("columns.jobs")}
                    {...sortProps}
                  />
                )}
                {visible("review") && (
                  <SortableHead
                    column="review"
                    label={t("columns.review")}
                    {...sortProps}
                  />
                )}
                {visible("updated") && (
                  <SortableHead
                    column="updated"
                    label={t("columns.updated")}
                    {...sortProps}
                  />
                )}
                {visible("lastResult") && (
                  <SortableHead
                    column="lastResult"
                    label={t("columns.lastResult")}
                    {...sortProps}
                  />
                )}
                <ColumnMenu hidden={hidden} onToggle={toggleColumn} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !filtered && (
                <TableRow data-testid="collections-list-row-page-empty">
                  <TableCell colSpan={columnCount} className="py-10">
                    <div className="flex flex-col items-center gap-2 text-center whitespace-normal">
                      <p className="font-medium text-foreground">
                        {t("empty.pageTitle")}
                      </p>
                      <p className="text-sm text-muted-dark">
                        {t("empty.pageDescription")}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {rows.length === 0 && filtered && (
                <TableRow data-testid="collections-list-row-filtered-empty">
                  <TableCell colSpan={columnCount} className="py-10">
                    <div className="flex flex-col items-center gap-2 text-center whitespace-normal">
                      <p className="font-medium text-foreground">
                        {t("empty.filteredTitle")}
                      </p>
                      <p className="text-sm text-muted-dark">
                        {t("empty.filteredDescription")}
                      </p>
                      <Button
                        variant="outline"
                        className="mt-1"
                        onClick={clearFilters}
                        data-testid="collections-list-button-clear-filters"
                      >
                        {t("filter.clear")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {rows.map(collection => {
                const href = collectionHref(collection.id);
                const workflow = workflowName(collection.source);
                return (
                  <TableRow
                    key={collection.id}
                    className="cursor-pointer"
                    data-testid="collections-list-row-open"
                    onClick={event => {
                      if (isRowNavigationClick(event)) router.push(href);
                    }}
                  >
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Link
                          href={href}
                          className="truncate text-foreground hover:underline"
                          title={collection.name || labels.untitled}
                          data-testid="collections-list-link-open"
                        >
                          {collection.name || labels.untitled}
                        </Link>
                        <CopyIdButton
                          id={collection.id}
                          testId="collections-list-button-copy-id"
                        />
                      </div>
                    </TableCell>
                    {visible("source") && (
                      <TableCell>
                        {collection.source?.type ? (
                          <SourceBadge collection={collection} truncate />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    {visible("workflow") && (
                      <TableCell className="text-muted-dark">
                        {workflow ? (
                          <span className="block truncate" title={workflow}>
                            {workflow}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    {visible("jobs") && (
                      <TableCell className="text-muted-dark">
                        <TruncatedText
                          text={
                            typeof collection.total_job_count === "number"
                              ? collection.total_job_count.toLocaleString(
                                  locale,
                                )
                              : null
                          }
                        />
                      </TableCell>
                    )}
                    {visible("review") && (
                      <TableCell className="text-muted-dark">
                        <ReviewProgressCell
                          row={collection}
                          counts={reviewCounts}
                          loading={review.loading}
                        />
                      </TableCell>
                    )}
                    {visible("updated") && (
                      <TableCell className="text-muted-dark">
                        <TruncatedText
                          text={formatDateTime(collection.updated_at, locale)}
                        />
                      </TableCell>
                    )}
                    {visible("lastResult") && (
                      <TableCell className="text-muted-dark">
                        <TruncatedText
                          text={formatDateTime(
                            collection.last_result_at,
                            locale,
                          )}
                        />
                      </TableCell>
                    )}
                    <TableCell />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {list.blockError && (
          <ListError
            error={list.error}
            onRetry={list.retry}
            testId="collections-list-button-retry-block"
            compact
          />
        )}
        {paged ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p id={scopeHintId} className="text-xs text-muted-dark">
              {t("sort.scopeHint")}
            </p>
            <CursorPagination
              page={list.page}
              pageNumbers={list.pageNumbers}
              canGoBack={list.canGoBack}
              hasMore={list.hasMore}
              loading={list.blockLoading || list.blockError}
              onPrevious={list.previousPage}
              onNext={list.nextPage}
              onGoTo={list.goToPage}
              testIdPrefix="collections-list"
              className="mx-0 w-auto"
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:min-h-0">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {heading}
        <div className="flex flex-wrap items-center gap-2">
          {view === "list" && showOrder ? (
            <OrderSelect
              value={order}
              onChange={setOrder}
              disabled={loading || list.blockLoading}
              compact
            />
          ) : null}
          <ListViewToggle value={view} onChange={setView} />
        </div>
      </div>
      {renderBody()}
    </div>
  );
}

/** 칸을 넘으면 말줄임하고 `title` 로 전체를 보이는 글자. 값이 없으면 `—`. */
function TruncatedText({ text }: { text: string | null }) {
  if (text === null) return <>—</>;
  return (
    <span className="block truncate" title={text}>
      {text}
    </span>
  );
}

/**
 * 주소에서 읽은 상태와 저장된 열 숨김을 맞춘다. 숨긴 열의 정렬, 필터는 화면에 보이지 않으므로
 * (열을 숨길 때와 같은 규칙으로) 풀고 시작한다.
 */
function initialListState(
  url: ListUrlState,
  hidden: ReadonlySet<HideableColumn>,
): { url: ListUrlState; hidden: ReadonlySet<HideableColumn> } {
  const sortColumn = url.sort?.column;
  return {
    hidden,
    url: {
      ...url,
      sort:
        sortColumn && sortColumn !== "name" && hidden.has(sortColumn)
          ? null
          : url.sort,
      source: hidden.has("source") ? ALL_SOURCES : url.source,
    },
  };
}
