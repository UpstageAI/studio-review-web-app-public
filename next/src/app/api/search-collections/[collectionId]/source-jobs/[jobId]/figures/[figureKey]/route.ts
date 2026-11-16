import type { NextRequest } from "next/server";

import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { figureCache, figureCacheKey } from "@/app/api/_lib/figure-cache";
import { FIGURE_KEY_PATTERN } from "@/app/api/_lib/job-response-figures";
import { errorResponse, invalidValue } from "@/app/api/_lib/upstream-relay";

/**
 * Job 응답에서 떼어 둔 Parse 그림 요소 이미지. `source-jobs/{jobId}/response` 가 같은 프로세스의 메모리에
 * 넣은 것만 있으므로(10 분·바이트 상한), 만료되거나 밀려났거나 서버가 재시작됐으면 404 `figure_not_found`
 * — 화면은 그 그림 자리를 숨기고, Job 응답을 다시 받으면 다시 채워진다. upstream 호출은 없다.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/source-jobs/[jobId]/figures/[figureKey]">,
) {
  const { collectionId, jobId, figureKey } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }
  if (!RESOURCE_ID_PATTERN.test(jobId)) {
    return invalidValue("job_id is invalid", "job_id");
  }
  if (!FIGURE_KEY_PATTERN.test(figureKey)) {
    return invalidValue("figure_key is invalid", "figure_key");
  }

  const figure = figureCache.get(
    figureCacheKey(collectionId, jobId, figureKey),
  );
  if (!figure) {
    return errorResponse(
      404,
      "figure_not_found",
      "Figure is not available; load the job response again",
    );
  }
  return new Response(figure.bytes, {
    status: 200,
    headers: {
      "Content-Type": figure.contentType,
      "Content-Length": String(figure.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
