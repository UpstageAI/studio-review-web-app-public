import { useCallback, useEffect, useState } from "react";

/** 문서 목록 검색어를 목록에 적용하기까지 기다리는 시간. */
export const DOCUMENT_FILTER_DEBOUNCE_MS = 300;

/**
 * 문서 목록 라벨 검색어. 입력(`query`)은 바로 바뀌고, 목록에 적용할 값(`debouncedQuery`)은 입력이
 * `DOCUMENT_FILTER_DEBOUNCE_MS` 동안 멎은 뒤 따라온다. `clearQuery` 는 디바운스를 거치지 않고 둘 다
 * 바로 비워 목록이 곧장 돌아오게 한다.
 */
export function useDocumentFilterQuery(): {
  query: string;
  debouncedQuery: string;
  setQuery: (query: string) => void;
  clearQuery: () => void;
} {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(query),
      DOCUMENT_FILTER_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);
  const clearQuery = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);
  return { query, debouncedQuery, setQuery, clearQuery };
}
