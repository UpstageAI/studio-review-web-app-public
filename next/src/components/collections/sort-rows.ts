// Collection 목록의 현재 페이지 안 정렬. 서버는 정렬 기준 열을 고를 수 없어 보이는 행만 정렬한다.

import { toTimestamp } from "@/lib/format";
import type { SearchCollectionSummary } from "@/lib/review-api/types";
import { workflowName } from "./source-label";

export type SortColumn =
  "name" | "workflow" | "jobs" | "review" | "updated" | "lastResult";
export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

export interface SortLabels<T> {
  /** 이름이 없는 Collection 에 보이는 문구 */
  untitled: string;
  /** "검수" 열 정렬 값(검수 완료 비율 등). 없거나 아직 모르면 `null`. */
  reviewValue?: (row: T) => number | null;
}

/** 헤더 클릭마다 오름차순 → 내림차순 → 해제(서버 순서) 로 돈다. 다른 열을 누르면 오름차순부터. */
export function nextSortState(
  current: SortState | null,
  column: SortColumn,
): SortState | null {
  if (!current || current.column !== column) {
    return { column, direction: "asc" };
  }
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

type SortValue = string | number | null;

function sortValue<T extends SearchCollectionSummary>(
  row: T,
  column: SortColumn,
  labels: SortLabels<T>,
): SortValue {
  switch (column) {
    case "name":
      return row.name || labels.untitled;
    case "workflow":
      return workflowName(row.source);
    case "jobs":
      return typeof row.total_job_count === "number" &&
        Number.isFinite(row.total_job_count)
        ? row.total_job_count
        : null;
    case "review":
      return labels.reviewValue?.(row) ?? null;
    case "updated":
      return toTimestamp(row.updated_at);
    case "lastResult":
      return toTimestamp(row.last_result_at);
  }
}

/**
 * 행을 한 열 기준으로 정렬한다. `sort` 가 `null` 이면 입력 배열을 그대로(같은 참조로) 돌려준다.
 *
 * 문자열은 locale 순서(숫자는 크기순, 대소문자·악센트 무시), 숫자·시각은 크기순이다.
 * 값이 없는 행은 방향과 관계없이 뒤에 둔다. 값이 같으면 입력 순서(서버 순서)를 지킨다.
 * 입력 배열은 바꾸지 않는다.
 */
export function sortRows<T extends SearchCollectionSummary>(
  rows: readonly T[],
  sort: SortState | null,
  locale: string,
  labels: SortLabels<T>,
): readonly T[] {
  if (!sort) return rows;
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  const sign = sort.direction === "asc" ? 1 : -1;
  const keyed = rows.map(row => ({
    row,
    value: sortValue(row, sort.column, labels),
  }));
  keyed.sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value === b.value) return 0;
      return a.value === null ? 1 : -1;
    }
    const diff =
      typeof a.value === "string" && typeof b.value === "string"
        ? collator.compare(a.value, b.value)
        : Number(a.value) - Number(b.value);
    return diff * sign;
  });
  return keyed.map(item => item.row);
}
