import type { NextRequest } from "next/server";

import {
  RESOURCE_ID_PATTERN,
  listSourceJobRevisions,
} from "@/lib/upstage/review";

import { pickQuery } from "@/app/api/_lib/query";
import { rejectCrossSite } from "@/app/api/_lib/same-origin";
import {
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

const REVISIONS_QUERY = {
  type: { enum: ["result", "structure"] },
  occurrence_id: { pattern: RESOURCE_ID_PATTERN },
  job_result_id: { pattern: RESOURCE_ID_PATTERN },
  operation_id: { pattern: RESOURCE_ID_PATTERN },
  include: { enum: ["content"] },
  // 행 id 형식을 단정하지 않는다. 모르는 커서인지는 upstream 이 `invalid_cursor` 로 판정한다.
  after: { cursor: true },
  limit: { int: { min: 1, max: 100 } },
  // `order` 를 모르는 upstream 은 이 값을 무시하고 최신순으로 준다.
  order: { enum: ["asc", "desc"] },
} as const;

/**
 * 원본 Job 의 검수 변경 이력 한 페이지. 위 쿼리만 upstream 으로 넘기고 본문은 그대로 전달한다(숫자 토큰 보존).
 * `type=structure` 와 결과 필터를 함께 쓰는 등의 조합 규칙은 upstream 이 판정한다. 본문이 검수 내용이라
 * 다른 사이트가 브라우저를 거쳐 부르는 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 403 으로 막는다.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/source-jobs/[jobId]/revisions">,
) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { collectionId, jobId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }
  if (!RESOURCE_ID_PATTERN.test(jobId)) {
    return invalidValue("job_id is invalid", "job_id");
  }
  const query = pickQuery(request.nextUrl.searchParams, REVISIONS_QUERY);
  if (query.error) return query.error;

  try {
    return await relayUpstream(
      await listSourceJobRevisions(collectionId, jobId, query.values),
    );
  } catch (err) {
    return mapClientError(err);
  }
}
