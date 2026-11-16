import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { isAbortError } from "@/lib/review-api/client";
import type { ListPage } from "@/lib/review-api/types";
import {
  CURSOR_BLOCK_PAGES,
  getCursorBlockPage,
  nextCursorOf,
  PAGE_SIZE,
} from "./cursor-block";

type Phase = "loading" | "ready" | "error";

interface Navigation {
  key: string;
  /** `cursors[b]` = 블록 b 를 부를 `after` 커서. 블록 0 은 커서가 없다. */
  cursors: (string | undefined)[];
  /** 0부터 세는 가려는 페이지 */
  pageIndex: number;
}

interface LoadedBlock<T> {
  key: string;
  blockIndex: number;
  page: ListPage<T>;
}

interface FetchStatus {
  key: string;
  loading: boolean;
  error: unknown;
  /** 재시도마다 늘려 같은 블록을 다시 부른다. */
  attempt: number;
}

/** 첫 마운트에 복원할 위치. `cursors` 는 블록 1..b 의 `after` 커서다. */
export interface CursorBlockStart {
  pageIndex: number;
  cursors: readonly string[];
}

function initialNavigation(key: string, start?: CursorBlockStart): Navigation {
  if (!start) return { key, cursors: [undefined], pageIndex: 0 };
  return {
    key,
    cursors: [undefined, ...start.cursors],
    pageIndex: start.pageIndex,
  };
}

function initialStatus(key: string): FetchStatus {
  return { key, loading: true, error: null, attempt: 0 };
}

export interface CursorBlockList<T> {
  /** 첫 블록 상태. 블록을 하나라도 받았으면 `ready` 다. */
  phase: Phase;
  /** 첫 블록 오류(`phase === "error"`) 또는 블록 교체 오류(`blockError`) */
  error: unknown;
  retry: () => void;
  /** 보이는 페이지의 행 */
  pageItems: T[];
  /** 1부터 세는 보이는 페이지 */
  page: number;
  /** `cursors[b]` = 블록 b 를 부를 `after` 커서. 블록 0 은 `undefined` */
  cursors: readonly (string | undefined)[];
  pageNumbers: number[];
  canGoBack: boolean;
  hasMore: boolean;
  /** 받아 둔 블록을 보이면서 다른 블록을 받는 중 */
  blockLoading: boolean;
  /** 받아 둔 블록을 보이면서 다른 블록 요청이 실패함 */
  blockError: boolean;
  nextPage: () => void;
  previousPage: () => void;
  goToPage: (page: number) => void;
}

/**
 * 커서 목록을 `PAGE_SIZE × CURSOR_BLOCK_PAGES` 행 블록으로 받아 번호 페이지로 보인다.
 *
 * 블록 안 이동은 요청 없이 `slice` 만 바꾸고, 블록 경계를 넘을 때만 해당 블록을 부른다.
 * 지나온 블록의 커서를 기억해 두므로 앞 블록으로 돌아갈 때도 같은 커서로 다시 부른다.
 * `queryKey` 는 필터를 담은 원시 문자열이며, 값이 바뀌면 커서를 버리고 1 페이지부터 다시 부른다.
 * 이전 요청은 취소하고, 취소된 요청의 응답은 버린다.
 * `start` 는 첫 마운트에서만 읽는다(주소에서 복원한 페이지). 커서가 맞지 않으면 첫 요청이 실패해 오류 화면이 된다.
 */
