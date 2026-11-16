import type { NextRequest } from "next/server";

import { listSourceJobFiles } from "@/lib/upstage/collections";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import {
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

/** 원본 Job 의 입력 파일 목록. Job 이 이 Collection 소속인지 확인하고 페이지 수를 보충하는 데 쓴다. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/source-jobs/[jobId]/files">,
) {
  const { collectionId, jobId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }
  if (!RESOURCE_ID_PATTERN.test(jobId)) {
    return invalidValue("job_id is invalid", "job_id");
  }

  try {
    return await relayUpstream(await listSourceJobFiles(collectionId, jobId));
  } catch (err) {
    return mapClientError(err);
  }
}
