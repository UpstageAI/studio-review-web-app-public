import { useEffect, useEffectEvent, useState } from "react";
import { isAbortError } from "@/lib/review-api/client";
import type { ListPage } from "@/lib/review-api/types";
import { appendUnique, nextCursorOf } from "./cursor-block";

type Phase = "loading" | "ready" | "error";

interface ListState<T> {
  key: string;
  items: T[];
  nextCursor: string | null;
  phase: Phase;
  error: unknown;
  /** "더 보기" 요청 상태. 첫 페이지 상태(`phase`)와 따로 둔다. */
  more: "idle" | "loading" | "error";
  moreError: unknown;
}

interface PageRequest {
  key: string;
  after: string | null;
  attempt: number;
}

function initialState<T>(key: string): ListState<T> {
  return {
    key,
    items: [],
    nextCursor: null,
    phase: "loading",
    error: null,
    more: "idle",
    moreError: null,
  };
}

export interface CursorList<T> {
  items: T[];
  phase: Phase;
  error: unknown;
  hasMore: boolean;
  /** "더 보기" 로 이어 받을 커서. 없으면 `null` */
  nextCursor: string | null;
  more: "idle" | "loading" | "error";
  moreError: unknown;
  loadMore: () => void;
  retry: () => void;
}

/**
 * 커서 페이지 목록을 불러오고 "더 보기" 로 이어 붙인다.
 *
 * `queryKey` 는 필터를 담은 원시 문자열이다. 값이 바뀌면 목록과 커서를 비우고 첫 페이지부터
 * 다시 부른다. 이전 요청은 취소하고, 취소된 요청의 응답은 버린다.
 *
 * `keyOf` 를 주면 "더 보기" 로 받은 행 중 이미 받은 키의 행은 뺀다(페이지 사이에 목록이 바뀌어 같은
 * 행이 다시 오는 경우). 렌더마다 새로 만들지 않는 함수(모듈 수준 함수 등)를 넘긴다.
 */
export function useCursorList<T>(
  queryKey: string,
  fetchPage: (
    after: string | undefined,
    signal: AbortSignal,
  ) => Promise<ListPage<T>>,
  keyOf?: (item: T) => string,
): CursorList<T> {
  const [request, setRequest] = useState<PageRequest>({
    key: queryKey,
    after: null,
    attempt: 0,
  });
  const [state, setState] = useState<ListState<T>>(() =>
    initialState<T>(queryKey),
  );

  // 필터가 바뀌면 렌더 중에 상태를 맞춘다(effect 에서 비우면 이전 목록이 한 번 더 그려진다).
  if (request.key !== queryKey) {
    setRequest({ key: queryKey, after: null, attempt: 0 });
    setState(initialState<T>(queryKey));
  }

  const load = useEffectEvent(fetchPage);

  useEffect(() => {
    const { key, after } = request;
    const controller = new AbortController();

    load(after ?? undefined, controller.signal).then(
      page => {
        if (controller.signal.aborted) return;
        setState(prev => {
          if (prev.key !== key) return prev;
          return {
            ...prev,
            items:
              after === null
                ? page.data
                : keyOf
                  ? appendUnique(prev.items, page.data, keyOf)
                  : [...prev.items, ...page.data],
            nextCursor: nextCursorOf(page),
            phase: "ready",
            error: null,
            more: "idle",
            moreError: null,
          };
        });
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setState(prev => {
          if (prev.key !== key) return prev;
          return after === null
            ? { ...prev, phase: "error", error: err }
            : { ...prev, more: "error", moreError: err };
        });
      },
    );

    return () => controller.abort();
  }, [request, keyOf]);

  const loadMore = () => {
    if (!state.nextCursor || state.more === "loading") return;
    const after = state.nextCursor;
    setState(prev => ({ ...prev, more: "loading", moreError: null }));
    setRequest(prev => ({ ...prev, after, attempt: prev.attempt + 1 }));
  };

  const retry = () => {
    if (state.phase === "error") {
      setState(prev => ({ ...prev, phase: "loading", error: null }));
    } else if (state.more === "error") {
      setState(prev => ({ ...prev, more: "loading", moreError: null }));
    } else {
      return;
    }
    setRequest(prev => ({ ...prev, attempt: prev.attempt + 1 }));
  };

  return {
    items: state.items,
    phase: state.phase,
    error: state.error,
    hasMore: state.nextCursor !== null,
    nextCursor: state.nextCursor,
    more: state.more,
    moreError: state.moreError,
    loadMore,
    retry,
  };
}
