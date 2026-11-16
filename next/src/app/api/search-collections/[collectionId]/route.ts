import type { NextRequest } from "next/server";

import { getSearchCollection } from "@/lib/upstage/collections";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import {
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

/** Collection 한 건 상세(총 Job 수·최신 설정). */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]">,
) {
  const { collectionId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }

  try {
    return await relayUpstream(await getSearchCollection(collectionId));
  } catch (err) {
    return mapClientError(err);
  }
}
