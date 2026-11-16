import type { JobRevision } from "@/lib/review-api/types";

/** 목록 정렬 방향. 서버 `order` 쿼리와 같다. */
export type RevisionOrder = "asc" | "desc";

type Sortable = Pick<JobRevision, "id" | "version" | "published_at">;

const compareIds = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * 서버 기본(`desc`) 순서 비교: `published_at` 내림차순 → `version` 내림차순 → `id` 내림차순.
 * 음수면 `a` 가 앞.
 */
export function compareRevisions(a: Sortable, b: Sortable): number {
  return (
    b.published_at - a.published_at ||
    b.version - a.version ||
    compareIds(b.id, a.id)
  );
}

/** 받아 둔 행 뒤에 다음 페이지를 붙인다. 이미 있는 id 는 건너뛰고 순서는 받은 그대로. */
export function mergeRevisionPages<T extends { readonly id: string }>(
  prev: readonly T[],
  next: readonly T[],
): T[] {
  const seen = new Set(prev.map(row => row.id));
  const out = [...prev];
  for (const row of next) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
