// 변경 이력 목록의 상태(순수). 커서 목록을 100 행 블록으로 받아 이어 붙이고, 받아 둔 행 안에서
// Collection 목록과 같은 번호 페이지(20 행)로 넘긴다. 요청은 훅이 `pendingRequest` 를 보고 보낸다.

import {
  CURSOR_BLOCK_PAGES,
  PAGE_SIZE,
} from "@/components/collections/cursor-block";
import { ApiError } from "@/lib/review-api/review-screen";
import {
  revisionErrorKind,
  revisionRetryDelayMs,
} from "@/lib/review-api/revisions";
import type { JobRevision, JobRevisionPage } from "@/lib/review-api/types";
import { mergeRevisionPages, type RevisionOrder } from "@/lib/revision-history";

/** 한 번에 받는 행 수(= 번호 페이지 5 개, 서버 `limit` 최대). */
export const BLOCK_LIMIT = PAGE_SIZE * CURSOR_BLOCK_PAGES;

/** 목록을 받지 않는 상태의 key(시트가 닫혀 있음). */
export const IDLE_KEY = "";

export type HistoryFilter = {
  type: "result" | "structure" | null;
  occurrenceId: string | null;
  order: RevisionOrder;
};

export interface RevisionListState {
  /** 지금 목록의 key(`queryKeyOf`). 다른 key 의 응답은 버린다. */
  key: string;
  /** 첫 페이지 상태. */
  phase: "idle" | "loading" | "ready" | "error";
  /** 첫 페이지 오류(`phase === "error"`). */
  error: unknown;
  /** 429 면 다시 요청할 수 있는 시각(ms). 첫 페이지·블록 오류 공통. */
  retryAt: number | null;
  /** 오류를 받은 시각(ms). 남은 초를 보일 때 쓴다. */
  failedAt: number | null;
  /** 받은 행(서버 순서 그대로, id 중복 없음). */
  rows: readonly JobRevision[];
  /** 다음 블록을 부를 `after`. 없으면 끝까지 받았다. */
  cursor: string | null;
  /** 0 부터 세는 보이는 페이지. 다음 블록을 받는 동안은 받은 범위 밖일 수 있다(`pageView` 가 당긴다). */
  pageIndex: number;
  /** 다음 블록 상태. */
  block: "idle" | "loading" | "error";
  blockError: unknown;
  /**
   * 저장이 반영돼 처음부터 다시 받을 때 돌아갈 0 부터 세는 페이지. 그 페이지까지 받으면(또는 더
   * 받을 행이 없으면) 지운다. 사용자가 페이지를 옮기면 지운다.
   */
  restorePage: number | null;
  /** 모르는 커서로 첫 페이지부터 다시 받은 횟수(1 회만). */
  cursorResets: number;
  /** 마지막으로 목록을 받은 시각(ms). 렌더 중 `Date.now()` 대신 상대 시각의 기준. */
  fetchedAt: number | null;
  /** 요청을 새로 보내야 할 때마다 늘린다(같은 `after` 를 다시 부르는 재시도 포함). */
  seq: number;
}

export type RevisionListAction =
  | { type: "RESET"; key: string; restorePage?: number }
  | {
      type: "PAGE_LOADED";
      key: string;
      after: string | null;
      page: JobRevisionPage;
      now: number;
    }
  | {
      type: "PAGE_FAILED";
      key: string;
      after: string | null;
      error: unknown;
      now: number;
    }
  /** 지금 페이지에 머문 채 다음 블록을 받는다. */
  | { type: "BLOCK_STARTED" }
  | { type: "RETRY" }
  | { type: "NEXT_PAGE" }
  | { type: "PREVIOUS_PAGE" }
  /** 1 부터 세는 번호. 지금 번호 버튼에 있는 페이지만. */
  | { type: "GO_TO_PAGE"; page: number };

export function initialRevisionList(key: string, seq = 0): RevisionListState {
  return {
    key,
    phase: key === IDLE_KEY ? "idle" : "loading",
    error: null,
    retryAt: null,
    failedAt: null,
    rows: [],
    cursor: null,
    pageIndex: 0,
    block: "idle",
    blockError: null,
    restorePage: null,
    cursorResets: 0,
    fetchedAt: null,
    seq,
  };
}

