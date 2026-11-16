"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "@/lib/abort";

export type ResourceState<T> =
  | { phase: "loading" }
  | { phase: "ready"; data: T }
  | { phase: "error"; error: unknown };

type KeyedState<T> = ResourceState<T> & { key: string };

/**
 * `key` 로 가리키는 값을 한 번 받아 오는 hook. `key` 가 바뀌거나 `retry()` 를 부르면 그 렌더에서 바로
 * loading 으로 돌아가므로(이전 값이 새 키와 함께 그려지지 않는다) 다시 받는다. 요청마다
 * `AbortController` 를 쓰고 키가 바뀌거나 언마운트하면 취소하며, 취소된 요청의 응답·취소로 인한
 * 실패는 버린다. `fetcher` 는 늘 최신 것을 쓰지만 다시 받는 계기는 키와 `retry()` 뿐이다.
 */
export function useResource<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
): ResourceState<T> & { retry(): void } {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${key}:${attempt}`;
  const [state, setState] = useState<KeyedState<T>>({
    phase: "loading",
    key: requestKey,
  });
  if (state.key !== requestKey) {
    setState({ phase: "loading", key: requestKey });
  }

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    fetcherRef.current(signal).then(
      data => {
        if (signal.aborted) return;
        setState({ phase: "ready", key: requestKey, data });
      },
      (error: unknown) => {
        if (signal.aborted || isAbortError(error)) return;
        setState({ phase: "error", key: requestKey, error });
      },
    );
    return () => controller.abort();
  }, [requestKey]);

  const retry = useCallback(() => setAttempt(current => current + 1), []);

  if (state.key !== requestKey || state.phase === "loading") {
    return { phase: "loading", retry };
  }
  if (state.phase === "error") {
    return { phase: "error", error: state.error, retry };
  }
  return { phase: "ready", data: state.data, retry };
}
