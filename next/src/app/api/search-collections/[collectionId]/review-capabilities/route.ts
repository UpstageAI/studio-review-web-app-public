import type { NextRequest } from "next/server";

import {
  RESOURCE_ID_PATTERN,
  getReviewCapabilities,
} from "@/lib/upstage/review";

import {
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

/** Collection 의 검수 한도·지원 여부. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/review-capabilities">,
) {
  const { collectionId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }

  try {
    return await relayUpstream(await getReviewCapabilities(collectionId));
  } catch (err) {
    return mapClientError(err);
  }
}
