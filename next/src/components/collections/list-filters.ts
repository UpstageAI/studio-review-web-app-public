// Collection 목록의 출처 필터. 받아 둔 현재 페이지 안에서 거른다.

import type { SearchCollectionSummary } from "@/lib/review-api/types";
import {
  KNOWN_SOURCE_TYPES,
  sourceTypeKey,
  type KnownSourceType,
} from "./source-label";

/**
 * 고른 출처 유형들. 빈 배열이 "전체" 다. 값은 `KNOWN_SOURCE_TYPES` 순서로 정렬되고 중복이 없다
 * (같은 선택이 항상 같은 주소가 되게).
 */
export type SourceFilter = readonly KnownSourceType[];

/** 출처 필터 "전체". */
export const ALL_SOURCES: SourceFilter = [];

/** 문자열 목록에서 아는 출처 유형만 `KNOWN_SOURCE_TYPES` 순서로 한 번씩 남긴다. */
export function normalizeSourceFilter(values: readonly string[]): SourceFilter {
  const picked = new Set<string>(values);
  const next = KNOWN_SOURCE_TYPES.filter(type => picked.has(type));
  return next.length === 0 ? ALL_SOURCES : next;
}

/**
 * `type` 을 켜거나 끈 새 선택을 돌려준다. 결과는 정규화되어 있다.
 */
export function toggleSource(
  filter: SourceFilter,
  type: KnownSourceType,
): SourceFilter {
  return normalizeSourceFilter(
    filter.includes(type)
      ? filter.filter(value => value !== type)
      : [...filter, type],
  );
}

/**
 * 출처 유형이 `filter` 에 든 행만 남긴다. 빈 선택이면 입력 배열을 그대로(같은 참조로) 돌려준다.
 * 출처가 없거나 모르는 유형인 행은 필터가 하나라도 켜져 있으면 빠진다.
 */
export function filterBySource<T extends SearchCollectionSummary>(
  rows: readonly T[],
  filter: SourceFilter,
): readonly T[] {
  if (filter.length === 0) return rows;
  return rows.filter(row => {
    const key = sourceTypeKey(row.source?.type);
    return key !== null && filter.includes(key);
  });
}

/** 쉼표로 이은 출처 유형 목록(값 하나도 됨)을 읽는다. 아는 값이 없으면 "전체". */
export function parseSourceFilter(
  raw: string | null | undefined,
): SourceFilter {
  if (!raw) return ALL_SOURCES;
  return normalizeSourceFilter(raw.split(","));
}

/** 두 선택이 같은지. 둘 다 정규화되어 있다고 본다. */
export function sameSourceFilter(a: SourceFilter, b: SourceFilter): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** 출처 필터가 켜져 있는지. */
export function hasActiveFilter(source: SourceFilter): boolean {
  return source.length > 0;
}
