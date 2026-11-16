"use client";

import { FIT_TABLE_WRAP_CLASS } from "@/components/studio-table";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  ApiError,
  getCollection,
  getReviewCapabilities,
  isAbortError,
  listJobRows,
} from "@/lib/review-api/client";
import type {
  JobRow,
  ListOrder,
  ReviewCapabilities,
  SearchCollectionDetail,
} from "@/lib/review-api/types";
import { LoadMore } from "./load-more";
import { CollectionSummary, type VisibleRows } from "./collection-summary";
import { nextCursorOf } from "./cursor-block";
import { JobRowsTable } from "./job-rows-table";
import { JobSearchBox } from "./job-search-box";
import { JOB_VIEW_DEFAULTS, JobViewOptions } from "./job-view-options";
import { jobHref } from "./links";
import { ListEmpty, ListError, ListLoading, ListNotice } from "./list-state";
import { OrderSelect } from "./order-select";
import { ReviewProgress } from "@/components/showcase/review-overview/review-progress";
import {
  buildQueue,
  type ReviewQueueQuery,
  sourceJobsQueryOf,
} from "@/components/showcase/review-queue/review-queue";
import { writeQueue } from "@/components/showcase/review-queue/review-queue-storage";
import {
  type ReviewFilterValue,
  ReviewStatusFilter,
} from "./review-status-filter";
import { type CursorList, useCursorList } from "./use-cursor-list";
import { useResource } from "@/lib/use-resource";

/** "차례로 검수하기" 가 빈 페이지를 넘겨 이어 받는 최대 요청 수(BFF 가 이미 여러 페이지를 모아 준다). */
const START_REVIEW_MAX_REQUESTS = 4;
const UNSUPPORTED_CODE = "collection_source_type_unsupported";

interface CollectionHeader {
  collection: SearchCollectionDetail;
  capabilities: ReviewCapabilities | null;
}

function isUnsupported(error: unknown): boolean {
  return error instanceof ApiError && error.code === UNSUPPORTED_CODE;
}

/** Collection 상세: 헤더 + 검수할 완료 Job 목록. */
export function CollectionDetailView({
  collectionId,
}: {
  collectionId: string;
}) {
  const t = useTranslations("collections");
  const header = useResource<CollectionHeader>(collectionId, signal => {
    // 지원 여부 조회가 실패해도 상세는 보여 준다. 미지원이면 Job 목록이 409 로 알려 준다.
    const capabilities = getReviewCapabilities(collectionId, { signal }).catch(
      (err: unknown) => {
        if (isAbortError(err)) throw err;
        return null;
      },
    );
    return Promise.all([
      getCollection(collectionId, { signal }),
      capabilities,
    ]).then(([collection, caps]) => ({ collection, capabilities: caps }));
  });

  if (header.phase === "loading") {
    return <ListLoading rows={3} label={t("loadingMore")} />;
  }
  if (header.phase === "error") {
    return (
      <ListError
        error={header.error}
        onRetry={header.retry}
        testId="collection-detail-button-retry"
      />
    );
  }

  const unsupported =
    header.data.capabilities?.result_source_supported === false;

  return (
    <div className="flex flex-col gap-8 lg:min-h-0">
      {unsupported ? (
        <>
          <CollectionSummary collection={header.data.collection} />
          <UnsupportedNotice />
        </>
      ) : (
        <JobRowsSection
          collectionId={collectionId}
          renderHeader={(startReview, visibleRows) => (
            <CollectionSummary
              collection={header.data.collection}
              visibleRows={visibleRows}
              progress={
                <ReviewProgress
                  collection={header.data.collection}
                  collectionId={collectionId}
                  className="sm:col-span-2"
                  action={startReview}
                />
              }
            />
          )}
        />
      )}
    </div>
  );
}

function UnsupportedNotice() {
  const t = useTranslations("collections.unsupported");
  return <ListNotice title={t("title")} description={t("description")} />;
}

/** "더 보기" 로 이어 붙일 때 이미 받은 Job 을 빼는 키. */
function jobRowKey(row: JobRow): string {
  return row.job_id;
}

interface StartReviewState {
  phase: "idle" | "checking" | "none" | "error";
  /** 이 안내가 가리키는 표 조건 */
  key: string;
}

/**
 * Collection 머리(`renderHeader`, 검수 진행 카드 오른쪽에 이 표 조건으로 시작하는 "차례로 검수하기" 와
 * 기본 보기일 때 표에 보이는 행 수를 받는다)와 Job 카드: 한 줄 도구 막대(왼쪽 검수 상태, 오른쪽 검색과
 * 표시 옵션과 정렬), Job 행 표와 "더 보기". 행을 열면 지금 표를 검수 큐로 저장한다.
 */
