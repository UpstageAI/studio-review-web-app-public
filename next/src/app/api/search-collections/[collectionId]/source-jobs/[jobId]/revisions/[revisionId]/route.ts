import type { NextRequest } from "next/server";

import {
  RESOURCE_ID_PATTERN,
  getSourceJobRevision,
} from "@/lib/upstage/review";

import { rejectCrossSite } from "@/app/api/_lib/same-origin";
import {
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

/**
 * 검수 변경 이력 한 건(변경 전·후 내용 포함). 본문과 `ETag` 를 그대로 전달한다. 요청의 `If-None-Match` 는
 * upstream 으로 넘기지 않는다. 다른 사이트가 브라우저를 거쳐 부르는 요청은 403 으로 막는다.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/source-jobs/[jobId]/revisions/[revisionId]">,
) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { collectionId, jobId, revisionId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }
  if (!RESOURCE_ID_PATTERN.test(jobId)) {
    return invalidValue("job_id is invalid", "job_id");
  }
  if (!RESOURCE_ID_PATTERN.test(revisionId)) {
    return invalidValue("revision_id is invalid", "revision_id");
  }

  try {
    return await relayUpstream(
      await getSourceJobRevision(collectionId, jobId, revisionId),
    );
  } catch (err) {
    return mapClientError(err);
  }
}
