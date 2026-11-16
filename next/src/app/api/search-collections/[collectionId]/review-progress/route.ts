import type { NextRequest } from "next/server";

import { countReviewProgress } from "@/lib/review-status-aggregate";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { reviewStatusUnavailable } from "@/app/api/_lib/review-status-rows";
import { invalidValue } from "@/app/api/_lib/upstream-relay";

/** Collection 의 검수 상태별 Job 수 `{ done, in_progress }`(앱 DB, upstream 은 부르지 않는다). */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/review-progress">,
) {
  const { collectionId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }

  try {
    return Response.json(await countReviewProgress(collectionId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return reviewStatusUnavailable(err);
  }
}
