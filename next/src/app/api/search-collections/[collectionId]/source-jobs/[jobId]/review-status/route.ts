import type { NextRequest } from "next/server";

import {
  REVIEW_STATUS_ACTIONS,
  type ReviewStatusAction,
  applyReviewStatusAction,
} from "@/lib/review-status";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { readTextWithin } from "@/app/api/_lib/bounded-body";
import { reviewStatusUnavailable } from "@/app/api/_lib/review-status-rows";
import { assertSameOrigin } from "@/app/api/_lib/same-origin";
import { invalidValue } from "@/app/api/_lib/upstream-relay";

/** 본문 상한. `{ "action": "complete" }` 한 줄이면 된다. */
const MAX_BODY_BYTES = 1024;

function readAction(text: string): ReviewStatusAction | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const action = (value as { action?: unknown }).action;
  return REVIEW_STATUS_ACTIONS.find(known => known === action) ?? null;
}

/**
 * Job 검수 상태를 바꾼다(앱 DB, upstream 은 부르지 않는다). 본문 `{ "action": "start" | "complete" | "reopen" }`.
 * upstream 소속은 확인하지 않는다 — 상태는 공유 메모이고 데이터 접근 권한이 아니다.
 */
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/source-jobs/[jobId]/review-status">,
) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const { collectionId, jobId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }
  if (!RESOURCE_ID_PATTERN.test(jobId)) {
    return invalidValue("job_id is invalid", "job_id");
  }

  const text = await readTextWithin(request, MAX_BODY_BYTES);
  if (text === null) {
    return invalidValue(
      `Request body must be ${MAX_BODY_BYTES} bytes or smaller`,
      "body",
    );
  }
  const action = readAction(text);
  if (!action) {
    return invalidValue(
      `action must be one of ${REVIEW_STATUS_ACTIONS.join(", ")}`,
      "action",
    );
  }

  try {
    return Response.json(
      await applyReviewStatusAction(collectionId, jobId, action),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return reviewStatusUnavailable(err);
  }
}