export function queryKeyOf(
  collectionId: string,
  jobId: string,
  filter: HistoryFilter,
): string {
  return JSON.stringify([
    collectionId,
    jobId,
    filter.type,
    filter.occurrenceId,
    filter.order,
  ]);
}

/** 서버가 잠시 받지 못한다(429)면 다시 요청할 수 있는 시각. 그 외 오류는 `null`. */
export function retryAtOf(err: unknown, now: number): number | null {
  if (!(err instanceof ApiError) || revisionErrorKind(err) !== "busy") {
    return null;
  }
  return now + revisionRetryDelayMs(err, now);
}

/**
 * 429 대기의 남은 초(최소 1). `now` 가 오류를 받은 시각보다 이르면(시계가 아직 그 시각을 보지
 * 못했다) 받은 시각 기준으로 센다.
 */
export function retrySecondsOf(
  retryAt: number,
  failedAt: number,
  now: number,
): number {
  return Math.max(1, Math.ceil((retryAt - Math.max(failedAt, now)) / 1000));
}

/** 지금 보내야 할 목록 요청(`after` 가 `null` 이면 첫 페이지). 없으면 `null`. */
export function pendingRequest(
  state: RevisionListState,
): { after: string | null } | null {
  if (state.phase === "loading") return { after: null };
  if (state.phase === "ready" && state.block === "loading" && state.cursor) {
    return { after: state.cursor };
  }
  return null;
}

export interface PageView {
  /** 1 부터 세는 보이는 페이지. */
  page: number;
  /** 번호 버튼(지금 블록의 5 페이지 중 받아 둔 페이지까지). */
  pageNumbers: number[];
  /** `rows.slice(start, end)` */
  start: number;
  end: number;
  canGoBack: boolean;
  /** 받아 둔 뒤 페이지가 있거나 서버에 더 있다. */
  hasMore: boolean;
  isLastLoadedPage: boolean;
  loadedPages: number;
}

/**
 * 받아 둔 행 수와 가려는 페이지로 보일 페이지를 계산한다. 커서 API 는 전체 개수를 주지 않으므로
 * 번호는 받아 둔 페이지까지만 그린다(Collection 목록과 같은 전제). 가려는 페이지가 받은 범위 밖이면
 * (다음 블록을 받는 중) 마지막 받은 페이지를 보인다.
 */
export function pageView(
  rowCount: number,
  pageIndex: number,
  cursor: string | null,
): PageView {
  const loadedPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const index = Math.min(Math.max(pageIndex, 0), loadedPages - 1);
  const firstInBlock =
    Math.floor(index / CURSOR_BLOCK_PAGES) * CURSOR_BLOCK_PAGES;
  const lastInBlock = Math.min(firstInBlock + CURSOR_BLOCK_PAGES, loadedPages);
  const pageNumbers: number[] = [];
  for (let item = firstInBlock; item < lastInBlock; item += 1) {
    pageNumbers.push(item + 1);
  }
  const isLastLoadedPage = index === loadedPages - 1;
  return {
    page: index + 1,
    pageNumbers,
    start: index * PAGE_SIZE,
    end: (index + 1) * PAGE_SIZE,
    canGoBack: index > 0,
    hasMore: !isLastLoadedPage || cursor !== null,
    isLastLoadedPage,
    loadedPages,
  };
}

function viewOf(state: RevisionListState): PageView {
  return pageView(state.rows.length, state.pageIndex, state.cursor);
}

/** 받은 범위 밖으로 나간 `pageIndex` 를 마지막 받은 페이지로 당긴다. */
function clampPage(state: RevisionListState): RevisionListState {
  const index = viewOf(state).page - 1;
  return index === state.pageIndex ? state : { ...state, pageIndex: index };
}

function startBlock(
  state: RevisionListState,
  pageIndex: number,
): RevisionListState {
  return {
    ...state,
    block: "loading",
    blockError: null,
    retryAt: null,
    failedAt: null,
    pageIndex,
    seq: state.seq + 1,
  };
}