export function useCursorBlockList<T>(
  queryKey: string,
  fetchBlock: (
    after: string | undefined,
    limit: number,
    signal: AbortSignal,
  ) => Promise<ListPage<T>>,
  start?: CursorBlockStart,
): CursorBlockList<T> {
  const [navigation, setNavigation] = useState<Navigation>(() =>
    initialNavigation(queryKey, start),
  );
  const [loaded, setLoaded] = useState<LoadedBlock<T> | null>(null);
  const [status, setStatus] = useState<FetchStatus>(() =>
    initialStatus(queryKey),
  );

  // 필터가 바뀌면 렌더 중에 상태를 맞춘다(effect 에서 비우면 이전 목록이 한 번 더 그려진다).
  if (navigation.key !== queryKey) {
    setNavigation(initialNavigation(queryKey));
    setLoaded(null);
    setStatus(initialStatus(queryKey));
  }

  const load = useEffectEvent(fetchBlock);

  const requestKey = navigation.key;
  const blockIndex = Math.floor(navigation.pageIndex / CURSOR_BLOCK_PAGES);
  const cursor = navigation.cursors[blockIndex];
  const attempt = status.attempt;

  useEffect(() => {
    const controller = new AbortController();

    load(cursor, PAGE_SIZE * CURSOR_BLOCK_PAGES, controller.signal).then(
      page => {
        if (controller.signal.aborted) return;
        setLoaded({ key: requestKey, blockIndex, page });
        setStatus(prev =>
          prev.key === requestKey
            ? { ...prev, loading: false, error: null }
            : prev,
        );
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setStatus(prev =>
          prev.key === requestKey
            ? { ...prev, loading: false, error: err }
            : prev,
        );
      },
    );

    return () => controller.abort();
  }, [requestKey, blockIndex, cursor, attempt]);

  const current = loaded?.key === queryKey ? loaded : null;
  const failed = status.error !== null && !status.loading;
  const busy = status.loading || failed;

  const view = getCursorBlockPage(
    navigation.pageIndex,
    current?.blockIndex ?? blockIndex,
    current ? current.page.data.length : null,
    PAGE_SIZE,
  );

  const data = current?.page.data;
  const pageItems = useMemo(
    () => (data ?? []).slice(view.start, view.end),
    [data, view.start, view.end],
  );

  const page = view.page;
  const hasMore = current
    ? !view.isLastInBlock || nextCursorOf(current.page) !== null
    : false;

  const nextPage = () => {
    if (!current || busy) return;
    if (!view.isLastInBlock) {
      setNavigation(prev => ({ ...prev, pageIndex: page }));
      return;
    }
    // 블록의 마지막 페이지 — 다음 블록을 받는다.
    const nextCursor = nextCursorOf(current.page);
    if (!nextCursor) return;
    const from = current.blockIndex;
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    setNavigation(prev => ({
      ...prev,
      cursors: [...prev.cursors.slice(0, from + 1), nextCursor],
      pageIndex: (from + 1) * CURSOR_BLOCK_PAGES,
    }));
  };

  const previousPage = () => {
    if (!current || busy || page <= 1) return;
    // 블록의 첫 페이지면 앞 블록을 다시 받는다(커서는 지나오며 기억해 뒀다).
    if (view.isFirstInBlock) {
      setStatus(prev => ({ ...prev, loading: true, error: null }));
    }
    setNavigation(prev => ({ ...prev, pageIndex: page - 2 }));
  };

  const goToPage = (target: number) => {
    if (!current || busy || target === page) return;
    if (!view.pageNumbers.includes(target)) return;
    setNavigation(prev => ({ ...prev, pageIndex: target - 1 }));
  };

  const retry = () => {
    if (!failed) return;
    setStatus(prev => ({
      ...prev,
      loading: true,
      error: null,
      attempt: prev.attempt + 1,
    }));
  };

  let phase: Phase = "ready";
  if (!current) phase = failed ? "error" : "loading";

  return {
    phase,
    error: failed ? status.error : null,
    retry,
    pageItems,
    page,
    cursors: navigation.cursors,
    pageNumbers: view.pageNumbers,
    canGoBack: current !== null && page > 1,
    hasMore,
    blockLoading: current !== null && status.loading,
    blockError: current !== null && failed,
    nextPage,
    previousPage,
    goToPage,
  };
}