function JobRowsSection({
  collectionId,
  renderHeader,
}: {
  collectionId: string;
  /**
   * "차례로 검수하기" 버튼과 안내, 표에 보이는 행 수(기본 보기가 아니거나 첫 쪽을 받기 전이면 `null`)를
   * 받아 Collection 머리를 그린다.
   */
  renderHeader: (
    startReview: ReactNode,
    visibleRows: VisibleRows | null,
  ) => ReactNode;
}) {
  const t = useTranslations("collections");
  const router = useRouter();
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [allHistory, setAllHistory] = useState<boolean>(
    JOB_VIEW_DEFAULTS.allHistory,
  );
  // 처음에는 최신 설정(latest Config)으로 실행한 Job 만 보인다. 이전 설정의 Job 은 "표시 옵션" 에서 꺼서 본다.
  const [latestOnly, setLatestOnly] = useState<boolean>(
    JOB_VIEW_DEFAULTS.latestOnly,
  );
  const [order, setOrder] = useState<ListOrder>("desc");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilterValue>("all");

  const queryKey = JSON.stringify([
    collectionId,
    query,
    allHistory,
    latestOnly,
    order,
    reviewFilter,
  ]);
  const currentQuery: ReviewQueueQuery = {
    q: query,
    latest: latestOnly || undefined,
    group_by: allHistory ? undefined : "input_files",
    order,
    review_status: reviewFilter === "all" ? undefined : reviewFilter,
  };
  const list = useCursorList<JobRow>(
    queryKey,
    (after, signal) =>
      listJobRows(
        collectionId,
        sourceJobsQueryOf({ query: currentQuery }, after),
        {
          signal,
        },
      ),
    jobRowKey,
  );

  // 기본 보기(표시 옵션 기본값, 검색어 없음, 검수 상태 "전체")에서만 요약 카드에 표 행 수를 보인다.
  // 이미 받은 행만 세고 더 받을 쪽이 남았으면 `more` 로 알린다(수를 얻으려 따로 요청하지 않는다).
  const defaultView =
    allHistory === JOB_VIEW_DEFAULTS.allHistory &&
    latestOnly === JOB_VIEW_DEFAULTS.latestOnly &&
    !query &&
    reviewFilter === "all";
  const visibleRows: VisibleRows | null =
    defaultView && list.phase === "ready"
      ? { count: list.items.length, more: list.hasMore }
      : null;

  const openFromTable = (jobId: string) => {
    const queue = buildQueue({
      collectionId,
      query: currentQuery,
      rows: list.items,
      startJobId: jobId,
      nextCursor: list.nextCursor,
    });
    if (queue) writeQueue(queue);
  };

  // 조건이 바뀌면 "차례로 검수하기" 결과 안내를 지운다.
  const [start, setStart] = useState<StartReviewState>({
    phase: "idle",
    key: queryKey,
  });
  if (start.key !== queryKey) setStart({ phase: "idle", key: queryKey });
  const startController = useRef<AbortController | null>(null);
  // 확인 중에 조건이 바뀌면 옛 조건으로 만든 큐로 이동하지 않도록 취소한다(언마운트 때도).
  useEffect(() => () => startController.current?.abort(), [queryKey]);

  const startReview = async () => {
    if (start.phase === "checking") return;
    startController.current?.abort();
    const controller = new AbortController();
    startController.current = controller;
    const key = queryKey;
    const queueQuery: ReviewQueueQuery = {
      ...currentQuery,
      review_status: "unfinished",
    };
    setStart({ phase: "checking", key });
    try {
      // 거른 페이지는 비어 있어도 뒤가 남았을 수 있다(has_more). 몇 번 더 이어 받는다.
      const fetchPage = (after?: string) =>
        listJobRows(
          collectionId,
          sourceJobsQueryOf({ query: queueQuery }, after),
          {
            signal: controller.signal,
          },
        );
      let page = await fetchPage();
      for (
        let requests = 1;
        requests < START_REVIEW_MAX_REQUESTS && page.data.length === 0;
        requests++
      ) {
        const cursor = nextCursorOf(page);
        if (cursor === null) break;
        page = await fetchPage(cursor);
      }
      if (controller.signal.aborted) return;
      const first = page.data[0];
      const queue = first
        ? buildQueue({
            collectionId,
            query: queueQuery,
            rows: page.data,
            startJobId: first.job_id,
            nextCursor: nextCursorOf(page),
          })
        : null;
      if (!first || !queue) {
        setStart({ phase: "none", key });
        return;
      }
      writeQueue(queue);
      setStart({ phase: "idle", key });
      router.push(jobHref(collectionId, first.job_id));
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      setStart({ phase: "error", key });
    }
  };

  // "차례로 검수하기" 는 Collection 머리의 검수 진행 카드 오른쪽에 둔다. 안내 문구는 버튼 아래에 떠서
  // 보여, 나타나도 버튼이 카드 세로 가운데에서 움직이지 않는다. 안내 자리(status)는 비어 있어도 숨기지
  // 않는다. 숨겨 둔 live region 에 글이 들어오면 화면 낭독기가 읽지 않을 수 있다(떠 있어 자리는 차지하지 않는다).
  const startReviewAction = (
    <>
      <Button
        type="button"
        size="default"
        onClick={startReview}
        disabled={start.phase === "checking" || start.phase === "none"}
        aria-describedby={
          start.phase === "none" || start.phase === "error"
            ? "job-rows-start-review-notice"
            : undefined
        }
        data-testid="collection-detail-button-start-review"
      >
        {start.phase === "checking"
          ? t("startReview.checking")
          : t("startReview.button")}
      </Button>
      <p
        id="job-rows-start-review-notice"
        role="status"
        className={
          start.phase === "error"
            ? "absolute top-full right-0 mt-1 text-xs whitespace-nowrap text-destructive"
            : "absolute top-full right-0 mt-1 text-xs whitespace-nowrap text-muted-foreground"
        }
        data-testid="collection-detail-start-review-notice"
      >
        {start.phase === "none" && t("startReview.none")}
        {start.phase === "error" && t("startReview.error")}
      </p>
    </>
  );

  // 표와 그 도구를 한 카드로 묶는다. 맨 위 한 줄 도구 막대, 이어서 표와 "더 보기".
  return (
    <>
      {renderHeader(startReviewAction, visibleRows)}
      <section
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs lg:min-h-0"
        aria-label={t("jobs.title")}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-3 px-5 py-3">
          <ReviewStatusFilter value={reviewFilter} onChange={setReviewFilter} />
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <JobSearchBox
              collectionId={collectionId}
              onQueryChange={setQuery}
            />
            <JobViewOptions
              allHistory={allHistory}
              onAllHistoryChange={setAllHistory}
              latestOnly={latestOnly}
              onLatestOnlyChange={setLatestOnly}
            />
            <OrderSelect
              value={order}
              onChange={setOrder}
              id="collection-detail-order"
              testId="collection-detail-select-order"
              compact
            />
          </div>
        </div>
        <JobRowsBody
          collectionId={collectionId}
          query={query}
          filtered={reviewFilter !== "all"}
          list={list}
          onOpen={openFromTable}
        />
      </section>
    </>
  );
}

