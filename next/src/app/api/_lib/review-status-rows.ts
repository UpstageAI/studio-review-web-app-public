import "server-only";

import type {
  JobRow,
  ListPage,
  ReviewStatusFilter,
  ReviewStatusRecord,
} from "@/lib/review-api/types";

import { errorResponse } from "./upstream-relay";

// `source-jobs` 목록 행에 앱 DB 의 검수 상태를 붙이고, `review_status` 필터로 거르는 순수 함수들.
// upstream 커서는 페이지 단위라 페이지 중간에서 자를 수 없다. 그래서 거른 뒤 행이 모자라면 다음
// upstream 페이지를 통째로 이어 받아 합친다(최대 `REVIEW_FILTER_MAX_PAGES` 페이지).

/** 필터로 비는 페이지를 채우려고 이어 받는 upstream 페이지 수 상한(첫 페이지 포함). */
export const REVIEW_FILTER_MAX_PAGES = 5;

/** `source-jobs` 한 페이지 본문 상한. 100 행 × 파일 메타 수백 바이트라 충분하다. */
export const SOURCE_JOBS_MAX_BYTES = 8 * 1024 * 1024;

/** upstream 목록 기본 페이지 크기(`limit` 를 안 보냈을 때). */
export const SOURCE_JOBS_DEFAULT_LIMIT = 20;

/** 앱 DB 를 읽거나 쓰지 못했을 때의 503. DB 오류 내용은 응답에 넣지 않고 서버 로그에만 남긴다. */
/** 앱 DB 오류를 로그에만 남긴다. 메시지·스택은 비밀값을 담을 수 있어 이름만 적는다. */
export function logReviewStatusError(err: unknown): void {
  console.error(
    "[review-status] storage error",
    err instanceof Error ? err.name : typeof err,
  );
}

export function reviewStatusUnavailable(err: unknown): Response {
  logReviewStatusError(err);
  return errorResponse(
    503,
    "review_status_unavailable",
    "Review status storage is unavailable",
  );
}

/** 본문을 목록 페이지로 읽는다. JSON 이 아니거나 `data` 배열이 없으면 `null`. */
export function parseJobRowsPage(text: string): ListPage<JobRow> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const page = value as ListPage<JobRow>;
  if (!Array.isArray(page.data)) return null;
  return page;
}

/** 행마다 `review_status`·`review_completed_at` 를 붙인다. 상태 맵에 없는 행은 `pending`. */
export function annotateRows(
  rows: readonly JobRow[],
  statuses: ReadonlyMap<string, ReviewStatusRecord>,
): JobRow[] {
  return rows.map(row => {
    const status = statuses.get(row.job_id);
    return {
      ...row,
      review_status: status?.review_status ?? "pending",
      review_completed_at: status?.review_completed_at ?? null,
    };
  });
}

/** 주석이 붙은 행이 필터에 맞는지. `pending` 은 기록 없음, `unfinished` 는 검수 전 + 검수 중. */
export function matchesReviewFilter(
  row: JobRow,
  filter: ReviewStatusFilter,
): boolean {
  const status = row.review_status ?? "pending";
  if (filter === "unfinished") return status !== "done";
  return status === filter;
}

/** 다음 페이지가 있는지. upstream 이 `has_more` 를 줘도 커서가 없으면 이어 받을 수 없다. */
function hasNext(page: ListPage<JobRow>): boolean {
  return page.has_more === true && typeof page.last_cursor === "string";
}

/** 응답 본문 모양. `first_cursor` 는 첫 페이지, `last_cursor`·`has_more` 는 마지막으로 받은 페이지 값. */
export function toListBody(
  data: JobRow[],
  first: ListPage<JobRow>,
  last: ListPage<JobRow>,
  ids: { first_id: string | null; last_id: string | null },
): ListPage<JobRow> {
  return {
    object: "list",
    data,
    has_more: hasNext(last),
    first_id: ids.first_id,
    last_id: ids.last_id,
    first_cursor: first.first_cursor ?? null,
    last_cursor: last.last_cursor ?? null,
  };
}

export interface CollectFilteredOptions {
  /** 이 수만큼 행이 모이면 더 받지 않는다(넘을 수 있다 — 페이지는 통째로 합친다). */
  limit: number;
  /** 받을 upstream 페이지 수 상한(첫 페이지 포함). */
  maxPages: number;
  /** 한 페이지의 행에 상태를 붙이고 필터로 거른다. 던지면 그대로 전파한다(DB 실패). */
  keep: (rows: JobRow[]) => Promise<JobRow[]>;
}

/**
 * 첫 페이지부터 거르고, 행이 `limit` 보다 적고 다음 페이지가 있으면 `fetchNext(after)` 로 이어 받는다.
 * `fetchNext` 가 `null` 이면(두 번째 이후 페이지 실패) 거기서 멈추고 직전 페이지의 커서와
 * `has_more: true` 로 돌려준다 — 다음 "더 보기" 가 그 자리부터 이어 받는다.
 */
export async function collectFilteredPages(
  first: ListPage<JobRow>,
  fetchNext: (after: string) => Promise<ListPage<JobRow> | null>,
  opts: CollectFilteredOptions,
): Promise<ListPage<JobRow>> {
  const data = await opts.keep(first.data);
  let last = first;
  let pages = 1;
  while (data.length < opts.limit && hasNext(last) && pages < opts.maxPages) {
    // 실패하면 `last` 가 그대로라 `has_more`(참)·`last_cursor` 가 직전 페이지 값으로 남는다.
    const next = await fetchNext(last.last_cursor as string);
    if (!next) break;
    data.push(...(await opts.keep(next.data)));
    last = next;
    pages += 1;
  }
  return toListBody(data, first, last, {
    first_id: data[0]?.job_id ?? null,
    last_id: data.at(-1)?.job_id ?? null,
  });
}
