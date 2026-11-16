import { PARSE_PAGE_FILTER_ABOVE } from "./large-job";

// Parse 탭 "현재 페이지만" 필터의 순수 규칙. 브라우저 기억은 `@/lib/browser-storage` 로 읽고 쓴다.

/** 브라우저에 기억하는 키. 값은 `"1"`(켬)·`"0"`(끔). */
export const PARSE_PAGE_FILTER_STORAGE_KEY = "review:parse-current-page";

/** 기억한 값이 없을 때의 기본: 문서가 `PARSE_PAGE_FILTER_ABOVE` 쪽보다 길면 켠다. */
export function defaultCurrentPageOnly(pageCount: number): boolean {
  return pageCount > PARSE_PAGE_FILTER_ABOVE;
}

/** 저장소 값 → 플래그. 모르는 값(없음 포함)은 `null`. */
export function readStoredFlag(raw: string | null): boolean | null {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export function storedFlagValue(on: boolean): string {
  return on ? "1" : "0";
}

/** 뷰어 페이지(1-based) `page` 의 항목만. */
export function itemsOnPage<T extends { page: number }>(
  items: readonly T[],
  page: number,
): T[] {
  return items.filter(item => item.page === page);
}
