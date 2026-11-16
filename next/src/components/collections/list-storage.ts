// Collection 목록의 마지막 주소 query 를 탭 sessionStorage 에 둔다. 저장소가 막혀 있으면 기억하지 않는다
// (상세의 "Collection 목록" 링크가 기본 목록으로 갈 뿐 화면은 동작한다).

import { sessionStore } from "@/lib/browser-storage";

import { normalizeListSearch } from "./list-url-state";

const LIST_SEARCH_KEY = "collections-list-search";

/**
 * 이 탭에서 마지막으로 본 목록의 주소 query(`?` 포함, 없으면 `""`). 상세의 "Collection 목록" 링크가
 * 같은 정렬·필터·페이지로 돌아가는 데 쓴다. 아는 값만 남겨 돌려준다.
 */
export function readListSearch(): string {
  let raw: string | null = null;
  try {
    raw = sessionStore()?.getItem(LIST_SEARCH_KEY) ?? null;
  } catch {
    raw = null;
  }
  const search = raw ? normalizeListSearch(raw) : "";
  return search ? `?${search}` : "";
}

/** 목록의 주소 query(`?` 없음)를 기억한다. 빈 문자열이면 지운다. */
export function writeListSearch(search: string): void {
  try {
    const store = sessionStore();
    if (!store) return;
    if (search) store.setItem(LIST_SEARCH_KEY, search);
    else store.removeItem(LIST_SEARCH_KEY);
  } catch {
    // 저장소가 막혀 있으면 "Collection 목록" 링크는 기본 목록으로 간다.
  }
}
