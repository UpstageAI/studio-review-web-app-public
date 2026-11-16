import type { NextRequest } from "next/server";

import {
  countReviewOverview,
  countReviewProgressMany,
} from "@/lib/review-status-aggregate";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { reviewStatusUnavailable } from "@/app/api/_lib/review-status-rows";
import { invalidValue } from "@/app/api/_lib/upstream-relay";

/** 한 번에 받을 수 있는 Collection 수(목록 한 페이지의 최대 행 수). */
const MAX_COLLECTION_IDS = 100;

/**
 * Collection 목록용 검수 현황(앱 DB, upstream 은 부르지 않는다).
 * `?collection_ids=a,b,c` 의 Collection 마다 `{ done, in_progress }` 와 앱 전체 요약을 돌려준다.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("collection_ids") ?? "";
  const ids = [...new Set(raw.split(",").filter(id => id !== ""))];
  if (ids.length > MAX_COLLECTION_IDS) {
    return invalidValue(
      `collection_ids accepts at most ${MAX_COLLECTION_IDS} ids`,
      "collection_ids",
    );
  }
  if (ids.some(id => !RESOURCE_ID_PATTERN.test(id))) {
    return invalidValue("collection_ids is invalid", "collection_ids");
  }

  try {
    const [collections, overview] = await Promise.all([
      countReviewProgressMany(ids),
      countReviewOverview(),
    ]);
    return Response.json(
      { collections, overview },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return reviewStatusUnavailable(err);
  }
}