/** 지금 이 응답을 기다리고 있는가(같은 key, 같은 `after`). */
function expects(
  state: RevisionListState,
  key: string,
  after: string | null,
): boolean {
  if (key !== state.key) return false;
  const pending = pendingRequest(state);
  return pending !== null && pending.after === after;
}

export function revisionListReducer(
  state: RevisionListState,
  action: RevisionListAction,
): RevisionListState {
  switch (action.type) {
    case "RESET":
      return {
        ...initialRevisionList(action.key, state.seq + 1),
        restorePage: action.restorePage ?? null,
      };
    case "PAGE_LOADED": {
      if (!expects(state, action.key, action.after)) return state;
      const { page } = action;
      const first = action.after === null;
      const cursor =
        page.has_more === true && page.last_id ? page.last_id : null;
      const loaded: RevisionListState = {
        ...state,
        phase: "ready",
        error: null,
        retryAt: null,
        failedAt: null,
        rows: first ? page.data : mergeRevisionPages(state.rows, page.data),
        cursor,
        block: "idle",
        blockError: null,
        fetchedAt: action.now,
      };
      const restore = state.restorePage;
      if (restore === null) return clampPage(loaded);
      if (loaded.rows.length > restore * PAGE_SIZE || cursor === null) {
        // 그 페이지까지 받았거나 더 받을 행이 없다 — 돌아가되 받은 범위로 당긴다.
        return clampPage({ ...loaded, pageIndex: restore, restorePage: null });
      }
      // 아직 그 페이지에 닿지 않았다 — 마지막 받은 페이지에 머물며 다음 블록을 받는다.
      return startBlock(
        loaded,
        viewOf({ ...loaded, pageIndex: restore }).page - 1,
      );
    }
    case "PAGE_FAILED": {
      if (!expects(state, action.key, action.after)) return state;
      const kind = revisionErrorKind(action.error);
      if (kind === "aborted") return state;
      if (
        kind === "invalid_cursor" &&
        action.after !== null &&
        state.cursorResets === 0
      ) {
        // 커서가 지워졌다(목록이 바뀜) — 한 번만 첫 페이지부터 다시 받는다.
        return {
          ...initialRevisionList(state.key, state.seq + 1),
          cursorResets: 1,
        };
      }
      const retryAt = retryAtOf(action.error, action.now);
      if (action.after === null) {
        return {
          ...state,
          phase: "error",
          error: action.error,
          retryAt,
          failedAt: action.now,
        };
      }
      // 다음 블록 실패 — 받아 둔 마지막 페이지에 머문다.
      return clampPage({
        ...state,
        block: "error",
        blockError: action.error,
        retryAt,
        failedAt: action.now,
      });
    }
    case "BLOCK_STARTED":
      if (state.phase !== "ready" || state.block === "loading") return state;
      if (state.cursor === null) return state;
      return { ...startBlock(state, state.pageIndex), restorePage: null };
    case "RETRY":
      if (state.phase === "error") {
        return {
          ...state,
          phase: "loading",
          error: null,
          retryAt: null,
          failedAt: null,
          seq: state.seq + 1,
        };
      }
      if (state.phase === "ready" && state.block === "error") {
        return startBlock(state, state.pageIndex);
      }
      return state;
    case "NEXT_PAGE": {
      if (state.phase !== "ready" || state.block === "loading") return state;
      const view = viewOf(state);
      if (!view.isLastLoadedPage) {
        return { ...state, pageIndex: view.page, restorePage: null };
      }
      if (state.cursor === null) return state;
      return { ...startBlock(state, view.page), restorePage: null };
    }
    case "PREVIOUS_PAGE": {
      if (state.phase !== "ready" || state.block === "loading") return state;
      const view = viewOf(state);
      if (!view.canGoBack) return state;
      return { ...state, pageIndex: view.page - 2, restorePage: null };
    }
    case "GO_TO_PAGE": {
      if (state.phase !== "ready" || state.block === "loading") return state;
      const view = viewOf(state);
      if (action.page === view.page) return state;
      if (!view.pageNumbers.includes(action.page)) return state;
      return { ...state, pageIndex: action.page - 1, restorePage: null };
    }
    default: {
      const never: never = action;
      return never;
    }
  }
}
