import type { NextRequest } from "next/server";

import { RESOURCE_ID_PATTERN, getReviewImport } from "@/lib/upstage/review";

import {
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

/** 가져오기 한 건의 상태. 끝나지 않았으면 `Retry-After` 간격으로 다시 조회한다. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/review-imports/[importId]">,
) {
  const { collectionId, importId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }
  if (!RESOURCE_ID_PATTERN.test(importId)) {
    return invalidValue("import_id is invalid", "import_id");
  }

  try {
    return await relayUpstream(await getReviewImport(collectionId, importId));
  } catch (err) {
    return mapClientError(err);
  }
}
