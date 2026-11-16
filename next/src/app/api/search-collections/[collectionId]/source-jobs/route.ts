import type { NextRequest } from "next/server";

import type { JobRow, ListPage } from "@/lib/review-api/types";
import { readReviewStatuses } from "@/lib/review-status";
import { listSourceJobs } from "@/lib/upstage/collections";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { readTextWithin } from "@/app/api/_lib/bounded-body";
import { pickQuery } from "@/app/api/_lib/query";
import {
  REVIEW_FILTER_MAX_PAGES,
  SOURCE_JOBS_DEFAULT_LIMIT,
  SOURCE_JOBS_MAX_BYTES,
  annotateRows,
  collectFilteredPages,
  logReviewStatusError,
  matchesReviewFilter,
  parseJobRowsPage,
  reviewStatusUnavailable,
  toListBody,
} from "@/app/api/_lib/review-status-rows";
import {
  errorResponse,
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

const SOURCE_JOBS_QUERY = {
  q: { length: { min: 2, max: 200 } },
  config_id: { pattern: RESOURCE_ID_PATTERN },
  latest: { bool: true },
  status: { enum: ["in_progress", "completed", "failed", "cancelled"] },
  after: { cursor: true },
  before: { cursor: true },
  limit: { int: { min: 1, max: 100 } },
  order: { enum: ["asc", "desc"] },
  group_by: { enum: ["input_files"] },
  // 앱 DB 로 거르는 BFF 전용 쿼리. upstream 으로 보내지 않는다.
  review_status: { enum: ["pending", "in_progress", "done", "unfinished"] },
} as const;

const NO_STORE = { "Cache-Control": "private, no-store" };

class PageReadError extends Error {
  constructor(readonly response: Response) {
    super("source-jobs page could not be read");
  }
}

/** 200 응답 본문을 목록 페이지로 읽는다. 크기 초과·모양 오류는 502 응답을 담아 던진다. */
async function readPage(upstream: Response): Promise<ListPage<JobRow>> {
  const text = await readTextWithin(upstream, SOURCE_JOBS_MAX_BYTES);
  if (text === null) {
    throw new PageReadError(
      errorResponse(
        502,
        "response_too_large",
        `Source jobs page exceeds ${SOURCE_JOBS_MAX_BYTES} bytes`,
      ),
    );
  }
  const page = parseJobRowsPage(text);
  if (!page) {
    throw new PageReadError(
      errorResponse(
        502,
        "upstream_error",
        "Upstage API returned an invalid source jobs page",
      ),
    );
  }
  return page;
}

/**
 * Collection 에 결과를 낸 원본 Job 행 목록. 허용한 쿼리만 upstream 으로 넘긴다.
 * 다른 relay 라우트와 달리 200 본문을 파싱해 행마다 앱 DB 의 `review_status`·`review_completed_at` 를
 * 붙인다. `review_status` 쿼리가 있으면 그 상태의 행만 남기고, 모자라면 다음 upstream 페이지를
 * 이어 받는다(페이지 통째 — 응답 행 수가 `limit` 를 넘을 수 있다). DB 를 읽지 못하면 필터가 없을 때는
 * 상태 없이 목록만, 필터가 있을 때는 503 `review_status_unavailable`.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/source-jobs">,
) {
  const { collectionId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }

  const query = pickQuery(request.nextUrl.searchParams, SOURCE_JOBS_QUERY);
  if (query.error) return query.error;
  const { review_status: filter, ...upstreamQuery } = query.values;
  // 거른 목록은 `after` 로만 이어 받는다. `before` 와 섞이면 upstream 에 두 커서가 함께 간다.
  if (filter && upstreamQuery.before !== undefined) {
    return invalidValue(
      "before cannot be combined with review_status",
      "before",
    );
  }

  try {
    const upstream = await listSourceJobs(collectionId, upstreamQuery);
    if (upstream.status !== 200) return await relayUpstream(upstream);
    const first = await readPage(upstream);

    const annotate = async (rows: JobRow[]) =>
      annotateRows(
        rows,
        await readReviewStatuses(
          collectionId,
          rows.map(row => row.job_id),
        ),
      );

    if (!filter) {
      let data = first.data;
      try {
        data = await annotate(first.data);
      } catch (err) {
        // 거를 필요가 없으므로 목록은 살리고 검수 열만 비운다.
        logReviewStatusError(err);
      }
      return Response.json(
        toListBody(data, first, first, {
          first_id: first.first_id ?? null,
          last_id: first.last_id ?? null,
        }),
        { headers: NO_STORE },
      );
    }

    const fetchNext = async (after: string) => {
      try {
        const next = await listSourceJobs(collectionId, {
          ...upstreamQuery,
          after,
        });
        if (next.status !== 200) {
          await next.body?.cancel().catch(() => undefined);
          return null;
        }
        return await readPage(next);
      } catch {
        return null;
      }
    };

    let body: ListPage<JobRow>;
    try {
      body = await collectFilteredPages(first, fetchNext, {
        limit: upstreamQuery.limit ?? SOURCE_JOBS_DEFAULT_LIMIT,
        maxPages: REVIEW_FILTER_MAX_PAGES,
        keep: async rows =>
          (await annotate(rows)).filter(row =>
            matchesReviewFilter(row, filter),
          ),
      });
    } catch (err) {
      return reviewStatusUnavailable(err);
    }
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof PageReadError) return err.response;
    return mapClientError(err);
  }
}
