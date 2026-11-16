import type { DocumentListItem } from "./document-list";

// 문서 목록을 라벨·상태로 거르고 요약하는 규칙(순수). 상태 값은 화면의 선택 상자 항목 순서다.

export type DocumentStatusFilter =
  | "all"
  | "flagged"
  | "changed"
  | "recheck"
  | "excluded"
  | "untouched"
  | "unvisited";

export const DOCUMENT_STATUS_FILTERS: readonly DocumentStatusFilter[] = [
  "all",
  "flagged",
  "changed",
  "recheck",
  "excluded",
  "untouched",
  "unvisited",
];

/**
 * 선택 상자에 보일 상태 필터(순서 그대로). "열어 보지 않은 문서"(`unvisited`)는 열어 본 문서를
 * 구분할 때(`trackVisited`, 문서가 둘 이상)만 둔다.
 */
export function statusFilterOptions(
  trackVisited: boolean,
): readonly DocumentStatusFilter[] {
  return trackVisited
    ? DOCUMENT_STATUS_FILTERS
    : DOCUMENT_STATUS_FILTERS.filter(value => value !== "unvisited");
}

/**
 * 지금 적용할 상태 필터. 고른 값이 선택 상자에서 빠졌으면(문서가 하나만 남아 열어 본 문서를 더는
 * 구분하지 않는데 `unvisited` 를 골라 둔 경우) `all` 로 본다.
 */
export function effectiveStatusFilter(
  status: DocumentStatusFilter,
  trackVisited: boolean,
): DocumentStatusFilter {
  return status === "unvisited" && !trackVisited ? "all" : status;
}

export function isDocumentStatusFilter(
  value: string,
): value is DocumentStatusFilter {
  return (DOCUMENT_STATUS_FILTERS as readonly string[]).includes(value);
}

/** 선택 상자가 돌려준 문자열을 상태 필터로. 모르는 값은 `all`. */
export function parseStatusFilter(value: string): DocumentStatusFilter {
  return isDocumentStatusFilter(value) ? value : "all";
}

/**
 * 검색어·라벨을 비교용으로 맞춘다: 앞뒤 공백 제거, 전각·호환 문자 정규화(NFKC), 소문자.
 * 빈 문자열이면 거르지 않는다.
 */
export function normalizeQuery(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase();
}

function matchesStatus(
  item: DocumentListItem,
  status: DocumentStatusFilter,
  selectedId: string | null,
): boolean {
  switch (status) {
    case "all":
      return true;
    case "flagged":
      // 먼저 볼 문서(검증 판정 실패, 경고). 편집 상태와 무관하다.
      return item.flag !== undefined;
    case "changed":
    case "recheck":
    case "excluded":
      return item.status === status;
    case "untouched":
      // "손대지 않음" = 상태 없음 + 편집 불가(locked). locked 문서는 고칠 수 없으니 손대지 않은
      // 문서로 본다(지금 host 는 locked 를 내지 않는다).
      return (
        item.status !== "changed" &&
        item.status !== "recheck" &&
        item.status !== "excluded"
      );
    case "unvisited":
      // 아직 열어 보지 않은 문서(`visited === false`). 고르는 순간 열어 본 문서가 되므로 지금 고른
      // 문서는 남겨 둔다(고르자마자 목록에서 사라지지 않게). 다른 문서를 고르면 그때 빠진다.
      return item.visited === false || item.id === selectedId;
  }
}

/**
 * 문서가 검색어·상태에 맞는가. `query` 는 `normalizeQuery` 를 거친 값이어야 하고, 라벨이 없는
 * 문서는 `untitled` 문구(화면에 보이는 그대로)로 검색된다. `selectedId` 는 `unvisited` 필터가
 * 남겨 둘 지금 고른 문서다.
 */
export function matchesDocument(
  item: DocumentListItem,
  query: string,
  status: DocumentStatusFilter,
  untitled: string,
  selectedId: string | null = null,
): boolean {
  if (!matchesStatus(item, status, selectedId)) return false;
  if (query === "") return true;
  return normalizeQuery(item.label ?? untitled).includes(query);
}

/**
 * 검색어(원문)와 상태로 거른 목록. 순서는 그대로다. `selectedId` 는 `unvisited` 필터에서 열어 봤어도
 * 남길 지금 고른 문서.
 */
export function filterDocumentItems(
  items: readonly DocumentListItem[],
  query: string,
  status: DocumentStatusFilter,
  untitled: string,
  selectedId: string | null = null,
): DocumentListItem[] {
  const normalized = normalizeQuery(query);
  if (normalized === "" && status === "all") return [...items];
  return items.filter(item =>
    matchesDocument(item, normalized, status, untitled, selectedId),
  );
}

/** 거르는 중인가(검색어가 비어 있지 않거나 상태가 전체가 아님). */
export function isFiltering(
  query: string,
  status: DocumentStatusFilter,
): boolean {
  return normalizeQuery(query) !== "" || status !== "all";
}

/**
 * 선택 문서가 전체 목록에는 있는데 거른 목록에서 빠졌는가. 전체 목록에도 없는 선택(다른 문서
 * 배치 보기의 문서 등)은 필터 탓이 아니므로 `false`.
 */
export function isSelectionHidden(
  items: readonly DocumentListItem[],
  visibleItems: readonly DocumentListItem[],
  selectedId: string | null,
): boolean {
  if (selectedId === null) return false;
  if (!items.some(item => item.id === selectedId)) return false;
  return !visibleItems.some(item => item.id === selectedId);
}

/** 문서 수와 페이지 수 합계, 열어 본 문서 수(`visited === true`). */
export function summarizeDocuments(items: readonly DocumentListItem[]): {
  count: number;
  pages: number;
  visited: number;
} {
  let pages = 0;
  let visited = 0;
  for (const item of items) {
    pages += item.pageCount;
    if (item.visited === true) visited += 1;
  }
  return { count: items.length, pages, visited };
}
