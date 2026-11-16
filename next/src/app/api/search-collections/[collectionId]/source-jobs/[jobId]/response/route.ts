import type { NextRequest } from "next/server";

import { getSourceJobResponse } from "@/lib/upstage/collections";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { readTextWithin } from "@/app/api/_lib/bounded-body";
import { figureCache, figureCacheKey } from "@/app/api/_lib/figure-cache";
import {
  JOB_RESPONSE_MAX_BYTES,
  extractFigures,
} from "@/app/api/_lib/job-response-figures";
import { rejectCrossSite } from "@/app/api/_lib/same-origin";
import {
  errorResponse,
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

/**
 * 원본 Job 응답. 추출값 좌표와 Parse 요소를 읽는 데 쓴다. 본문은 파싱하지 않고(숫자 토큰 보존) Parse
 * 그림 요소의 `base64_encoding` 만 떼어 서버 메모리에 두고 `figure_url` 로 바꿔 넘긴다 — 브라우저는 그림이
 * 보일 때만 `…/figures/{key}` 로 받는다. 본문이 바뀌므로 upstream `ETag` 는 넘기지 않고, 상한을 넘는 본문은
 * 502 `response_too_large`. 오류·`204`·`304` 는 그대로 전달한다. 다른 사이트가 브라우저를 거쳐 부르는
 * 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 upstream 을 부르지 않고 403 으로 막는다.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/source-jobs/[jobId]/response">,
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

  try {
    const upstream = await getSourceJobResponse(collectionId, jobId);
    if (upstream.status !== 200) return await relayUpstream(upstream);

    const text = await readTextWithin(upstream, JOB_RESPONSE_MAX_BYTES);
    if (text === null) {
      return errorResponse(
        502,
        "response_too_large",
        `Job response exceeds ${JOB_RESPONSE_MAX_BYTES} bytes`,
      );
    }

    const { text: body, figures } = extractFigures(text, {
      collectionId,
      jobId,
    });
    for (const figure of figures) {
      figureCache.set(figureCacheKey(collectionId, jobId, figure.key), {
        bytes: figure.bytes,
        contentType: figure.contentType,
      });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return mapClientError(err);
  }
}
