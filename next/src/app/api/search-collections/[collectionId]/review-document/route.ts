import type { NextRequest } from "next/server";

import {
  MAX_DOCUMENT_JOBS,
  RESOURCE_ID_PATTERN,
  getReviewDocument,
} from "@/lib/upstage/review";

import {
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

/**
 * `?job_ids=a&job_ids=b` 로 지정한 Job 들의 검수 JSON 문서.
 * 본문은 숫자 토큰을 보존하도록 파싱하지 않고 그대로 전달한다. `If-None-Match` 는 upstream 으로 넘겨
 * 내용이 같으면 `304` 를 돌려준다.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/review-document">,
) {
  const { collectionId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }

  const jobIds = request.nextUrl.searchParams.getAll("job_ids");
  if (jobIds.length === 0) {
    return invalidValue("job_ids is required", "job_ids");
  }
  if (jobIds.length > MAX_DOCUMENT_JOBS) {
    return invalidValue(
      `job_ids accepts at most ${MAX_DOCUMENT_JOBS} values`,
      "job_ids",
    );
  }
  if (!jobIds.every(id => RESOURCE_ID_PATTERN.test(id))) {
    return invalidValue("job_ids contains an invalid value", "job_ids");
  }

  try {
    const upstream = await getReviewDocument(collectionId, jobIds, {
      ifNoneMatch: request.headers.get("if-none-match"),
    });
    return await relayUpstream(upstream);
  } catch (err) {
    return mapClientError(err);
  }
}