function JobRowsBody({
  collectionId,
  query,
  filtered,
  list,
  onOpen,
}: {
  collectionId: string;
  query: string | undefined;
  /** 검수 상태 필터가 켜져 있는지 */
  filtered: boolean;
  list: CursorList<JobRow>;
  onOpen: (jobId: string) => void;
}) {
  const t = useTranslations("collections");
  // 표가 아닌 상태(불러오는 중, 오류, 빈 목록)는 카드 안쪽 여백을 두고 그린다.
  const padded = (node: ReactNode) => (
    <div className="border-t border-border p-5">{node}</div>
  );

  if (list.phase === "loading") {
    return padded(<ListLoading label={t("loadingMore")} />);
  }
  if (list.phase === "error") {
    if (isUnsupported(list.error)) return padded(<UnsupportedNotice />);
    return padded(
      <ListError
        error={list.error}
        onRetry={list.retry}
        testId="job-rows-button-retry"
      />,
    );
  }
  if (list.items.length === 0 && list.hasMore) {
    // 거른 페이지가 비었지만 뒤가 남았다. "더 보기" 로 이어 받는다.
    return padded(
      <LoadMore
        hasMore
        state={list.more}
        error={list.moreError}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        testIdPrefix="job-rows"
      />,
    );
  }
  if (list.items.length === 0) {
    if (filtered) {
      return padded(
        <ListEmpty
          title={t("jobs.emptyFiltered.title")}
          description={t("jobs.emptyFiltered.description")}
        />,
      );
    }
    return padded(
      query ? (
        <ListEmpty
          title={t("jobs.emptySearch.title", { query })}
          description={t("jobs.emptySearch.description")}
        />
      ) : (
        <ListEmpty
          title={t("jobs.empty.title")}
          description={t("jobs.empty.description")}
        />
      ),
    );
  }

  return (
    <div className="flex flex-col border-t border-border lg:min-h-0">
      {/* 넓은 화면에서는 표만 안에서 스크롤하고 머리 행은 위에 고정된다. */}
      <div className={FIT_TABLE_WRAP_CLASS}>
        <JobRowsTable
          collectionId={collectionId}
          rows={list.items}
          onOpen={onOpen}
        />
      </div>
      <div className="shrink-0 px-5 py-3 empty:hidden">
        <LoadMore
          hasMore={list.hasMore}
          state={list.more}
          error={list.moreError}
          onLoadMore={list.loadMore}
          onRetry={list.retry}
          testIdPrefix="job-rows"
        />
      </div>
    </div>
  );
}
