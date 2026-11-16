// Collection 목록의 정렬·필터·페이지를 주소 query 로 옮기고 되읽는다. 상세에서 뒤로 가거나
// "Collection 목록" 으로 돌아왔을 때 같은 화면을 다시 만들기 위해 쓴다.
//
// 파라미터(모두 선택, 기본값이면 적지 않음):
// - `view=lineage`                   보기(기본 목록)
// - `order=asc`                      서버 정렬 순서(기본 `desc`)
// - `sort=<column>.<asc|desc>`       현재 페이지 안 열 정렬
// - `source=<출처 유형>[,<출처 유형>…]` 현재 페이지 안 출처 필터(쉼표로 여러 개, 값 하나짜리 옛 주소도 읽힘)
// - `page=<n ≥ 2>`                   1부터 세는 페이지
// - `cursor=<c>` (반복)              블록 1..b 를 부를 `after` 커서(순서대로). b = 그 페이지의 블록 번호

import type { ListOrder } from "@/lib/review-api/types";
import { CURSOR_BLOCK_PAGES } from "./cursor-block";
import {
  ALL_SOURCES,
  parseSourceFilter,
  type SourceFilter,
} from "./list-filters";
import type { SortColumn, SortState } from "./sort-rows";

/** Collection 목록의 보기. `list` 는 표, `lineage` 는 Collection 관계 그림이다. */
export const LIST_VIEWS = ["list", "lineage"] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export interface ListUrlState {
  view: ListView;
  order: ListOrder;
  sort: SortState | null;
  source: SourceFilter;
  /** 0부터 세는 페이지 */
  pageIndex: number;
  /** 블록 1..b 의 `after` 커서. 길이는 `pageIndex` 의 블록 번호와 같다(블록 0 은 커서가 없다). */
  cursors: string[];
}

export const DEFAULT_LIST_URL_STATE: ListUrlState = {
  view: "list",
  order: "desc",
  sort: null,
  source: ALL_SOURCES,
  pageIndex: 0,
  cursors: [],
};

const SORT_COLUMNS: readonly SortColumn[] = [
  "name",
  "workflow",
  "jobs",
  "review",
  "updated",
  "lastResult",
];

function parseSort(raw: string | null): SortState | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const column = raw.slice(0, dot);
  const direction = raw.slice(dot + 1);
  if (!(SORT_COLUMNS as readonly string[]).includes(column)) return null;
  if (direction !== "asc" && direction !== "desc") return null;
  return { column: column as SortColumn, direction };
}

/** `page` 가 2 이상의 정수면 0부터 세는 값, 아니면 0. */
function parsePageIndex(raw: string | null): number {
  if (!raw || !/^\d{1,6}$/.test(raw)) return 0;
  const page = Number(raw);
  return page >= 2 ? page - 1 : 0;
}

/** 페이지의 블록 번호 = 그 페이지까지 필요한 커서 수. */
function blockIndexOf(pageIndex: number): number {
  return Math.floor(pageIndex / CURSOR_BLOCK_PAGES);
}

/**
 * 주소 query 를 목록 상태로 읽는다. 모르는 값은 기본값으로 둔다.
 * 커서 수가 `page` 의 블록 번호와 맞지 않으면(빈 커서 포함) 1 페이지·커서 없음으로 되돌린다.
 */
export function parseListUrlState(params: URLSearchParams): ListUrlState {
  const pageIndex = parsePageIndex(params.get("page"));
  const cursors = params.getAll("cursor");
  const pageValid =
    cursors.length === blockIndexOf(pageIndex) &&
    cursors.every(cursor => cursor.length > 0);
  return {
    view: params.get("view") === "lineage" ? "lineage" : "list",
    order: params.get("order") === "asc" ? "asc" : "desc",
    sort: parseSort(params.get("sort")),
    source: parseSourceFilter(params.get("source")),
    pageIndex: pageValid ? pageIndex : 0,
    cursors: pageValid ? cursors : [],
  };
}

/**
 * 목록 상태를 주소 query 문자열(`?` 없음)로 만든다. 기본값은 적지 않으므로 모두 기본이면 `""`.
 * `cursors` 는 페이지의 블록 번호만큼 앞에서부터 쓰고, 모자라면 페이지를 1 로 적는다.
 */
export function serializeListUrlState(state: ListUrlState): string {
  const params = new URLSearchParams();
  if (state.view !== "list") params.set("view", state.view);
  if (state.order === "asc") params.set("order", "asc");
  if (state.sort) {
    params.set("sort", `${state.sort.column}.${state.sort.direction}`);
  }
  if (state.source.length > 0) params.set("source", state.source.join(","));
  const blockIndex = blockIndexOf(state.pageIndex);
  const cursors = state.cursors.slice(0, blockIndex);
  if (
    state.pageIndex > 0 &&
    cursors.length === blockIndex &&
    cursors.every(cursor => cursor.length > 0)
  ) {
    params.set("page", String(state.pageIndex + 1));
    for (const cursor of cursors) params.append("cursor", cursor);
  }
  // 출처 값은 아는 유형 이름(영문·밑줄)뿐이라 구분자 쉼표를 그대로 둬도 안전하다. 주소를 읽기 쉽게 둔다.
  return params
    .toString()
    .replace(/(^|&)source=[^&]*/, part => part.replaceAll("%2C", ","));
}

/** 저장된 query 문자열을 다시 읽어 아는 값만 남긴다(앞의 `?` 는 있어도 된다). */
export function normalizeListSearch(raw: string): string {
  return serializeListUrlState(parseListUrlState(new URLSearchParams(raw)));
}
